import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { FastifyBaseLogger } from 'fastify';
import type { ZodType, ZodTypeDef } from 'zod';
import {
  C2S,
  SOCKET_NAMESPACE,
  bufferingSchema,
  chaosSchema,
  chatSendSchema,
  durationSchema,
  endedSchema,
  hostRespondSchema,
  hostTransferSchema,
  intermissionSchema,
  joinEventSchema,
  loadMovieSchema,
  metricsSubSchema,
  pauseSchema,
  pingSchema,
  playSchema,
  pollCloseSchema,
  pollCreateSchema,
  pollVoteSchema,
  queueAddSchema,
  queueItemSchema,
  queueReorderSchema,
  rateSchema,
  reactionSchema,
  replaySchema,
  roleSetSchema,
  seekSchema,
  settingsSchema,
  syncAckSchema,
  telemetrySchema,
  typingSchema,
  type AckError,
  type ErrorCode,
  type RateLimitKey,
} from '@blockparty/shared';
import type { TokenService } from '../auth/token';
import type { Room } from '../rooms/Room';
import type { RoomManager } from '../rooms/RoomManager';
import { RoomError, type RoomIO, type SessionUser } from '../rooms/types';
import type { RateLimiter } from '../util/rateLimiter';

interface SocketData {
  user: SessionUser;
  tokenCode: string;
  joinedCode: string | null;
}
type BPSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;
type AckFn = (payload: unknown) => void;

export interface SocketLayerOptions {
  manager: RoomManager;
  tokens: TokenService;
  limiter: RateLimiter;
  log: FastifyBaseLogger;
  isAllowedOrigin(origin: string | undefined): boolean;
}

const fail = (code: ErrorCode, message: string): AckError => ({ ok: false, error: { code, message } });

