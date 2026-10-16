import { performance } from 'node:perf_hooks';
import { io, type Socket } from 'socket.io-client';
import {
  C2S,
  ClockEstimator,
  LOGGED_EVENTS,
  S2C,
  SOCKET_NAMESPACE,
  SYNC,
  SyncCore,
  clockSample,
  expectedPos,
  uuid,
  type JoinAck,
  type LoggedEvent,
  type PlaybackState,
  type Snapshot,
  type StateUpdate,
} from '@blockparty/shared';
import { SimPlayer } from './simPlayer';

export interface Netem {
  /** extra round-trip time in ms (split evenly per direction) */
  rttMs: number;
  /** probability that a packet needs a TCP retransmission (adds ~RTO of extra delay) */
  lossPct: number;
}

export interface DriftSample {
  t: number;
  bot: string;
  driftMs: number;
  post: boolean;
}

export interface PropSample {
  bot: string;
  seq: number;
  latencyMs: number;
}

const RTO_MS = 200;

/**
 * A headless participant that runs the exact browser sync algorithm (SyncCore + ClockEstimator)
 * against a simulated player. Same-host runs make latency measurement exact.
 */
export class Bot {
  readonly clock = new ClockEstimator();
  readonly player: SimPlayer;
  readonly core: SyncCore;
  socket: Socket | null = null;
  token = '';
  userId = '';
  live = false;
  isHost = false;
  hostChangedAt: number | null = null;
  lastApplyAt = 0;
  joinStartedAt = 0;
  syncedAt: number | null = null;
  private inSyncSince: number | null = null;
  private eseq = 0;
  private bootId: string | null = null;
  private replaying = false;
  private loops: NodeJS.Timeout[] = [];
  private lastDeliver = 0;
  private outbound = 0;
  private blockReconnectUntil = 0;
  netem: Netem = { rttMs: 0, lossPct: 0 };
  readonly prop: PropSample[] = [];
  readonly drift: DriftSample[] = [];
  disconnects = 0;
  reconnectedAt: number[] = [];

  constructor(
    readonly name: string,
    private readonly url: string,
    readonly code: string,
    private readonly sink: { drift: DriftSample[]; prop: PropSample[] },
    skew: number,
  ) {
    this.player = new SimPlayer(skew, () => 40 + Math.random() * 80);
    this.core = new SyncCore({
      serverNow: () => this.clock.serverNow(),
      localNow: () => performance.now(),
      scheduleAt: (fn, at) => {
        const t = setTimeout(fn, Math.max(0, at - this.clock.serverNow()));
        t.unref();
        return t;
      },
      cancel: (h) => clearTimeout(h as NodeJS.Timeout),
      onApplied: (u, info) => {
        this.lastApplyAt = Date.now();
        this.emit(C2S.SYNC_ACK, { seq: u.seq, recvServerTs: info.recvServerTs, appliedAt: info.appliedAt });
      },
    });
    this.player.onSeeked = () => this.core.onSeeked();
    this.core.attachPlayer(this.player);
  }

  // ---------------- network emulation (in-order, TCP-like) ----------------
  private delayFor(): number {
    const oneWay = this.netem.rttMs / 2;
    const retrans = Math.random() < this.netem.lossPct ? RTO_MS : 0;
    return oneWay + retrans + (oneWay > 0 ? Math.random() * 4 : 0);
  }

  /** Deliver an incoming packet after the emulated delay, never reordering (head-of-line blocking). */
  private inbound(fn: () => void): void {
    if (this.netem.rttMs === 0 && this.netem.lossPct === 0) return fn();
    const at = Math.max(this.lastDeliver, Date.now() + this.delayFor());
    this.lastDeliver = at;
    setTimeout(fn, at - Date.now()).unref();
  }

  private emit(event: string, payload: unknown, ack?: (res: never) => void): void {
    const s = this.socket;
    if (!s?.connected) return;
    const send = () => (ack ? s.emit(event, payload, ack) : s.emit(event, payload));
    if (this.netem.rttMs === 0 && this.netem.lossPct === 0) return void send();
    const at = Math.max(this.outbound, Date.now() + this.delayFor());
    this.outbound = at;
    setTimeout(send, at - Date.now()).unref();
  }

