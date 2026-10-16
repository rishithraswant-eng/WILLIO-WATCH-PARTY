import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  C2S,
  S2C,
  SOCKET_NAMESPACE,
  SYNC,
  uuid,
  type JoinAck,
  type Snapshot,
  type StateUpdate,
} from '@blockparty/shared';
import { loadConfig } from '../config';
import { MemoryKv } from '../db/kv';
import { createServer, type RunningServer } from '../server';

const kv = new MemoryKv();
let server: RunningServer;
const sockets: Socket[] = [];

async function boot(): Promise<RunningServer> {
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT_SERVER: '0',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    SEED_DEMO_ROOM: 'false',
    RATE_LIMIT_REST: 'false',
  } as NodeJS.ProcessEnv);
  return createServer(config, { kv, logger: false });
}

beforeAll(async () => {
  server = await boot();
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

afterAll(async () => {
  await server.close();
});

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

interface Client {
  socket: Socket;
  userId: string;
  token: string;
  emit<T = Record<string, unknown>>(event: string, payload?: unknown): Promise<T & { ok: boolean; error?: { code: string } }>;
  next<T>(event: string, pred?: (p: T) => boolean, timeoutMs?: number): Promise<T>;
  events: { event: string; payload: unknown }[];
}

function wrap(socket: Socket, userId: string, token: string): Client {
  const events: { event: string; payload: unknown }[] = [];
  socket.onAny((event: string, payload: unknown) => events.push({ event, payload }));
  return {
    socket,
    userId,
    token,
    events,
    emit: (event, payload) =>
      new Promise((resolve) => {
        if (payload === undefined) socket.emit(event, resolve);
        else socket.emit(event, payload, resolve);
      }),
    next: <T>(event: string, pred?: (p: T) => boolean, timeoutMs = 5000) =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => {
          socket.off(event, handler);
          reject(new Error(`timeout waiting for ${event}`));
        }, timeoutMs);
        const handler = (p: T) => {
          if (pred && !pred(p)) return;
          clearTimeout(t);
          socket.off(event, handler);
          resolve(p);
        };
        socket.on(event, handler);
      }),
  };
}

