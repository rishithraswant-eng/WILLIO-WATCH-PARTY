import { histogram, summarize, type Summary } from '@willio/shared';
import { Bot, type DriftSample, type PropSample } from './bot';
import type { ServerProcess } from './serverProc';

export interface ScenarioContext {
  url: string;
  server: ServerProcess | null;
  users?: number;
  durationS?: number;
  log: (msg: string) => void;
}

export interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

export interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  users: number;
  durationS: number;
  propagation: Summary;
  drift: Summary;
  extra: Record<string, number | string | null>;
  pass: boolean;
  checks: Check[];
  histogram: { from: number; to: number; count: number }[];
  driftSeries: { t: number; p50: number; p95: number; max: number }[];
  raw: { prop: PropSample[]; drift: DriftSample[] };
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  defaultUsers: number;
  defaultDurationS: number;
  needsServerControl?: boolean;
  run(ctx: ScenarioContext, rec: Recorder): Promise<{ extra: Record<string, number | string | null>; checks: Check[] }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Per-bot decoder skew: +-0.4% (real devices drift a few ms per second). */
const skew = () => 1 + (Math.random() - 0.5) * 0.008;

export class Recorder {
  readonly prop: PropSample[] = [];
  readonly drift: DriftSample[] = [];
  readonly startedAt = Date.now();
  bots: Bot[] = [];
}

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

