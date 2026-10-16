import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createRoomSchema,
  joinRoomSchema,
  movieQuerySchema,
  roomCodeSchema,
  uuid,
  type ErrorCode,
  type RateLimitKey,
} from '@blockparty/shared';
import type { TokenService } from '../auth/token';
import type { Catalog } from '../catalog/catalog';
import type { DurableStore } from '../db/durable';
import type { KvStore } from '../db/kv';
import type { RoomManager } from '../rooms/RoomManager';
import type { RateLimiter } from '../util/rateLimiter';

export interface ApiDeps {
  manager: RoomManager;
  catalog: Catalog;
  tokens: TokenService;
  limiter: RateLimiter;
  kv: KvStore;
  durable: DurableStore;
  benchResultsDir: string;
  bootId: string;
  startedAt: number;
  restRateLimit: boolean;
}

const STATUS: Record<ErrorCode, number> = {
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  INVALID: 400,
  NOT_FOUND: 404,
  ROOM_FULL: 403,
  BAD_PASSWORD: 401,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  INTERNAL: 500,
};

function sendError(reply: FastifyReply, code: ErrorCode, message: string) {
  return reply.status(STATUS[code]).send({ error: { code, message } });
}

let benchCache: { mtimeMs: number; body: unknown } | null = null;

export async function readLatestBench(dir: string): Promise<unknown | null> {
  const file = join(dir, 'latest.json');
  try {
    const s = await stat(file);
    if (benchCache && benchCache.mtimeMs === s.mtimeMs) return benchCache.body;
    const body = JSON.parse(await readFile(file, 'utf8')) as unknown;
    benchCache = { mtimeMs: s.mtimeMs, body };
    return body;
  } catch {
    return null;
  }
}