async function openSocket(token: string): Promise<Socket> {
  const socket = connect(`${server.url}${SOCKET_NAMESPACE}`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

async function createRoom(name = 'Host', extra: Record<string, unknown> = {}) {
  const r = await post<{ code: string; token: string; userId: string }>('/api/rooms', { name, avatarSeed: 'seed', ...extra });
  expect(r.status).toBe(201);
  return r.body;
}

async function joinAs(code: string, name: string, token?: string, lastEseq?: number, bootId?: string) {
  let tok = token;
  let userId = '';
  if (!tok) {
    const r = await post<{ token: string; userId: string }>(`/api/rooms/${code}/join`, { name, avatarSeed: name });
    expect(r.status).toBe(200);
    tok = r.body.token;
    userId = r.body.userId;
  }
  const socket = await openSocket(tok);
  const client = wrap(socket, userId, tok);
  const ack = (await client.emit(C2S.ROOM_JOIN, { code, lastEseq, bootId })) as unknown as JoinAck;
  expect(ack.ok).toBe(true);
  if (ack.ok && ack.mode === 'snapshot') client.userId = ack.snapshot.me.id;
  if (ack.ok && ack.mode === 'replay') client.userId = ack.me.id;
  return { client, ack };
}

const snap = (ack: JoinAck): Snapshot => {
  if (!ack.ok || ack.mode !== 'snapshot') throw new Error('expected snapshot');
  return ack.snapshot;
};

async function roomWithMedia(controlMode?: string) {
  const created = await createRoom('Host', controlMode ? { controlMode } : {});
  const host = await joinAs(created.code, 'Host', created.token);
  const add = await host.client.emit(C2S.QUEUE_ADD, { movieId: 'open-sintel' });
  expect(add.ok).toBe(true);
  return { code: created.code, host: host.client };
}

describe('REST', () => {
  it('health, catalog search and typo tolerance', async () => {
    const health = (await (await fetch(`${server.url}/api/health`)).json()) as { ok: boolean; catalog: number };
    expect(health.ok).toBe(true);
    expect(health.catalog).toBeGreaterThanOrEqual(300);
    const search = (await (await fetch(`${server.url}/api/movies?q=intersteller`)).json()) as { items: { title: string }[] };
    expect(search.items[0]?.title).toBe('Interstellar');
    const filtered = (await (await fetch(`${server.url}/api/movies?genres=Horror&yearMin=2015&ratingMin=7`)).json()) as {
      items: { genres: string[]; year: number; rating: number }[];
    };
    expect(filtered.items.length).toBeGreaterThan(0);
    for (const m of filtered.items) {
      expect(m.genres).toContain('Horror');
      expect(m.year).toBeGreaterThanOrEqual(2015);
      expect(m.rating).toBeGreaterThanOrEqual(7);
    }
  });

  it('rejects unknown rooms and bad passwords', async () => {
    expect((await fetch(`${server.url}/api/rooms/ZZZZZZ`)).status).toBe(404);
    const { code } = await createRoom('Locked', { password: 'hunter22' });
    const bad = await post(`/api/rooms/${code}/join`, { name: 'Eve', avatarSeed: 'e', password: 'nope' });
    expect(bad.status).toBe(401);
    const good = await post(`/api/rooms/${code}/join`, { name: 'Bob', avatarSeed: 'b', password: 'hunter22' });
    expect(good.status).toBe(200);
  });

  it('rejects sockets without a valid token', async () => {
    const socket = connect(`${server.url}${SOCKET_NAMESPACE}`, { transports: ['websocket'], auth: { token: 'junk' }, reconnection: false, forceNew: true });
    sockets.push(socket);
    const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
  });
});

describe('rooms & sync protocol', () => {
  it('late joiner receives a full snapshot with state, queue and participants', async () => {
    const { code, host } = await roomWithMedia();
    await host.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 0 });
    const { ack } = await joinAs(code, 'Late');
    const s = snap(ack);
    expect(s.state.media?.id).toBe('open-sintel');
    expect(s.state.status).toBe('PLAYING');
    expect(s.participants.map((p) => p.name).sort()).toEqual(['Host', 'Late']);
    expect(s.room.hostId).toBe(host.userId);
    expect(Math.abs(s.serverNow - Date.now())).toBeLessThan(1000);
  });

  it('broadcasts one total order under concurrent actions from 3 users', async () => {
    const { code, host } = await roomWithMedia('EVERYONE');
    const a = (await joinAs(code, 'A')).client;
    const b = (await joinAs(code, 'B')).client;
    const all = [host, a, b];
    const seen: number[][] = all.map(() => []);
    all.forEach((c, i) => c.socket.on(S2C.STATE_UPDATE, (u: StateUpdate) => seen[i]!.push(u.seq)));
    await Promise.all([
      host.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 1 }),
      a.emit(C2S.SEEK, { eventId: uuid(), baseSeq: 1, pos: 120 }),
      b.emit(C2S.PAUSE, { eventId: uuid(), baseSeq: 1 }),
      a.emit(C2S.SEEK, { eventId: uuid(), baseSeq: 1, pos: 30 }),
      b.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 1 }),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen[0]!.length).toBe(5);
    for (const s of seen) {
      expect(s).toEqual(seen[0]);
      expect([...s].sort((x, y) => x - y)).toEqual(s);
    }
    const room = server.manager.get(code)!;
    expect(room.state.seq).toBe(seen[0]![4]);
  });

  it('is idempotent for retried events (dedupe by eventId)', async () => {
    const { host } = await roomWithMedia();
    const eventId = uuid();
    const first = await host.emit<{ seq: number }>(C2S.PLAY, { eventId, baseSeq: 1 });
    const retry = await host.emit<{ seq: number; duplicate: boolean }>(C2S.PLAY, { eventId, baseSeq: 1 });
    expect(first.ok && retry.ok).toBe(true);
    expect(retry.seq).toBe(first.seq);
    expect(retry.duplicate).toBe(true);
  });

  it('enforces host-only control and creates a vote in VOTE mode', async () => {
    const { code } = await roomWithMedia('HOST_ONLY');
    const viewer = (await joinAs(code, 'Viewer')).client;
    const denied = await viewer.emit(C2S.PAUSE, { eventId: uuid(), baseSeq: 1 });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('FORBIDDEN');

    const voteRoom = await roomWithMedia('VOTE');
    const v2 = (await joinAs(voteRoom.code, 'Voter')).client;
    const pollP = voteRoom.host.next<{ poll: { type: string; question: string } }>(S2C.POLL_UPDATE);
    const res = await v2.emit<{ vote: boolean }>(C2S.SEEK, { eventId: uuid(), baseSeq: 1, pos: 60 });
    expect(res.ok).toBe(true);
    expect(res.vote).toBe(true);
    const { poll } = await pollP;
    expect(poll.type).toBe('CONTROL');
    expect(poll.question).toContain('seek to 1:00');
  });

  it('schedules state updates ahead of time with an adaptive lead', async () => {
    const { host } = await roomWithMedia();
    const upd = host.next<StateUpdate>(S2C.STATE_UPDATE);
    await host.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 1 });
    const u = await upd;
    expect(u.scheduledAt - u.serverTs).toBeGreaterThanOrEqual(SYNC.leadMinMs - 5);
    expect(u.scheduledAt - u.serverTs).toBeLessThanOrEqual(SYNC.leadMaxMs);
    expect(u.state.anchorTime).toBe(u.scheduledAt);
  });

  it('records propagation latency from client acks', async () => {
    const { code, host } = await roomWithMedia();
    const u = host.next<StateUpdate>(S2C.STATE_UPDATE);
    await host.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 1 });
    const update = await u;
    await host.emit(C2S.SYNC_ACK, { seq: update.seq, recvServerTs: Date.now(), appliedAt: Date.now() });
    const summary = server.manager.get(code)!.metrics.summary();
    expect(summary.samples).toBe(1);
    expect(summary.p95).not.toBeNull();
  });

  it('replays missed events after a reconnect', async () => {
    const { code, host } = await roomWithMedia('EVERYONE');
    const { client: c, ack } = await joinAs(code, 'Flaky');
    const s = snap(ack);
    const token = c.token;
    c.socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    await host.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 1 });
    await host.emit(C2S.CHAT_SEND, { id: uuid(), text: 'you missed this' });
    const again = await joinAs(code, 'Flaky', token, s.eseq, s.bootId);
    const a = again.ack;
    expect(a.ok && a.mode).toBe('replay');
    if (a.ok && a.mode === 'replay') {
      const names = a.events.map((e) => e.event);
      expect(names).toContain(S2C.STATE_UPDATE);
      expect(names).toContain(S2C.CHAT_MSG);
      expect(a.events.every((e, i) => i === 0 || e.eseq === a.events[i - 1]!.eseq + 1)).toBe(true);
    }
  });

  it('latest tab wins for the same session token', async () => {
    const created = await createRoom('Twin');
    const first = await joinAs(created.code, 'Twin', created.token);
    const replaced = first.client.next(S2C.SESSION_REPLACED);
    await joinAs(created.code, 'Twin', created.token);
    await replaced;
  });

  it('dedupes chat retries and runs /poll', async () => {
    const { host } = await roomWithMedia();
    const id = uuid();
    const m1 = await host.emit<{ id: string }>(C2S.CHAT_SEND, { id, text: 'hello <b>world</b>' });
    const m2 = await host.emit<{ id: string }>(C2S.CHAT_SEND, { id, text: 'hello <b>world</b>' });
    expect(m2.id).toBe(m1.id);
    const pollP = host.next<{ poll: { question: string; options: { label: string }[] } }>(S2C.POLL_UPDATE);
    await host.emit(C2S.CHAT_SEND, { id: uuid(), text: '/poll "Snack break?" yes | no' });
    const { poll } = await pollP;
    expect(poll.question).toBe('Snack break?');
    expect(poll.options.map((o) => o.label)).toEqual(['yes', 'no']);
  });

  it('aggregates a reaction flood into one burst per window', async () => {
    const { code, host } = await roomWithMedia();
    const other = (await joinAs(code, 'Watcher')).client;
    const burst = other.next<{ bursts: { emoji: string; count: number }[] }>(S2C.REACTION_BURST);
    for (let i = 0; i < 5; i++) void host.emit(C2S.REACTION_SEND, { emoji: '🔥' });
    const b = await burst;
    expect(b.bursts).toEqual([expect.objectContaining({ emoji: '🔥', count: 5 })]);
  });

  it('queue: add, vote bubbles up, reorder with fractional keys', async () => {
    const { code, host } = await roomWithMedia();
    await host.emit(C2S.QUEUE_ADD, { movieId: 'open-tos' });
    await host.emit(C2S.QUEUE_ADD, { movieId: 'open-ed' });
    await host.emit(C2S.QUEUE_ADD, { url: 'https://example.com/films/my_home_movie.mp4' });
    const room = server.manager.get(code)!;
    let items = room.queueState().items;
    expect(items.map((i) => i.title)).toEqual(['Tears of Steel', 'Elephants Dream', 'my home movie']);
    const viewer = (await joinAs(code, 'Fan')).client;
    await viewer.emit(C2S.QUEUE_VOTE, { itemId: items[2]!.id });
    items = room.queueState().items;
    expect(items[0]!.title).toBe('my home movie');
    const r = await host.emit(C2S.QUEUE_REORDER, { itemId: items[0]!.id, afterId: items[2]!.id, beforeId: null, version: 0 });
    expect(r.ok).toBe(true);
    expect(room.queueState().items[2]!.title).toBe('my home movie');
    const dup = await host.emit(C2S.QUEUE_ADD, { movieId: 'open-tos' });
    expect(dup.error?.code).toBe('CONFLICT');
    const notFree = await host.emit(C2S.QUEUE_ADD, { movieId: 'bp-interstellar-2014' });
    expect(notFree.error?.code).toBe('INVALID');
  });

  it('polls: one vote per user, changeable, winner decided on close', async () => {
    const { code, host } = await roomWithMedia();
    const v = (await joinAs(code, 'V')).client;
    const created = await host.emit<{ pollId: string }>(C2S.POLL_CREATE, {
      question: 'Next?',
      options: [{ label: 'A' }, { label: 'B' }],
      durationSec: 30,
      anonymous: false,
      type: 'GENERIC',
    });
    expect(created.ok).toBe(true);
    await v.emit(C2S.POLL_VOTE, { pollId: created.pollId, optionId: 'o1' });
    await v.emit(C2S.POLL_VOTE, { pollId: created.pollId, optionId: 'o2' });
    await host.emit(C2S.POLL_VOTE, { pollId: created.pollId, optionId: 'o2' });
    const closed = host.next<{ poll: { status: string; counts: Record<string, number>; result: { winnerId: string } } }>(S2C.POLL_CLOSED);
    await host.emit(C2S.POLL_CLOSE, { pollId: created.pollId });
    const { poll } = await closed;
    expect(poll.status).toBe('CLOSED');
    expect(poll.counts).toEqual({ o1: 0, o2: 2 });
    expect(poll.result.winnerId).toBe('o2');
  });

  it('manual host transfer is atomic and announced', async () => {
    const created = await createRoom('Crown');
    const host = (await joinAs(created.code, 'Crown', created.token)).client;
    const heir = (await joinAs(created.code, 'Heir')).client;
    const changed = heir.next<{ newId: string; reason: string }>(S2C.HOST_CHANGED);
    const r = await host.emit(C2S.HOST_TRANSFER, { toUserId: heir.userId });
    expect(r.ok).toBe(true);
    const c = await changed;
    expect(c.newId).toBe(heir.userId);
    expect(c.reason).toBe('transfer');
    const denied = await host.emit(C2S.HOST_TRANSFER, { toUserId: heir.userId });
    expect(denied.error?.code).toBe('FORBIDDEN');
  });

  it(
    'automatic host succession after the grace period',
    async () => {
      const created = await createRoom('Leaver');
      const host = (await joinAs(created.code, 'Leaver', created.token)).client;
      const first = (await joinAs(created.code, 'First')).client;
      await new Promise((r) => setTimeout(r, 20));
      await joinAs(created.code, 'Second');
      const changed = first.next<{ newId: string; reason: string }>(S2C.HOST_CHANGED, undefined, SYNC.hostGraceMs + 4000);
      const t0 = Date.now();
      host.socket.disconnect();
      const c = await changed;
      const elapsed = Date.now() - t0;
      expect(c.newId).toBe(first.userId);
      expect(c.reason).toBe('succession');
      expect(elapsed).toBeGreaterThanOrEqual(SYNC.hostGraceMs - 100);
      expect(elapsed).toBeLessThan(SYNC.hostGraceMs + 2000);
    },
    SYNC.hostGraceMs + 8000,
  );

  it('restores rooms from the snapshot store after a server restart', async () => {
    const { code, host } = await roomWithMedia();
    await host.emit(C2S.PLAY, { eventId: uuid(), baseSeq: 1 });
    await host.emit(C2S.CHAT_SEND, { id: uuid(), text: 'before the crash' });
    const seqBefore = server.manager.get(code)!.state.seq;
    const token = host.token;
    for (const s of sockets.splice(0)) s.disconnect();
    await server.close();
    server = await boot();
    const room = server.manager.get(code);
    expect(room).toBeDefined();
    expect(room!.state.seq).toBe(seqBefore);
    expect(room!.state.status).toBe('PLAYING');
    const back = await joinAs(code, 'Host', token, 999, 'old-boot-id');
    const s = snap(back.ack);
    expect(s.chatTail.some((m) => m.text === 'before the crash')).toBe(true);
    expect(s.me.role).toBe('HOST');
  });
});
