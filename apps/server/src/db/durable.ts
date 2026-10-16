import type { FastifyBaseLogger } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Movie } from '@willio/shared';

/**
 * Durable (PostgreSQL via Prisma) write-behind store.
 * The realtime path only enqueues; a background loop flushes in order, batching appends.
 * If the DB is down, writes stay queued (bounded) and are retried - nothing blocks playback.
 */

export interface RoomRecord {
  id: string;
  code: string;
  name: string;
  passwordHash: string | null;
  hostUserId: string | null;
  hostEpoch: number;
  controlMode: 'HOST_ONLY' | 'EVERYONE' | 'VOTE';
  waitPolicy: 'WAIT_FOR_ALL' | 'NEVER_WAIT';
  maxUsers: number;
  currentMediaId: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  closedAt: Date | null;
}

type Op =
  | { t: 'room'; data: RoomRecord }
  | { t: 'user'; data: { id: string; name: string; avatarSeed: string; tasteVector: unknown } }
  | {
      t: 'participant';
      data: { roomId: string; userId: string; role: 'HOST' | 'MOD' | 'VIEWER'; joinedAt: Date; leftAt: Date | null };
    }
  | { t: 'message'; data: Prisma.MessageCreateManyInput }
  | { t: 'reaction'; data: Prisma.ReactionCreateManyInput }
  | { t: 'poll'; data: Prisma.PollUncheckedCreateInput; votes: { userId: string; optionId: string }[] }
  | { t: 'queue'; roomId: string; items: Prisma.QueueItemCreateManyInput[] }
  | { t: 'sync'; data: Prisma.SyncSampleCreateManyInput }
  | { t: 'prop'; data: Prisma.PropagationSampleCreateManyInput };

type AppendType = 'message' | 'reaction' | 'sync' | 'prop';
const APPEND: ReadonlySet<Op['t']> = new Set<Op['t']>(['message', 'reaction', 'sync', 'prop']);
const MAX_QUEUE = 20000;

export interface DurableStore {
  readonly enabled: boolean;
  room(r: RoomRecord): void;
  user(u: { id: string; name: string; avatarSeed: string; tasteVector: unknown }): void;
  participant(p: { roomId: string; userId: string; role: 'HOST' | 'MOD' | 'VIEWER'; joinedAt: Date; leftAt: Date | null }): void;
  message(m: { id: string; roomId: string; userId: string | null; text: string; videoTs: number | null; system: boolean; createdAt: Date }): void;
  reaction(r: { roomId: string; userId: string; mediaId: string; emoji: string; videoTs: number; createdAt: Date }): void;
  poll(
    p: {
      id: string;
      roomId: string;
      creatorId: string | null;
      question: string;
      type: 'GENERIC' | 'NEXT_MOVIE' | 'SKIP_TO' | 'PAUSE_BREAK' | 'CONTROL';
      options: unknown;
      anonymous: boolean;
      endsAt: Date;
      status: 'OPEN' | 'CLOSED';
      result: unknown;
    },
    votes: { userId: string; optionId: string }[],
  ): void;
  queue(roomId: string, items: Prisma.QueueItemCreateManyInput[]): void;
  syncSample(s: { roomId: string; userId: string; rttMs: number; offsetMs: number; driftMs: number; mode: string }): void;
  propagation(s: { roomId: string; seq: number; action: string; users: number; p50: number; p95: number; max: number }): void;
  benchRun(r: { id: string; scenario: string; users: number; durationS: number; conditions: unknown; results: unknown }): Promise<void>;
  seedMovies(movies: Movie[]): Promise<number>;
  heatAggregates(): Promise<{ mediaId: string; bin: number; count: number }[]>;
  pending(): number;
  healthy(): boolean;
  close(): Promise<void>;
}

export class NoopDurable implements DurableStore {
  readonly enabled = false;
  room(): void {}
  user(): void {}
  participant(): void {}
  message(): void {}
  reaction(): void {}
  poll(): void {}
  queue(): void {}
  syncSample(): void {}
  propagation(): void {}
  async benchRun(): Promise<void> {}
  async seedMovies(): Promise<number> {
    return 0;
  }
  async heatAggregates(): Promise<{ mediaId: string; bin: number; count: number }[]> {
    return [];
  }
  pending(): number {
    return 0;
  }
  healthy(): boolean {
    return false;
  }
  async close(): Promise<void> {}
}

const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