async function createRoom(url: string, hostName: string): Promise<{ code: string; token: string; userId: string }> {
  const res = await fetch(`${url}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: hostName, avatarSeed: hostName, roomName: `bench-${hostName}`, controlMode: 'EVERYONE' }),
  });
  if (!res.ok) throw new Error(`create room failed: ${res.status}`);
  return (await res.json()) as { code: string; token: string; userId: string };
}

/** Room with N bots (bot 0 is the host), media loaded, playing, everyone settled. */
async function setupRoom(ctx: ScenarioContext, rec: Recorder, n: number, opts: { play?: boolean } = {}) {
  const created = await createRoom(ctx.url, 'host-bot');
  const host = new Bot('bot-00', ctx.url, created.code, rec, skew());
  host.useToken(created.token, created.userId);
  await host.connect();
  await host.settings({ controlMode: 'EVERYONE', queueMode: 'EVERYONE' });
  await host.addMovie('open-sintel');
  const bots = [host];
  for (let i = 1; i < n; i++) {
    const b = new Bot(`bot-${String(i).padStart(2, '0')}`, ctx.url, created.code, rec, skew());
    await b.join();
    bots.push(b);
  }
  rec.bots.push(...bots);
  if (opts.play !== false) {
    await host.action('play');
    await sleep(3000);
  }
  return { code: created.code, host, bots };
}

/** Mixed action load: 3 actors fire play/pause/seek every 3-8s, sometimes concurrently. */
async function actionLoad(actors: Bot[], untilTs: number, ctx: ScenarioContext): Promise<number> {
  let actions = 0;
  while (Date.now() < untilTs) {
    await sleep(rand(3000, 8000));
    if (Date.now() >= untilTs) break;
    const roll = Math.random();
    const a = actors[Math.floor(Math.random() * actors.length)]!;
    if (roll < 0.15) {
      // concurrent burst from all actors at the same moment
      await Promise.all(actors.map((x, i) => x.action(i % 2 ? 'seek' : 'play', rand(30, 500))));
      actions += actors.length;
    } else if (roll < 0.35) {
      await a.action('pause');
      await sleep(rand(800, 2000));
      await a.action('play');
      actions += 2;
    } else {
      await a.action('seek', rand(30, 500));
      actions++;
    }
  }
  ctx.log(`  ${actions} control actions issued`);
  return actions;
}

function chatter(bots: Bot[], untilTs: number): void {
  const emojis = ['🔥', '😂', '😮', '👏'];
  const tick = () => {
    if (Date.now() >= untilTs) return;
    const b = bots[Math.floor(Math.random() * bots.length)]!;
    if (Math.random() < 0.5) b.chat(`bench message ${Math.floor(Math.random() * 1000)}`);
    else for (let i = 0; i < 3; i++) b.react(emojis[i % emojis.length]!);
    setTimeout(tick, rand(400, 1500)).unref();
  };
  tick();
}

function standardChecks(rec: Recorder): Check[] {
  const p = summarize(rec.prop.map((x) => x.latencyMs));
  const d = summarize(rec.drift.filter((x) => x.post).map((x) => Math.abs(x.driftMs)));
  return [
    { label: 'C2 propagation p95 <= 250ms', pass: p.p95 != null && p.p95 <= 250, detail: `p95 ${r1(p.p95)}ms over ${p.count} deliveries` },
    { label: 'C3 post-correction drift <= 500ms', pass: d.max != null && d.max <= 500, detail: `max ${r1(d.max)}ms, p95 ${r1(d.p95)}ms over ${d.count} samples` },
  ];
}

const mixedScenario = (id: string, name: string, users: number, description: string): Scenario => ({
  id,
  name,
  description,
  defaultUsers: users,
  defaultDurationS: 60,
  async run(ctx, rec) {
    const n = ctx.users ?? users;
    const { bots } = await setupRoom(ctx, rec, n);
    const until = Date.now() + (ctx.durationS ?? 60) * 1000;
    chatter(bots, until);
    const actions = await actionLoad(bots.slice(0, 3), until, ctx);
    await sleep(3000);
    return { extra: { actions }, checks: [{ label: `C1 ${n} concurrent users`, pass: rec.bots.filter((b) => b.live).length >= Math.min(n, 10), detail: `${rec.bots.filter((b) => b.live).length} live at end` }, ...standardChecks(rec)] };
  },
});

export const SCENARIOS: Scenario[] = [
  mixedScenario('S1', 'Baseline LAN', 10, '10 users, mixed play/pause/seek every 3-8s from 3 concurrent actors, chat + reactions'),
  mixedScenario('S2', 'Scale', 25, '25 users, same action mix'),
  {
    id: 'S3',
    name: 'Degraded network',
    description: '10 users; 3 of them on +100ms RTT with 2% TCP retransmissions (RTO 200ms)',
    defaultUsers: 10,
    defaultDurationS: 60,
    async run(ctx, rec) {
      const { bots } = await setupRoom(ctx, rec, ctx.users ?? 10);
      for (const b of bots.slice(-3)) b.netem = { rttMs: 100, lossPct: 0.02 };
      const until = Date.now() + (ctx.durationS ?? 60) * 1000;
      const actions = await actionLoad(bots.slice(0, 3), until, ctx);
      await sleep(3000);
      const slow = new Set(bots.slice(-3).map((b) => b.name));
      const slowProp = summarize(rec.prop.filter((p) => slow.has(p.bot)).map((p) => p.latencyMs));
      return {
        extra: { actions, slowP95: r1(slowProp.p95), slowMax: r1(slowProp.max) },
        checks: [
          ...standardChecks(rec),
          { label: 'Degraded clients still applied on the shared timeline', pass: (slowProp.p95 ?? 999) < 400, detail: `degraded p95 ${r1(slowProp.p95)}ms (includes the emulated 50ms one-way + retransmits)` },
        ],
      };
    },
  },
  {
    id: 'S4',
    name: 'Join storm',
    description: '5 users watching; 10 more join within 2s mid-playback. Measures time-to-sync per late joiner',
    defaultUsers: 15,
    defaultDurationS: 20,
    async run(ctx, rec) {
      const { code } = await setupRoom(ctx, rec, 5);
      const late: Bot[] = [];
      const joins: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        const b = new Bot(`late-${String(i).padStart(2, '0')}`, ctx.url, code, rec, skew());
        late.push(b);
        joins.push(sleep(i * 200).then(() => b.join()));
      }
      await Promise.all(joins);
      rec.bots.push(...late);
      await sleep((ctx.durationS ?? 20) * 1000);
      const tts = late.map((b) => (b.syncedAt ? b.syncedAt - b.joinStartedAt : null));
      const ok = tts.filter((t): t is number => t != null);
      const s = summarize(ok);
      return {
        extra: { lateJoiners: late.length, syncedJoiners: ok.length, timeToSyncP50: r1(s.p50), timeToSyncMax: r1(s.max) },
        checks: [
          ...standardChecks(rec),
          { label: 'Every late joiner synced', pass: ok.length === late.length, detail: `${ok.length}/${late.length}` },
          { label: 'Late join lands in sync < 3s', pass: (s.max ?? 99999) < 3000, detail: `time-to-sync p50 ${r1(s.p50)}ms, max ${r1(s.max)}ms (incl. REST join + 10-ping clock burst)` },
        ],
      };
    },
  },
  {
    id: 'S5',
    name: 'Reconnect storm',
    description: '10 users; 5 lose the network for 5s and come back (lastEseq replay / snapshot)',
    defaultUsers: 10,
    defaultDurationS: 20,
    async run(ctx, rec) {
      const { bots } = await setupRoom(ctx, rec, ctx.users ?? 10);
      const victims = bots.slice(-5);
      const host = bots[0]!;
      for (const v of victims) v.outage(5000);
      await sleep(1500);
      await host.action('seek', 200); // something to miss
      const outageEnd = Date.now() + 3500;
      await sleep(3500);
      const recovery: number[] = [];
      await Promise.all(
        victims.map(async (v) => {
          const deadline = Date.now() + 15000;
          let since: number | null = null;
          while (Date.now() < deadline) {
            const d = v.trueDriftMs();
            if (v.live && d != null && Math.abs(d) < 100) {
              since ??= Date.now();
              if (Date.now() - since >= 500) {
                recovery.push(since - outageEnd);
                return;
              }
            } else since = null;
            await sleep(100);
          }
        }),
      );
      await sleep((ctx.durationS ?? 20) * 1000 - 5000);
      const s = summarize(recovery);
      return {
        extra: { reconnected: recovery.length, recoveryP50: r1(s.p50), recoveryMax: r1(s.max) },
        checks: [
          ...standardChecks(rec),
          { label: 'All dropped clients resynced', pass: recovery.length === victims.length, detail: `${recovery.length}/${victims.length}` },
          { label: 'Resynced within 5s of the network returning', pass: (s.max ?? 99999) < 5000, detail: `p50 ${r1(s.p50)}ms, max ${r1(s.max)}ms (includes socket backoff + clock burst)` },
        ],
      };
    },
  },
  {
    id: 'S6',
    name: 'Host drop',
    description: '10 users; the host disappears. Auto succession after the 10s grace, playback uninterrupted',
    defaultUsers: 10,
    defaultDurationS: 20,
    async run(ctx, rec) {
      const { bots, host } = await setupRoom(ctx, rec, ctx.users ?? 10);
      const t0 = Date.now();
      host.leave();
      const watchers = bots.slice(1);
      const deadline = t0 + 15000;
      while (Date.now() < deadline && !watchers.some((b) => b.hostChangedAt)) await sleep(100);
      const changedAt = watchers.map((b) => b.hostChangedAt).find((x) => x != null) ?? null;
      const newHost = watchers.find((b) => b.isHost);
      await sleep(4000);
      const succession = changedAt ? changedAt - t0 : null;
      return {
        extra: { successionMs: succession, newHost: newHost?.name ?? null },
        checks: [
          ...standardChecks(rec),
          { label: 'Host succession <= 12s', pass: succession != null && succession <= 12000, detail: `${succession}ms (grace period is 10s)` },
          { label: 'Longest-connected participant promoted', pass: newHost?.name === 'bot-01', detail: `new host ${newHost?.name ?? 'none'}` },
        ],
      };
    },
  },
  {
    id: 'S7',
    name: 'Server crash + restart',
    description: '10 users; the server is SIGKILLed mid-playback and restarted. Rooms restore from snapshots, clients reconnect',
    defaultUsers: 10,
    defaultDurationS: 15,
    needsServerControl: true,
    async run(ctx, rec) {
      if (!ctx.server) throw new Error('S7 needs --spawn (default)');
      const { bots, code } = await setupRoom(ctx, rec, ctx.users ?? 10);
      const seqBefore = bots[0]!.core.latestSeqSeen;
      await sleep(1000);
      const t0 = Date.now();
      await ctx.server.crash();
      ctx.log('  server killed (SIGKILL)');
      await sleep(1000);
      await ctx.server.start();
      ctx.log(`  server restarted after ${Date.now() - t0}ms`);
      const deadline = Date.now() + 20000;
      let recoveredAt: number | null = null;
      while (Date.now() < deadline) {
        const ok = bots.every((b) => {
          const d = b.trueDriftMs();
          return b.live && d != null && Math.abs(d) < 150;
        });
        if (ok) {
          recoveredAt = Date.now();
          break;
        }
        await sleep(100);
      }
      const roomRes = await fetch(`${ctx.url}/api/rooms/${code}`);
      const roomOk = roomRes.ok;
      await sleep((ctx.durationS ?? 15) * 1000);
      const seqAfter = bots[0]!.core.latestSeqSeen;
      return {
        extra: { recoveryMs: recoveredAt ? recoveredAt - t0 : null, seqBefore, seqAfter },
        checks: [
          ...standardChecks(rec),
          { label: 'Room restored from snapshot', pass: roomOk, detail: roomOk ? `room ${code} exists after restart` : 'room missing' },
          { label: 'All clients back in sync after restart', pass: recoveredAt != null, detail: recoveredAt ? `${recoveredAt - t0}ms from crash (incl. ~1s downtime + boot)` : 'timeout' },
          { label: 'Playback state preserved', pass: seqAfter >= seqBefore, detail: `seq ${seqBefore} -> ${seqAfter}` },
        ],
      };
    },
  },
  {
    id: 'S8',
    name: 'Buffering laggard',
    description: '10 users; one client stalls for 3s. Room policy WAIT_FOR_ALL freezes everyone, then resumes together',
    defaultUsers: 10,
    defaultDurationS: 15,
    async run(ctx, rec) {
      const { bots } = await setupRoom(ctx, rec, ctx.users ?? 10);
      const laggard = bots[bots.length - 1]!;
      const watcher = bots[1]!;
      laggard.player.stall(3000);
      const t0 = Date.now();
      let frozeAt: number | null = null;
      let resumedAt: number | null = null;
      while (Date.now() - t0 < 10000) {
        const st = watcher.core.active?.status;
        if (st === 'BUFFERING' && frozeAt == null) frozeAt = Date.now();
        if (frozeAt != null && st === 'PLAYING') {
          resumedAt = Date.now();
          break;
        }
        await sleep(50);
      }
      await sleep((ctx.durationS ?? 15) * 1000);
      const lagDrift = rec.drift.filter((d) => d.bot === laggard.name && d.post).map((d) => Math.abs(d.driftMs));
      const s = summarize(lagDrift);
      return {
        extra: { freezeMs: frozeAt && resumedAt ? resumedAt - frozeAt : null, laggardDriftMax: r1(s.max) },
        checks: [
          ...standardChecks(rec),
          { label: 'Room waited for the buffering client', pass: frozeAt != null, detail: frozeAt ? `froze ${frozeAt - t0}ms after the stall began` : 'never froze' },
          { label: 'Room resumed (<= 4s wait cap)', pass: frozeAt != null && resumedAt != null && resumedAt - frozeAt <= 4500, detail: resumedAt && frozeAt ? `resumed after ${resumedAt - frozeAt}ms` : 'did not resume' },
        ],
      };
    },
  },
  {
    id: 'S9',
    name: 'Soak',
    description: '25 users, continuous playback with occasional actions; drift must stay <= 500ms the whole time',
    defaultUsers: 25,
    defaultDurationS: 120,
    async run(ctx, rec) {
      const { bots } = await setupRoom(ctx, rec, ctx.users ?? 25);
      const until = Date.now() + (ctx.durationS ?? 120) * 1000;
      chatter(bots, until);
      // sparse actions so most of the soak is uninterrupted playback (pure drift control)
      let actions = 0;
      while (Date.now() < until) {
        await sleep(20000);
        if (Date.now() >= until) break;
        await bots[0]!.action('seek', rand(30, 400));
        actions++;
      }
      await sleep(2000);
      return { extra: { actions }, checks: standardChecks(rec) };
    },
  },
];

export function finalize(s: Scenario, rec: Recorder, users: number, durationS: number, extra: ScenarioResult['extra'], checks: Check[]): ScenarioResult {
  const prop = rec.prop.map((p) => p.latencyMs);
  const post = rec.drift.filter((d) => d.post);
  const propSummary = summarize(prop);
  const top = Math.max(10, Math.ceil(((propSummary.p99 ?? 10) * 1.2) / 5) * 5);
  const bucket = top <= 50 ? 2 : top <= 150 ? 5 : 10;
  const series: ScenarioResult['driftSeries'] = [];
  const bySec = new Map<number, number[]>();
  for (const d of post) {
    const t = Math.floor((d.t - rec.startedAt) / 1000);
    const arr = bySec.get(t) ?? [];
    arr.push(Math.abs(d.driftMs));
    bySec.set(t, arr);
  }
  for (const [t, arr] of [...bySec.entries()].sort((a, b) => a[0] - b[0])) {
    const sm = summarize(arr);
    series.push({ t, p50: r1(sm.p50) ?? 0, p95: r1(sm.p95) ?? 0, max: r1(sm.max) ?? 0 });
  }
  const round = (x: ReturnType<typeof summarize>) => ({
    count: x.count,
    min: r1(x.min),
    p50: r1(x.p50),
    p95: r1(x.p95),
    p99: r1(x.p99),
    max: r1(x.max),
    mean: r1(x.mean),
  });
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    users,
    durationS,
    propagation: round(propSummary),
    drift: round(summarize(post.map((d) => Math.abs(d.driftMs)))),
    extra,
    pass: checks.every((c) => c.pass),
    checks,
    histogram: histogram(
      prop.map((v) => Math.min(v, top)),
      bucket,
      top,
    ),
    driftSeries: series,
    raw: { prop: rec.prop, drift: rec.drift },
  };
}