  private request<T>(event: string, payload: unknown, timeoutMs = 8000): Promise<T | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      this.emit(event, payload, ((res: T) => {
        this.inbound(() => {
          clearTimeout(t);
          resolve(res);
        });
      }) as never);
    });
  }

  // ---------------- lifecycle ----------------
  async join(password?: string): Promise<void> {
    this.joinStartedAt = Date.now();
    const res = await fetch(`${this.url}/api/rooms/${this.code}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: this.name, avatarSeed: this.name, password, token: this.token || undefined }),
    });
    if (!res.ok) throw new Error(`join ${this.name} failed: ${res.status}`);
    const body = (await res.json()) as { token: string; userId: string };
    this.token = body.token;
    this.userId = body.userId;
    await this.connect();
  }

  useToken(token: string, userId: string): void {
    this.token = token;
    this.userId = userId;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = io(`${this.url}${SOCKET_NAMESPACE}`, {
        transports: ['websocket'],
        auth: { token: this.token },
        reconnection: true,
        reconnectionDelay: 300,
        reconnectionDelayMax: 3000,
        randomizationFactor: 0.3,
        forceNew: true,
      });
      this.socket = socket;
      let first = true;
      socket.on('connect', () => {
        if (Date.now() < this.blockReconnectUntil) {
          // emulate an outage: refuse to come back until the window ends
          socket.disconnect();
          setTimeout(() => socket.connect(), this.blockReconnectUntil - Date.now()).unref();
          return;
        }
        void this.onConnect().then(
          () => {
            if (first) {
              first = false;
              resolve();
            }
          },
          (err: unknown) => {
            if (first) reject(err);
          },
        );
      });
      socket.on('disconnect', () => {
        this.live = false;
        this.disconnects++;
      });
      socket.on('connect_error', (err) => {
        if (first && err.message === 'UNAUTHORIZED') reject(err);
      });
      for (const ev of LOGGED_EVENTS) {
        socket.on(ev, (p: { eseq: number }) => this.inbound(() => this.onLogged(ev, p)));
      }
    });
  }

  private async onConnect(): Promise<void> {
    const samples = [];
    for (let i = 0; i < SYNC.clockBurst; i++) {
      const t0 = Date.now();
      const r = await this.request<{ ok: boolean; t0: number; ts: number }>(C2S.TIME_PING, { t0 }, 3000);
      if (r?.ok) samples.push(clockSample(r.t0, r.ts, Date.now()));
      await new Promise((res) => setTimeout(res, 30));
    }
    this.clock.initFromBurst(samples);
    const ack = await this.request<JoinAck>(C2S.ROOM_JOIN, {
      code: this.code,
      lastEseq: this.bootId ? this.eseq : undefined,
      bootId: this.bootId ?? undefined,
    });
    if (!ack || !ack.ok) throw new Error(`room:join failed for ${this.name}: ${ack && !ack.ok ? ack.error.message : 'timeout'}`);
    if (ack.mode === 'snapshot') this.applySnapshot(ack.snapshot);
    else this.applyEvents(ack.events);
    this.live = true;
    this.reconnectedAt.push(Date.now());
    this.startLoops();
  }

  private applySnapshot(s: Snapshot): void {
    this.bootId = s.bootId;
    this.eseq = s.eseq;
    this.isHost = s.room.hostId === this.userId;
    this.core.loadSnapshot(s.state);
    this.lastApplyAt = Date.now();
  }

  private applyEvents(events: LoggedEvent[]): void {
    for (const e of events) {
      if (e.eseq <= this.eseq) continue;
      this.eseq = e.eseq;
      this.handle(e.event, e.payload, true);
    }
  }

  private onLogged(event: string, p: { eseq: number }): void {
    if (this.replaying || p.eseq <= this.eseq) return;
    if (p.eseq !== this.eseq + 1) {
      void this.replay();
      return;
    }
    this.eseq = p.eseq;
    this.handle(event, p, false);
  }

  private async replay(): Promise<void> {
    if (this.replaying || !this.bootId) return;
    this.replaying = true;
    const res = await this.request<{ ok: boolean; mode: 'replay'; events: LoggedEvent[] } | { ok: boolean; mode: 'snapshot'; snapshot: Snapshot }>(
      C2S.SYNC_REPLAY,
      { lastEseq: this.eseq, bootId: this.bootId },
    );
    this.replaying = false;
    if (!res?.ok) return;
    if (res.mode === 'replay') this.applyEvents(res.events);
    else this.applySnapshot(res.snapshot);
  }

  private handle(event: string, payload: unknown, replayed: boolean): void {
    if (event === S2C.STATE_UPDATE) {
      const u = payload as StateUpdate;
      if (!replayed) this.sink.prop.push({ bot: this.name, seq: u.seq, latencyMs: Math.max(0, Date.now() - u.serverTs) });
      this.core.receive(u);
    } else if (event === S2C.HOST_CHANGED) {
      const h = payload as { newId: string };
      this.isHost = h.newId === this.userId;
      this.hostChangedAt = Date.now();
    }
  }

  private startLoops(): void {
    for (const l of this.loops) clearInterval(l);
    this.loops = [
      setInterval(() => this.tick(), SYNC.driftLoopMs),
      setInterval(() => this.telemetry(), SYNC.telemetryMs),
      setInterval(() => void this.heartbeat(), SYNC.clockIntervalMs),
    ];
    for (const l of this.loops) l.unref();
  }

  private async heartbeat(): Promise<void> {
    if (!this.live) return;
    const t0 = Date.now();
    const r = await this.request<{ ok: boolean; t0: number; ts: number; eseq: number }>(C2S.TIME_PING, { t0 }, SYNC.pongTimeoutMs);
    if (!r?.ok) return;
    this.clock.addSample(clockSample(r.t0, r.ts, Date.now()));
    if (r.eseq > this.eseq) void this.replay();
  }

  private bufferingReported = false;

  private tick(): void {
    this.core.tick();
    const s = this.core.active;
    // Buffering reports, like the browser client.
    const stalled = this.player.isStalled() && s?.status === 'PLAYING' && this.clock.serverNow() > s.anchorTime + 500;
    if (stalled && !this.bufferingReported) {
      this.bufferingReported = true;
      this.emit(C2S.BUFFERING, { state: 'START', pos: this.player.getTime() });
    } else if (!this.player.isStalled() && this.bufferingReported) {
      this.bufferingReported = false;
      this.emit(C2S.BUFFERING, { state: 'END', pos: this.player.getTime() });
    }
    this.sample();
  }

  /** True drift against the server timeline using the real (same-host) clock. */
  trueDriftMs(state: PlaybackState | null = this.core.active): number | null {
    if (!state || state.status !== 'PLAYING') return null;
    const now = Date.now();
    if (now < state.anchorTime) return null;
    return (this.player.getTime() - expectedPos(state, now)) * 1000;
  }

  private sample(): void {
    if (!this.live) return;
    const st = this.core.status();
    if (st !== 'PLAYING') {
      this.inSyncSince = null;
      return;
    }
    const d = this.trueDriftMs();
    if (d == null) return;
    const now = Date.now();
    // "post-correction" = at least 2.5s after the last applied change (seek settle + correction window)
    const post = now - this.lastApplyAt >= 2500 && !this.player.isStalled();
    this.sink.drift.push({ t: now, bot: this.name, driftMs: d, post });
    if (Math.abs(d) < SYNC.syncedThresholdMs) {
      this.inSyncSince ??= now;
      if (this.syncedAt == null && now - this.inSyncSince >= 1000) this.syncedAt = now;
    } else this.inSyncSince = null;
  }

  private telemetry(): void {
    const d = this.core.lastDriftMs;
    if (!this.live || d == null) return;
    this.emit(C2S.TELEMETRY, {
      drift: d,
      mode: this.core.drift.mode,
      rtt: this.clock.rttMs,
      offset: this.clock.offsetMs,
      pos: this.player.getTime(),
      rate: this.player.getRate(),
      hardSeeks: this.core.drift.totalHardSeeks,
    });
  }

  // ---------------- actions ----------------
  async action(kind: 'play' | 'pause' | 'seek', pos?: number): Promise<boolean> {
    const event = kind === 'play' ? C2S.PLAY : kind === 'pause' ? C2S.PAUSE : C2S.SEEK;
    const r = await this.request<{ ok: boolean }>(event, {
      eventId: uuid(),
      baseSeq: Math.max(0, this.core.latestSeqSeen),
      pos: pos ?? this.player.getTime(),
      final: true,
    });
    return !!r?.ok;
  }

  async addMovie(movieId: string): Promise<boolean> {
    const r = await this.request<{ ok: boolean }>(C2S.QUEUE_ADD, { movieId });
    return !!r?.ok;
  }

  async settings(patch: Record<string, unknown>): Promise<boolean> {
    const r = await this.request<{ ok: boolean }>(C2S.ROOM_SETTINGS, patch);
    return !!r?.ok;
  }

  chat(text: string): void {
    this.emit(C2S.CHAT_SEND, { id: uuid(), text });
  }

  react(emoji: string): void {
    this.emit(C2S.REACTION_SEND, { emoji });
  }

  /** Network outage: drop the transport and refuse to reconnect for ms. */
  outage(ms: number): void {
    this.blockReconnectUntil = Date.now() + ms;
    this.socket?.io.engine?.close();
  }

  leave(): void {
    for (const l of this.loops) clearInterval(l);
    this.loops = [];
    this.live = false;
    this.socket?.disconnect();
  }

  dispose(): void {
    this.leave();
    this.socket?.removeAllListeners();
    this.core.dispose();
  }
}