export async function registerApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { manager, catalog, tokens, limiter } = deps;

  const limited = (req: FastifyRequest, reply: FastifyReply, key: RateLimitKey): boolean => {
    if (!deps.restRateLimit || limiter.hit(`ip:${req.ip}`, key)) return false;
    void sendError(reply, 'RATE_LIMITED', 'Too many requests - try again in a minute');
    return true;
  };

  app.get('/api/health', async () => ({
    ok: true,
    bootId: deps.bootId,
    uptimeSec: Math.round((Date.now() - deps.startedAt) / 1000),
    rooms: manager.all().length,
    store: deps.kv.kind,
    redis: deps.kv.kind === 'redis' ? deps.kv.healthy() : null,
    db: deps.durable.enabled ? deps.durable.healthy() : null,
    pendingWrites: deps.durable.pending(),
    catalog: catalog.size,
  }));

  app.get('/api/stats', async () => {
    const live = manager.stats();
    const bench = (await readLatestBench(deps.benchResultsDir)) as { headline?: { p95?: number } } | null;
    return { ...live, benchP95: bench?.headline?.p95 ?? null };
  });

  app.get('/api/metrics', async (_req, reply) => {
    const s = manager.stats();
    const lines = [
      '# HELP blockparty_rooms Active rooms',
      '# TYPE blockparty_rooms gauge',
      `blockparty_rooms ${s.rooms}`,
      '# HELP blockparty_users Connected users',
      '# TYPE blockparty_users gauge',
      `blockparty_users ${s.users}`,
      '# HELP blockparty_propagation_ms Control propagation latency (rolling 5 min)',
      '# TYPE blockparty_propagation_ms summary',
      `blockparty_propagation_ms{quantile="0.5"} ${s.p50 ?? 'NaN'}`,
      `blockparty_propagation_ms{quantile="0.95"} ${s.p95 ?? 'NaN'}`,
      `blockparty_propagation_ms{quantile="0.99"} ${s.p99 ?? 'NaN'}`,
      `blockparty_propagation_ms_count ${s.propagationSamples}`,
      '# HELP blockparty_durable_pending Queued durable writes',
      '# TYPE blockparty_durable_pending gauge',
      `blockparty_durable_pending ${deps.durable.pending()}`,
      '# HELP process_resident_memory_bytes Resident memory',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    ];
    return reply.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });

  // ---------------- rooms ----------------
  app.post('/api/rooms', async (req, reply) => {
    if (limited(req, reply, 'rest:create')) return reply;
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 'INVALID', parsed.error.issues[0]?.message ?? 'Invalid request');
    const { name, avatarSeed, roomName, password, controlMode, token } = parsed.data;
    const previous = await tokens.verify(token);
    const uid = previous?.uid ?? uuid();
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const room = manager.create({
      name: roomName && roomName.length > 0 ? roomName : `${name}'s party`,
      passwordHash,
      hostId: uid,
      controlMode,
    });
    const newToken = await tokens.sign({ uid, code: room.code, name, seed: avatarSeed });
    return reply.status(201).send({ code: room.code, token: newToken, userId: uid, room: room.info() });
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (req, reply) => {
    const code = roomCodeSchema.safeParse(req.params.code);
    if (!code.success) return sendError(reply, 'INVALID', 'Room codes are 6 characters');
    const room = manager.get(code.data);
    if (!room) return sendError(reply, 'NOT_FOUND', 'Room not found');
    return {
      room: room.info(),
      connected: room.connectedCount(),
      nowPlaying: room.state.media ? { title: room.state.media.title, status: room.state.status } : null,
    };
  });

  app.post<{ Params: { code: string } }>('/api/rooms/:code/join', async (req, reply) => {
    if (limited(req, reply, 'rest:join')) return reply;
    const code = roomCodeSchema.safeParse(req.params.code);
    if (!code.success) return sendError(reply, 'INVALID', 'Room codes are 6 characters');
    const parsed = joinRoomSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 'INVALID', parsed.error.issues[0]?.message ?? 'Invalid request');
    const room = manager.get(code.data);
    if (!room) return sendError(reply, 'NOT_FOUND', 'Room not found');
    const { name, avatarSeed, password, token } = parsed.data;
    const previous = await tokens.verify(token);
    const alreadyMember = !!previous && previous.code === room.code && room.participants.has(previous.uid);
    if (room.passwordHash && !(previous && previous.code === room.code)) {
      if (!password) return sendError(reply, 'BAD_PASSWORD', 'This room needs a password');
      const ok = await bcrypt.compare(password, room.passwordHash);
      if (!ok) return sendError(reply, 'BAD_PASSWORD', 'Wrong password');
    }
    if (!alreadyMember && room.connectedCount() >= room.maxUsers) return sendError(reply, 'ROOM_FULL', 'This room is full');
    const uid = previous?.uid ?? uuid();
    const newToken = await tokens.sign({ uid, code: room.code, name, seed: avatarSeed });
    return { token: newToken, userId: uid, room: room.info() };
  });

  app.get<{ Params: { code: string }; Querystring: { limit?: string } }>('/api/recommend/:code', async (req, reply) => {
    const code = roomCodeSchema.safeParse(req.params.code);
    if (!code.success) return sendError(reply, 'INVALID', 'Room codes are 6 characters');
    const room = manager.get(code.data);
    if (!room) return sendError(reply, 'NOT_FOUND', 'Room not found');
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 12));
    return { recommendations: room.recommend(limit) };
  });

  // ---------------- movies ----------------
  app.get('/api/movies', async (req, reply) => {
    const parsed = movieQuerySchema.safeParse(req.query);
    if (!parsed.success) return sendError(reply, 'INVALID', parsed.error.issues[0]?.message ?? 'Invalid query');
    return catalog.search(parsed.data);
  });

  app.get('/api/movies/categories', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return catalog.categories();
  });

  app.get<{ Params: { id: string } }>('/api/movies/:id', async (req, reply) => {
    const m = catalog.get(req.params.id);
    if (!m) return sendError(reply, 'NOT_FOUND', 'Movie not found');
    return m;
  });

  /** Whole catalog for the client's instant local fuzzy search (stale-while-revalidate). */
  app.get('/api/catalog', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    return { version: catalog.size, movies: catalog.all() };
  });

  app.get('/api/bench/latest', async (_req, reply) => {
    const body = await readLatestBench(deps.benchResultsDir);
    if (!body) return sendError(reply, 'NOT_FOUND', 'No benchmark has been run yet - try `npm run bench`');
    reply.header('Cache-Control', 'no-cache');
    return body;
  });
}