function isRetryable(err: unknown): boolean {
  const e = err as { name?: string; code?: string; errorCode?: string };
  if (e?.name === 'PrismaClientInitializationError' || e?.name === 'PrismaClientRustPanicError') return true;
  const code = e?.code ?? e?.errorCode;
  return typeof code === 'string' && code.startsWith('P1');
}

export class PrismaDurable implements DurableStore {
  readonly enabled = true;
  private ops: Op[] = [];
  private timer: NodeJS.Timeout;
  private flushing = false;
  private ok = false;
  private backoffUntil = 0;

  private constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.timer = setInterval(() => void this.flush(), 1000);
    this.timer.unref();
  }

  static async create(url: string, log: FastifyBaseLogger): Promise<PrismaDurable> {
    const mod = (await import('@prisma/client')) as unknown as {
      PrismaClient?: new (o: object) => PrismaClient;
      default?: { PrismaClient: new (o: object) => PrismaClient };
    };
    const Ctor = mod.PrismaClient ?? mod.default?.PrismaClient;
    if (!Ctor) throw new Error('@prisma/client is not generated - run `npm run db:generate`');
    const db = new Ctor({ datasources: { db: { url } } });
    const store = new PrismaDurable(db, log);
    try {
      await db.$connect();
      store.ok = true;
      log.info('postgres connected');
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'postgres unavailable - writes will be queued and retried');
    }
    return store;
  }

  private push(op: Op): void {
    this.ops.push(op);
    if (this.ops.length > MAX_QUEUE) {
      // Drop the oldest append-only rows first; keep structural rows (rooms/users/polls).
      const idx = this.ops.findIndex((o) => APPEND.has(o.t));
      this.ops.splice(idx >= 0 ? idx : 0, 1);
    }
  }

  room(r: RoomRecord): void {
    // Collapse repeated room upserts still waiting in the queue.
    const i = this.ops.findIndex((o) => o.t === 'room' && o.data.id === r.id);
    if (i >= 0) this.ops[i] = { t: 'room', data: r };
    else this.push({ t: 'room', data: r });
  }
  user(u: { id: string; name: string; avatarSeed: string; tasteVector: unknown }): void {
    this.push({ t: 'user', data: u });
  }
  participant(p: { roomId: string; userId: string; role: 'HOST' | 'MOD' | 'VIEWER'; joinedAt: Date; leftAt: Date | null }): void {
    this.push({ t: 'participant', data: p });
  }
  message(m: { id: string; roomId: string; userId: string | null; text: string; videoTs: number | null; system: boolean; createdAt: Date }): void {
    this.push({ t: 'message', data: m });
  }
  reaction(r: { roomId: string; userId: string; mediaId: string; emoji: string; videoTs: number; createdAt: Date }): void {
    this.push({ t: 'reaction', data: r });
  }
  poll(
    p: {
      id: string;
      roomId: string;
      creatorId: string | null;
      question: string;
      type: 'GENERIC' | 'NEXT_MOVIE' | 'SKIP_TO' | 'PAUSE_BREAK' | 'CONTROL';
      options: unknown;
      anonymous: boolean;
      endsAt: Date;
      status: 'OPEN' | 'CLOSED';
      result: unknown;
    },
    votes: { userId: string; optionId: string }[],
  ): void {
    this.push({
      t: 'poll',
      data: { ...p, options: json(p.options), result: p.result == null ? undefined : json(p.result) },
      votes,
    });
  }
  queue(roomId: string, items: Prisma.QueueItemCreateManyInput[]): void {
    const i = this.ops.findIndex((o) => o.t === 'queue' && o.roomId === roomId);
    if (i >= 0) this.ops.splice(i, 1);
    this.push({ t: 'queue', roomId, items });
  }
  syncSample(s: { roomId: string; userId: string; rttMs: number; offsetMs: number; driftMs: number; mode: string }): void {
    this.push({ t: 'sync', data: s });
  }
  propagation(s: { roomId: string; seq: number; action: string; users: number; p50: number; p95: number; max: number }): void {
    this.push({ t: 'prop', data: s });
  }

  async benchRun(r: { id: string; scenario: string; users: number; durationS: number; conditions: unknown; results: unknown }): Promise<void> {
    try {
      await this.db.benchRun.upsert({
        where: { id: r.id },
        create: { ...r, conditions: json(r.conditions), results: json(r.results) },
        update: { conditions: json(r.conditions), results: json(r.results) },
      });
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'bench run insert failed');
    }
  }

  async seedMovies(movies: Movie[]): Promise<number> {
    try {
      const count = await this.db.movie.count();
      if (count > 0) return 0;
      const res = await this.db.movie.createMany({
        data: movies.map((m) => ({ ...m, streamType: m.streamType ?? null })),
        skipDuplicates: true,
      });
      this.ok = true;
      return res.count;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'movie seed skipped');
      return 0;
    }
  }

  async heatAggregates(): Promise<{ mediaId: string; bin: number; count: number }[]> {
    try {
      const rows = await this.db.$queryRaw<{ mediaId: string; bin: number; count: number }[]>`
        SELECT "mediaId", floor("videoTs" / 5)::int AS bin, count(*)::int AS count
        FROM "Reaction" GROUP BY 1, 2`;
      return rows;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'heat aggregate query failed');
      return [];
    }
  }

  pending(): number {
    return this.ops.length;
  }
  healthy(): boolean {
    return this.ok;
  }

  private async exec(op: Op | { t: AppendType; batch: Op[] }): Promise<void> {
    const db = this.db;
    if ('batch' in op) {
      const rows = op.batch.map((o) => (o as { data: unknown }).data);
      if (op.t === 'message') await db.message.createMany({ data: rows as Prisma.MessageCreateManyInput[], skipDuplicates: true });
      else if (op.t === 'reaction') await db.reaction.createMany({ data: rows as Prisma.ReactionCreateManyInput[] });
      else if (op.t === 'sync') await db.syncSample.createMany({ data: rows as Prisma.SyncSampleCreateManyInput[] });
      else await db.propagationSample.createMany({ data: rows as Prisma.PropagationSampleCreateManyInput[] });
      return;
    }
    switch (op.t) {
      case 'room': {
        const { id, ...rest } = op.data;
        await db.room.upsert({ where: { id }, create: op.data, update: rest });
        return;
      }
      case 'user': {
        const d = { ...op.data, tasteVector: op.data.tasteVector == null ? undefined : json(op.data.tasteVector) };
        await db.user.upsert({ where: { id: d.id }, create: d, update: { name: d.name, avatarSeed: d.avatarSeed, tasteVector: d.tasteVector } });
        return;
      }
      case 'participant': {
        const d = op.data;
        await db.participant.upsert({
          where: { roomId_userId: { roomId: d.roomId, userId: d.userId } },
          create: d,
          update: { role: d.role, leftAt: d.leftAt },
        });
        return;
      }
      case 'poll': {
        const { id, ...rest } = op.data;
        await db.poll.upsert({ where: { id }, create: op.data, update: rest });
        if (op.votes.length > 0) {
          await db.pollVote.createMany({ data: op.votes.map((v) => ({ pollId: id, ...v })), skipDuplicates: true });
        }
        return;
      }
      case 'queue': {
        await db.$transaction([
          db.queueItem.deleteMany({ where: { roomId: op.roomId } }),
          db.queueItem.createMany({ data: op.items }),
        ]);
        return;
      }
      default:
        return;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.ops.length === 0 || Date.now() < this.backoffUntil) return;
    this.flushing = true;
    try {
      while (this.ops.length > 0) {
        const first = this.ops[0]!;
        let unit: Op | { t: AppendType; batch: Op[] } = first;
        let take = 1;
        if (APPEND.has(first.t)) {
          while (take < this.ops.length && take < 500 && this.ops[take]!.t === first.t) take++;
          unit = { t: first.t as AppendType, batch: this.ops.slice(0, take) };
        }
        try {
          await this.exec(unit);
          this.ops.splice(0, take);
          if (!this.ok) this.log.info('postgres reachable again - flushing queued writes');
          this.ok = true;
        } catch (err) {
          if (isRetryable(err)) {
            if (this.ok) this.log.warn({ err: (err as Error).message }, 'postgres down - queueing writes');
            this.ok = false;
            this.backoffUntil = Date.now() + 5000;
            return;
          }
          // Constraint / validation error: drop the offending unit, keep going.
          this.log.warn({ err: (err as Error).message, op: first.t }, 'dropping durable write');
          this.ops.splice(0, take);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    this.backoffUntil = 0;
    try {
      await Promise.race([this.flush(), new Promise((r) => setTimeout(r, 3000))]);
    } finally {
      await this.db.$disconnect().catch(() => undefined);
    }
  }
}