function toAckError(err: unknown, log: FastifyBaseLogger): AckError {
  if (err instanceof RoomError) return fail(err.code, err.message);
  log.error({ err }, 'socket handler crashed');
  return fail('INTERNAL', 'Something went wrong on our side');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function attachSocketServer(httpServer: HttpServer, opts: SocketLayerOptions) {
  const { manager, tokens, limiter, log } = opts;
  const io = new Server(httpServer, {
    transports: ['websocket'],
    serveClient: false,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 64 * 1024,
    // WebSocket upgrades are not covered by CORS: enforce the origin allowlist here.
    allowRequest: (req, cb) => cb(null, opts.isAllowedOrigin(req.headers.origin)),
  });
  const nsp = io.of(SOCKET_NAMESPACE);

  const roomIO: RoomIO = {
    toRoom(code, event, payload, except) {
      if (except && except.length > 0) nsp.to(code).except(except).emit(event, payload);
      else nsp.to(code).emit(event, payload);
    },
    toSocket(socketId, event, payload) {
      nsp.to(socketId).emit(event, payload);
    },
    toMetrics(code, event, payload) {
      nsp.to(`${code}#metrics`).emit(event, payload);
    },
    hasMetricsSubscribers(code) {
      return (nsp.adapter.rooms.get(`${code}#metrics`)?.size ?? 0) > 0;
    },
    disconnect(socketId, mode) {
      const s = nsp.sockets.get(socketId);
      if (!s) return;
      if (mode === 'replaced') s.disconnect(true);
      // Closing the transport looks like a network drop: the client auto-reconnects.
      else s.conn.close();
    },
  };
  manager.attachIO(roomIO);

  nsp.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    tokens
      .verify(typeof token === 'string' ? token : null)
      .then((claims) => {
        if (!claims) return next(new Error('UNAUTHORIZED'));
        const s = socket as unknown as BPSocket;
        s.data.user = { id: claims.uid, name: claims.name, seed: claims.seed };
        s.data.tokenCode = claims.code;
        s.data.joinedCode = null;
        next();
      })
      .catch(() => next(new Error('UNAUTHORIZED')));
  });

  nsp.on('connection', (raw) => {
    const socket = raw as unknown as BPSocket;
    const userId = socket.data.user.id;

    const room = (): Room | undefined => (socket.data.joinedCode ? manager.get(socket.data.joinedCode) : undefined);

    /** Ack, delayed by the injected one-way latency when Chaos Mode targets this user. */
    const replier = (ack: AckFn | null) => (payload: unknown) => {
      if (!ack) return;
      const delay = room()?.chaosOneWayMs(userId) ?? 0;
      if (delay > 0) setTimeout(() => ack(payload), delay);
      else ack(payload);
    };

    function on<T>(
      event: string,
      schema: ZodType<T, ZodTypeDef, unknown> | null,
      rateKey: RateLimitKey | null,
      queued: boolean,
      handler: (r: Room, data: T) => unknown,
    ): void {
      socket.on(event as never, (async (rawData: unknown, maybeAck?: unknown) => {
        const ack = typeof maybeAck === 'function' ? (maybeAck as AckFn) : typeof rawData === 'function' ? (rawData as AckFn) : null;
        const reply = replier(ack);
        try {
          const r = room();
          if (!r) return reply(fail('UNAUTHORIZED', 'Join a room first'));
          const inbound = r.chaosOneWayMs(userId);
          if (inbound > 0) await sleep(inbound);
          if (rateKey && !limiter.hit(userId, rateKey)) return reply(fail('RATE_LIMITED', 'Whoa, slow down a little'));
          let data = undefined as T;
          if (schema) {
            const parsed = schema.safeParse(typeof rawData === 'function' ? undefined : rawData);
            if (!parsed.success) return reply(fail('INVALID', parsed.error.issues[0]?.message ?? 'Invalid request'));
            data = parsed.data;
          }
          const result = queued ? await r.enqueue(() => handler(r, data)) : await handler(r, data);
          reply({ ok: true, ...(result && typeof result === 'object' ? result : {}) });
        } catch (err) {
          reply(toAckError(err, log));
        }
      }) as never);
    }

    // ---- join (also used on every reconnect) ----
    socket.on(C2S.ROOM_JOIN as never, (async (rawData: unknown, maybeAck?: unknown) => {
      const reply = replier(typeof maybeAck === 'function' ? (maybeAck as AckFn) : null);
      try {
        if (!limiter.hit(userId, 'misc')) return reply(fail('RATE_LIMITED', 'Too many join attempts'));
        const parsed = joinEventSchema.safeParse(rawData);
        if (!parsed.success) return reply(fail('INVALID', parsed.error.issues[0]?.message ?? 'Invalid join'));
        const { code, lastEseq, bootId, tasteVector } = parsed.data;
        if (code !== socket.data.tokenCode) return reply(fail('UNAUTHORIZED', 'Your session is for a different room'));
        const r = manager.get(code);
        if (!r) return reply(fail('NOT_FOUND', 'This room does not exist (or expired)'));
        const result = await r.enqueue(() => {
          if (!socket.connected) throw new RoomError('UNAUTHORIZED', 'Socket closed');
          const res = r.join(socket.data.user, socket.id, tasteVector, lastEseq, bootId);
          // Join the broadcast room only after the snapshot/replay was built: nothing can slip in between.
          void socket.join(code);
          socket.data.joinedCode = code;
          return res;
        });
        reply(result);
      } catch (err) {
        reply(toAckError(err, log));
      }
    }) as never);

    // ---- clock sync (hot path, not queued) ----
    socket.on(C2S.TIME_PING as never, (async (rawData: unknown, maybeAck?: unknown) => {
      if (typeof maybeAck !== 'function') return;
      const reply = replier(maybeAck as AckFn);
      const r = room();
      const inbound = r?.chaosOneWayMs(userId) ?? 0;
      if (inbound > 0) await sleep(inbound);
      if (!limiter.hit(userId, 'time:ping')) return reply(fail('RATE_LIMITED', 'ping flood'));
      const parsed = pingSchema.safeParse(rawData);
      if (!parsed.success) return reply(fail('INVALID', 'bad ping'));
      reply({ ok: true, t0: parsed.data.t0, ts: Date.now(), eseq: r?.eseq ?? 0, seq: r?.state.seq ?? 0 });
    }) as never);

    // ---- playback ----
    on(C2S.PLAY, playSchema, 'playback', true, (r, d) => r.playback(userId, socket.id, 'play', d));
    on(C2S.PAUSE, pauseSchema, 'playback', true, (r, d) => r.playback(userId, socket.id, 'pause', d));
    on(C2S.SEEK, seekSchema, 'playback', true, (r, d) => r.playback(userId, socket.id, 'seek', d));
    on(C2S.RATE, rateSchema, 'playback', true, (r, d) => r.playback(userId, socket.id, 'rate', d));
    on(C2S.LOAD, loadMovieSchema, 'playback', true, (r, d) => r.playMovie(userId, d.movieId));
    on(C2S.BUFFERING, bufferingSchema, 'playback:buffering', true, (r, d) => r.buffering(userId, socket.id, d.state));
    on(C2S.ENDED, endedSchema, 'misc', true, (r, d) => r.ended(userId, d.mediaId));
    on(C2S.MEDIA_DURATION, durationSchema, 'misc', true, (r, d) => r.setDuration(d.mediaId, d.duration));

    // ---- sync telemetry / recovery ----
    on(C2S.TELEMETRY, telemetrySchema, 'telemetry', false, (r, d) => r.telemetry(userId, d));
    on(C2S.SYNC_ACK, syncAckSchema, 'sync:ack', false, (r, d) => r.syncAck(userId, d.seq, d.recvServerTs));
    on(C2S.SYNC_REPLAY, replaySchema, 'misc', true, (r, d) => {
      const events = r.replaySince(d.lastEseq, d.bootId);
      return events ? { mode: 'replay', events } : { mode: 'snapshot', snapshot: r.snapshotFor(userId) };
    });
    on(C2S.RESYNC, null, 'misc', true, (r) => ({ snapshot: r.resyncRequested(userId) }));
    on(C2S.METRICS_SUB, metricsSubSchema, 'misc', false, (r, d) => {
      const key = `${r.code}#metrics`;
      if (d.on) void socket.join(key);
      else void socket.leave(key);
      return d.on ? { metrics: r.metricsPayload() } : {};
    });

    // ---- queue ----
    on(C2S.QUEUE_ADD, queueAddSchema, 'queue', true, (r, d) => r.queueAdd(userId, d));
    on(C2S.QUEUE_REMOVE, queueItemSchema, 'queue', true, (r, d) => r.queueRemove(userId, d.itemId));
    on(C2S.QUEUE_REORDER, queueReorderSchema, 'queue', true, (r, d) => r.queueReorder(userId, d.itemId, d.afterId, d.beforeId));
    on(C2S.QUEUE_VOTE, queueItemSchema, 'queue', true, (r, d) => r.queueVote(userId, d.itemId));
    on(C2S.QUEUE_PLAY_NOW, queueItemSchema, 'queue', true, (r, d) => r.queuePlayNow(userId, d.itemId));

    // ---- chat & reactions ----
    on(C2S.CHAT_SEND, chatSendSchema, 'chat:send', true, (r, d) => r.chatSend(userId, socket.id, d.id, d.text));
    on(C2S.CHAT_TYPING, typingSchema, 'chat:typing', false, (r, d) => r.typing(userId, d.on));
    on(C2S.REACTION_SEND, reactionSchema, 'reaction:send', false, (r, d) => r.reaction(userId, d.emoji));

    // ---- polls ----
    on(C2S.POLL_CREATE, pollCreateSchema, 'poll:create', true, (r, d) => r.pollCreate(userId, d));
    on(C2S.POLL_VOTE, pollVoteSchema, 'poll:vote', true, (r, d) => r.pollVote(userId, d.pollId, d.optionId));
    on(C2S.POLL_CLOSE, pollCloseSchema, 'misc', true, (r, d) => r.pollClose(userId, d.pollId));

    // ---- host & roles ----
    on(C2S.HOST_TRANSFER, hostTransferSchema, 'host', true, (r, d) => r.hostTransfer(userId, d.toUserId));
    on(C2S.HOST_REQUEST, null, 'host', true, (r) => r.hostRequest(userId));
    on(C2S.HOST_RESPOND, hostRespondSchema, 'host', true, (r, d) => r.hostRespond(userId, d.userId, d.accept));
    on(C2S.ROLE_SET, roleSetSchema, 'host', true, (r, d) => r.setRole(userId, d.userId, d.role));

    // ---- room ----
    on(C2S.ROOM_SETTINGS, settingsSchema, 'misc', true, (r, d) => r.updateSettings(userId, d));
    on(C2S.CHAOS, chaosSchema, 'chaos', true, (r, d) => r.chaos(userId, d));
    on(C2S.INTERMISSION, intermissionSchema, 'misc', true, (r, d) => r.intermissionSet(userId, d));
    on(C2S.RECOMMEND, null, 'misc', false, (r) => ({ recommendations: r.recommend(12) }));

    socket.on('disconnect', () => {
      const r = room();
      if (!r) return;
      r.enqueue(() => r.disconnect(userId, socket.id)).catch((err: unknown) => log.warn({ err }, 'disconnect handling failed'));
    });
  });

  return {
    io,
    nsp,
    /** Drop every client; the HTTP server itself is closed by Fastify. */
    close(): void {
      nsp.disconnectSockets(true);
      io.engine.close();
    },
  };
}
