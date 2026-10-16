import { io, type Socket } from 'socket.io-client';
import {
  C2S,
  ClockEstimator,
  S2C,
  SOCKET_NAMESPACE,
  SYNC,
  SyncCore,
  clockSample,
  expectedPos,
  formatTime,
  uuid,
  type Ack,
  type ChaosApply,
  type ChatMessage,
  type JoinAck,
  type LoggedEvent,
  type LoggedPayloads,
  type ParticipantInfo,
  type PlayerLike,
  type Poll,
  type PongPayload,
  type ReactionBurst,
  type Recommendation,
  type Role,
  type Snapshot,
  type StateUpdate,
  type SyncMetrics,
  type TasteVector,
  type ToastPayload,
  type WithEseq,
} from '@willio/shared';
import { useRoom, type SyncBadge } from '@/store/room';
import { usePrefs } from '@/store/prefs';
import { toast, useToasts } from '@/store/toasts';
import { serverUrl } from './config';
import type { PlayerAdapter } from './player/types';
import { sounds } from './sound';

export type FatalKind = 'unauthorized' | 'not-found' | 'full' | 'replaced';

interface ClientOptions {
  code: string;
  token: string;
  taste: TasteVector | null;
  onFatal(kind: FatalKind, message: string): void;
}

type AnyAck = Ack<Record<string, unknown>>;

const ACTION_TEXT: Partial<Record<string, (u: StateUpdate) => string>> = {
  play: (u) => `${u.causedBy.name} pressed play`,
  pause: (u) => `${u.causedBy.name} paused at ${formatTime(u.state.anchorPos)}`,
  seek: (u) => `${u.causedBy.name} seeked to ${formatTime(u.state.anchorPos)}`,
  rate: (u) => `${u.causedBy.name} set speed to ${u.state.rate}x`,
};

/**
 * Everything realtime for one room, outside React: socket, clock sync, the shared SyncCore,
 * reliable event delivery (eseq gap -> replay) and the drift/telemetry loops.
 * React reads from the Zustand store; components call the action methods.
 */
export class RoomClient {
  readonly clock = new ClockEstimator();
  readonly core: SyncCore;
  readonly reactionListeners = new Set<(b: ReactionBurst[]) => void>();
  private socket: Socket | null = null;
  private adapter: PlayerAdapter | null = null;
  private adapterMediaId: string | null = null;
  private adapterOff: (() => void)[] = [];
  private intervals: number[] = [];
  private bootId: string | null = null;
  private eseq = 0;
  private replaying = false;
  private suppressAcks = false;
  private stallSimUntil = 0;
  private waitingSince: number | null = null;
  private bufferingReported = false;
  private syncedSince: number | null = null;
  private syncedAnnounced = false;
  private lastHardSeekAt = 0;
  private reportedDuration = new Set<string>();
  private typingSentAt = 0;
  private disposed = false;
  private firstJoin = true;
  private onVisibility = () => this.handleVisibility();

  constructor(private readonly opts: ClientOptions) {
    this.core = new SyncCore({
      serverNow: () => this.clock.serverNow(),
      localNow: () => performance.now(),
      scheduleAt: (fn, at) => this.scheduleAt(fn, at),
      cancel: (h) => {
        const handle = h as { cancelled: boolean; t: number } | null;
        if (handle) {
          handle.cancelled = true;
          window.clearTimeout(handle.t);
        }
      },
      onApplied: (u, info) => {
        if (this.suppressAcks || !this.socket?.connected) return;
        this.socket.emit(C2S.SYNC_ACK, { seq: u.seq, recvServerTs: info.recvServerTs, appliedAt: info.appliedAt });
      },
      onPlayBlocked: () => this.patchSync({ needsGesture: true }),
      onDecision: (d) => {
        if (d.seek) this.lastHardSeekAt = performance.now();
        if (d.suggestResync) this.patchSync({ suggestResync: true });
      },
    });
  }

  // ------------------------------------------------------------------ lifecycle

  connect(): void {
    if (this.socket) return;
    const socket = io(`${serverUrl()}${SOCKET_NAMESPACE}`, {
      transports: ['websocket'],
      auth: { token: this.opts.token },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 8000,
      randomizationFactor: 0.5,
      timeout: 8000,
    });
    this.socket = socket;
    this.store().set({ phase: 'connecting', error: null });
    socket.on('connect', () => void this.onConnect());
    socket.on('disconnect', (reason) => this.onDisconnect(reason));
    socket.on('connect_error', (err) => {
      if (err.message === 'UNAUTHORIZED') {
        socket.disconnect();
        this.opts.onFatal('unauthorized', 'Your session expired');
        return;
      }
      this.store().set({ phase: 'offline', error: "Can't reach the server - retrying..." });
    });
    this.registerHandlers(socket);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.startLoops();
  }

  dispose(): void {
    this.disposed = true;
    for (const i of this.intervals) window.clearInterval(i);
    this.intervals = [];
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.detachAdapter();
    this.core.dispose();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.reactionListeners.clear();
  }

  private store() {
    return useRoom.getState();
  }

  private patchSync(p: Partial<ReturnType<typeof useRoom.getState>['sync']>): void {
    useRoom.setState((s) => ({ sync: { ...s.sync, ...p } }));
  }

  /** setTimeout to ~8ms before the target, then a short spin for sub-ms precision. */
  private scheduleAt(fn: () => void, atServerMs: number): { cancelled: boolean; t: number } {
    const handle = { cancelled: false, t: 0 };
    const fire = () => {
      if (handle.cancelled || this.disposed) return;
      const remaining = atServerMs - this.clock.serverNow();
      if (remaining > 12) {
        handle.t = window.setTimeout(fire, remaining - SYNC.timerEarlyMs);
        return;
      }
      if (remaining > 0) {
        const end = performance.now() + remaining;
        while (performance.now() < end) {
          /* spin for the last few ms */
        }
      }
      fn();
    };
    const delay = atServerMs - this.clock.serverNow();
    handle.t = window.setTimeout(fire, Math.max(0, delay - SYNC.timerEarlyMs));
    return handle;
  }

  private emitAck<T extends object = Record<string, unknown>>(event: string, payload?: unknown, timeoutMs = 8000): Promise<Ack<T>> {
    const socket = this.socket;
    if (!socket || !socket.connected) {
      return Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: "You're offline - reconnecting..." } });
    }
    return new Promise((resolve) => {
      const cb = (err: Error | null, res: Ack<T>) => {
        if (err) resolve({ ok: false, error: { code: 'INTERNAL', message: 'The server did not answer in time' } });
        else resolve(res);
      };
      if (payload === undefined) socket.timeout(timeoutMs).emit(event, cb);
      else socket.timeout(timeoutMs).emit(event, payload, cb);
    });
  }

  // ------------------------------------------------------------------ connection

  private async ping(timeoutMs = 3000): Promise<{ sample: { rtt: number; offset: number }; pong: PongPayload } | null> {
    const t0 = Date.now();
    const res = await this.emitAck<PongPayload>(C2S.TIME_PING, { t0 }, timeoutMs);
    if (!res.ok) return null;
    return { sample: clockSample(res.t0, res.ts, Date.now()), pong: res };
  }

  private async clockBurst(n: number): Promise<void> {
    const samples: { rtt: number; offset: number }[] = [];
    for (let i = 0; i < n && !this.disposed; i++) {
      const r = await this.ping();
      if (r) samples.push(r.sample);
      if (i < n - 1) await new Promise((res) => setTimeout(res, SYNC.clockBurstGapMs));
    }
    if (samples.length > 0) this.clock.initFromBurst(samples);
  }

  private async onConnect(): Promise<void> {
    if (this.disposed) return;
    this.store().set({ phase: 'clock', error: null });
    await this.clockBurst(this.firstJoin ? SYNC.clockBurst : 5);
    if (this.disposed || !this.socket?.connected) return;
    this.store().set({ phase: 'joining' });
    const ack = (await this.emitAck(C2S.ROOM_JOIN, {
      code: this.opts.code,
      lastEseq: this.bootId ? this.eseq : undefined,
      bootId: this.bootId ?? undefined,
      tasteVector: this.opts.taste ?? undefined,
    })) as JoinAck;
    if (!ack.ok) {
      const { code, message } = ack.error;
      if (code === 'NOT_FOUND') this.opts.onFatal('not-found', message);
      else if (code === 'UNAUTHORIZED') this.opts.onFatal('unauthorized', message);
      else if (code === 'ROOM_FULL') this.opts.onFatal('full', message);
      else this.store().set({ phase: 'error', error: message });
      return;
    }
    if (ack.mode === 'snapshot') this.applySnapshot(ack.snapshot);
    else this.applyReplay(ack.events, ack.me);
    this.firstJoin = false;
    this.store().set({ phase: 'live', error: null });
    this.syncedSince = null;
    void this.flushOutbox();
  }

  private onDisconnect(reason: Socket.DisconnectReason): void {
    if (this.disposed) return;
    if (reason === 'io server disconnect') {
      // The server only does this when the same session opened in another tab.
      this.store().set({ phase: 'replaced' });
      return;
    }
    if (reason === 'io client disconnect') return;
    this.store().set({ phase: 'offline', error: 'Connection lost - reconnecting...' });
    this.patchSync({ badge: 'OFFLINE' });
  }

  /** Use this tab again after "opened elsewhere". */
  reclaim(): void {
    if (!this.socket) return;
    this.store().set({ phase: 'connecting' });
    this.socket.connect();
  }

  private startLoops(): void {
    this.intervals.push(
      window.setInterval(() => this.tick(), SYNC.driftLoopMs),
      window.setInterval(() => this.sendTelemetry(), SYNC.telemetryMs),
      window.setInterval(() => void this.heartbeat(), SYNC.clockIntervalMs),
      window.setInterval(() => this.expireTyping(), 2000),
    );
  }

  /** Continuous clock sync + liveness + tail-drop detection (pong carries the latest eseq). */
  private async heartbeat(): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected || this.store().phase !== 'live') return;
    const r = await this.ping(SYNC.pongTimeoutMs);
    if (!r) {
      // No pong for 5s: the connection is stalled - force a reconnect.
      if (socket.connected) {
        socket.disconnect();
        socket.connect();
      }
      return;
    }
    this.clock.addSample(r.sample);
    if (r.pong.eseq > this.eseq && !this.replaying) void this.requestReplay();
  }

  private handleVisibility(): void {
    if (document.visibilityState !== 'visible' || this.disposed) return;
    // Background tabs throttle timers: re-measure the clock and re-anchor.
    void this.clockBurst(3).then(() => {
      this.core.drift.reset();
      this.core.playerReady();
    });
  }

  // ------------------------------------------------------------------ event delivery

  private registerHandlers(socket: Socket): void {
    const logged: (keyof LoggedPayloads)[] = [
      S2C.STATE_UPDATE,
      S2C.PARTICIPANT_JOIN,
      S2C.PARTICIPANT_LEAVE,
      S2C.PARTICIPANT_UPDATE,
      S2C.ROOM_UPDATE,
      S2C.CHAT_MSG,
      S2C.QUEUE_UPDATE,
      S2C.NEXT_UP,
      S2C.POLL_UPDATE,
      S2C.POLL_CLOSED,
      S2C.HOST_CHANGED,
      S2C.INTERMISSION,
    ];
    for (const ev of logged) socket.on(ev, (p: WithEseq<object>) => this.onLogged(ev, p));

    socket.on(S2C.CHAT_TYPING, (p: { userId: string; name: string; on: boolean }) => {
      useRoom.setState((s) => {
        const typing = { ...s.typing };
        if (p.on) typing[p.userId] = { name: p.name, at: Date.now() };
        else delete typing[p.userId];
        return { typing };
      });
    });
    socket.on(S2C.REACTION_BURST, (p: { bursts: ReactionBurst[] }) => {
      useRoom.setState((s) => {
        const totals = { ...s.reactionTotals };
        for (const b of p.bursts) totals[b.emoji] = (totals[b.emoji] ?? 0) + b.count;
        return { reactionTotals: totals };
      });
      for (const l of this.reactionListeners) l(p.bursts);
      sounds.pop();
    });
    socket.on(S2C.HEATMAP, (p: { heatmap: ReturnType<typeof useRoom.getState>['heatmap'] }) => this.store().set({ heatmap: p.heatmap }));
    socket.on(S2C.METRICS, (m: SyncMetrics) => this.store().set({ metrics: m }));
    socket.on(S2C.TOAST, (t: ToastPayload) => useToasts.getState().push({ kind: t.kind, title: t.title, text: t.text }));
    socket.on(S2C.HOST_REQUESTED, (r: { userId: string; name: string }) => {
      useRoom.setState((s) => ({ hostRequests: [...s.hostRequests.filter((x) => x.userId !== r.userId), r] }));
    });
    socket.on(S2C.CHAOS_APPLY, (c: ChaosApply) => this.applyChaos(c));
    socket.on(S2C.SESSION_REPLACED, () => {
      this.store().set({ phase: 'replaced' });
    });
  }

  private onLogged(event: keyof LoggedPayloads, payload: WithEseq<object>): void {
    if (this.replaying || typeof payload?.eseq !== 'number') return;
    if (payload.eseq <= this.eseq) return; // duplicate
    if (payload.eseq !== this.eseq + 1) {
      // A message went missing (packet drop / chaos): fetch what we missed.
      void this.requestReplay();
      return;
    }
    this.eseq = payload.eseq;
    this.applyLogged(event, payload, false);
  }

  private async requestReplay(): Promise<void> {
    if (this.replaying || !this.bootId) return;
    this.replaying = true;
    try {
      const res = await this.emitAck<{ mode: 'replay'; events: LoggedEvent[] } | { mode: 'snapshot'; snapshot: Snapshot }>(
        C2S.SYNC_REPLAY,
        { lastEseq: this.eseq, bootId: this.bootId },
      );
      if (!res.ok) return;
      if (res.mode === 'replay') this.applyEvents(res.events);
      else this.applySnapshot(res.snapshot);
    } finally {
      this.replaying = false;
    }
  }

  private applyEvents(events: LoggedEvent[]): void {
    this.suppressAcks = true;
    try {
      for (const e of events) {
        if (e.eseq <= this.eseq) continue;
        this.eseq = e.eseq;
        this.applyLogged(e.event as keyof LoggedPayloads, e.payload as WithEseq<object>, true);
      }
    } finally {
      this.suppressAcks = false;
    }
  }

  private applyReplay(events: LoggedEvent[], me: { id: string; role: Role }): void {
    this.store().set({ me });
    this.applyEvents(events);
  }

  private applySnapshot(s: Snapshot): void {
    this.bootId = s.bootId;
    this.eseq = s.eseq;
    const participants: Record<string, ParticipantInfo> = {};
    for (const p of s.participants) participants[p.id] = p;
    const polls: Record<string, Poll> = {};
    for (const p of s.polls) polls[p.id] = p;
    const prev = this.store();
    const firstSnapshot = prev.joinedAtPos === null;
    const pos = s.state.media ? expectedPos(s.state, this.clock.serverNow()) : 0;
    const chatCounts: Record<string, number> = {};
    for (const m of s.chatTail) if (!m.system) chatCounts[m.name] = (chatCounts[m.name] ?? 0) + 1;
    this.store().set({
      me: s.me,
      room: s.room,
      participants,
      state: s.state,
      queue: s.queue,
      nextUp: s.nextUp,
      polls,
      myVotes: s.myVotes,
      chat: s.chatTail,
      heatmap: s.heatmap,
      intermission: s.intermission,
      optimisticStatus: null,
      ...(firstSnapshot ? { joinedAtPos: pos, chatCounts } : {}),
    });
    this.suppressAcks = true;
    try {
      this.core.loadSnapshot(s.state);
    } finally {
      this.suppressAcks = false;
    }
  }

  private applyLogged(event: keyof LoggedPayloads, payload: WithEseq<object>, silent: boolean): void {
    const st = this.store();
    const meId = st.me?.id;
    switch (event) {
      case S2C.STATE_UPDATE: {
        const u = payload as unknown as StateUpdate;
        const prevStatus = st.state?.status;
        st.set({ state: u.state, optimisticStatus: null });
        this.core.receive(u);
        if (!silent && u.causedBy.userId !== meId) {
          const text = ACTION_TEXT[u.causedBy.action]?.(u);
          if (text) toast.info(text);
          else if (u.causedBy.action === 'load' && u.state.media) toast.info(`Now playing: ${u.state.media.title}`, `by ${u.causedBy.name}`);
          else if (u.causedBy.action === 'buffering') toast.warn(`Waiting for ${u.causedBy.name}...`, 'Their video is buffering');
          else if (u.causedBy.action === 'resume' && prevStatus === 'BUFFERING') toast.success('Back in action');
        }
        if (u.state.media?.id !== st.state?.media?.id) this.syncedAnnounced = false;
        break;
      }
      case S2C.PARTICIPANT_JOIN:
      case S2C.PARTICIPANT_UPDATE: {
        const { participant } = payload as unknown as LoggedPayloads['participant:join'];
        useRoom.setState((s) => ({
          participants: { ...s.participants, [participant.id]: participant },
          me: s.me && s.me.id === participant.id ? { ...s.me, role: participant.role } : s.me,
        }));
        break;
      }
      case S2C.PARTICIPANT_LEAVE: {
        const { userId } = payload as unknown as LoggedPayloads['participant:leave'];
        useRoom.setState((s) => {
          const participants = { ...s.participants };
          delete participants[userId];
          return { participants };
        });
        break;
      }
      case S2C.ROOM_UPDATE:
        st.set({ room: (payload as unknown as LoggedPayloads['room:update']).room });
        break;
      case S2C.CHAT_MSG: {
        const { message } = payload as unknown as { message: ChatMessage };
        useRoom.setState((s) => ({
          chat: [...s.chat, message].slice(-200),
          chatCounts: message.system ? s.chatCounts : { ...s.chatCounts, [message.name]: (s.chatCounts[message.name] ?? 0) + 1 },
        }));
        if (!silent && meId && message.mentions.includes(meId) && message.userId !== meId) {
          toast.info(`${message.name} mentioned you`, message.text.slice(0, 80));
          sounds.pop();
        }
        break;
      }
      case S2C.QUEUE_UPDATE:
        st.set({ queue: (payload as unknown as LoggedPayloads['queue:update']).queue });
        break;
      case S2C.NEXT_UP: {
        const { nextUp } = payload as unknown as LoggedPayloads['queue:nextup'];
        st.set({ nextUp });
        if (!silent && nextUp) toast.info(`Next up: ${nextUp.title}`, 'Starting in 5 seconds');
        break;
      }
      case S2C.POLL_UPDATE:
      case S2C.POLL_CLOSED: {
        const { poll } = payload as unknown as LoggedPayloads['poll:update'];
        const isNew = !st.polls[poll.id];
        useRoom.setState((s) => ({ polls: { ...s.polls, [poll.id]: poll } }));
        if (!silent && isNew && poll.creatorId !== meId) toast.info(`New poll: ${poll.question}`, `by ${poll.creatorName}`);
        if (!silent && event === S2C.POLL_CLOSED && poll.result?.winnerId) {
          const w = poll.options.find((o) => o.id === poll.result!.winnerId);
          toast.success(`Poll closed: ${w?.label ?? '-'}`, poll.result.applied ?? poll.question);
        }
        break;
      }
      case S2C.HOST_CHANGED: {
        const h = payload as unknown as LoggedPayloads['host:changed'];
        useRoom.setState((s) => {
          const participants = { ...s.participants };
          const old = h.oldId ? participants[h.oldId] : undefined;
          if (old && old.role === 'HOST') participants[old.id] = { ...old, role: 'VIEWER' };
          const nu = participants[h.newId];
          if (nu) participants[h.newId] = { ...nu, role: 'HOST' };
          const me = s.me ? { ...s.me, role: s.me.id === h.newId ? ('HOST' as const) : s.me.id === h.oldId ? ('VIEWER' as const) : s.me.role } : s.me;
          return {
            participants,
            me,
            room: s.room ? { ...s.room, hostId: h.newId, hostEpoch: h.epoch } : s.room,
            hostRequests: [],
          };
        });
        if (!silent) {
          const name = this.store().participants[h.newId]?.name ?? 'Someone';
          if (h.newId === meId) toast.achievement("You're the host now", 'Crown acquired', '👑');
          else toast.achievement('Host transferred', `${name} wears the crown${h.reason === 'succession' ? ' (auto succession)' : ''}`, '👑');
          sounds.chime();
        }
        break;
      }
      case S2C.INTERMISSION:
        st.set({ intermission: (payload as unknown as LoggedPayloads['intermission:update']).intermission });
        break;
    }
  }

  private expireTyping(): void {
    const now = Date.now();
    const typing = this.store().typing;
    const stale = Object.entries(typing).filter(([, v]) => now - v.at > 4000);
    if (stale.length === 0) return;
    useRoom.setState((s) => {
      const next = { ...s.typing };
      for (const [k] of stale) delete next[k];
      return { typing: next };
    });
  }

  // ------------------------------------------------------------------ player

  /** Called by the player component after it created an adapter for the current media. */
  attachAdapter(adapter: PlayerAdapter, mediaId: string): void {
    this.detachAdapter();
    this.adapter = adapter;
    this.adapterMediaId = mediaId;
    const proxy: PlayerLike = {
      fineRate: adapter.fineRate,
      isReady: () => adapter.isReady(),
      getTime: () => adapter.getTime(),
      isPaused: () => adapter.isPaused(),
      isStalled: () => Date.now() < this.stallSimUntil || adapter.isStalled(),
      play: () => (Date.now() < this.stallSimUntil ? undefined : adapter.play()),
      pause: () => adapter.pause(),
      seek: (t) => adapter.seek(t),
      setRate: (r) => adapter.setRate(r),
      getRate: () => adapter.getRate(),
    };
    const prefs = usePrefs.getState();
    this.adapterOff.push(
      adapter.on('ready', () => {
        adapter.setVolume(prefs.volume);
        adapter.setMuted(prefs.muted);
        this.patchSync({ playerReady: true, mediaError: null });
        this.core.playerReady();
      }),
      adapter.on('duration', () => {
        const d = adapter.getDuration();
        if (d && !this.reportedDuration.has(mediaId)) {
          this.reportedDuration.add(mediaId);
          this.socket?.emit(C2S.MEDIA_DURATION, { mediaId, duration: d });
        }
        if (adapter.isReady()) this.core.playerReady();
      }),
      adapter.on('seeked', () => this.core.onSeeked()),
      adapter.on('ended', () => this.socket?.emit(C2S.ENDED, { mediaId })),
      adapter.on('error', (msg) => this.patchSync({ mediaError: msg ?? 'Playback error' })),
    );
    this.patchSync({ playerReady: false, needsGesture: false, mediaError: null, suggestResync: false });
    this.core.attachPlayer(proxy);
  }

  detachAdapter(adapter?: PlayerAdapter): void {
    if (adapter && adapter !== this.adapter) return;
    for (const off of this.adapterOff) off();
    this.adapterOff = [];
    this.adapter = null;
    this.adapterMediaId = null;
    this.core.attachPlayer(null);
  }

  get player(): PlayerAdapter | null {
    return this.adapter;
  }

  /** Current local media position (for the seekbar's rAF loop). */
  position(): number {
    return this.adapter?.getTime() ?? 0;
  }

  unlockPlayback(): void {
    this.patchSync({ needsGesture: false });
    this.core.unblock();
  }

  private applyChaos(c: ChaosApply): void {
    if (c.type === 'BUFFER') {
      this.stallSimUntil = Date.now() + c.ms;
      this.adapter?.pause();
      toast.warn('Chaos: your video is "buffering"', `${(c.ms / 1000).toFixed(1)}s of simulated stall`);
    } else if (c.type === 'DESYNC') {
      if (this.adapter) this.adapter.seek(this.adapter.getTime() + c.ms / 1000);
      toast.warn('Chaos: you were knocked out of sync', 'Watch the drift controller heal it');
    }
  }

  // ------------------------------------------------------------------ loops

  private tick(): void {
    if (this.disposed) return;
    this.core.tick();
    this.checkBuffering();
    const st = this.store();
    const core = this.core;
    const status = core.status();
    const drift = core.lastDriftMs;
    const mode = this.proxyStalled() ? 'BUFFERING' : core.drift.mode;
    const now = performance.now();
    let badge: SyncBadge;
    if (st.phase === 'offline' || st.phase === 'replaced') badge = 'OFFLINE';
    else if (status === 'NO_STATE' || status === 'NO_PLAYER' || status === 'LOADING' || status === 'BLOCKED') badge = 'LOADING';
    else if (status === 'PAUSED') badge = 'PAUSED';
    else if (status === 'STALLED' || now - this.lastHardSeekAt < 1500) badge = 'RESYNCING';
    else if (mode === 'NUDGING') badge = 'ADJUSTING';
    else if (drift != null && Math.abs(drift) < SYNC.syncedThresholdMs) badge = 'IN_SYNC';
    else badge = status === 'WAITING_START' ? 'IN_SYNC' : 'ADJUSTING';

    const playing = status === 'PLAYING';
    if (playing && drift != null && Math.abs(drift) < SYNC.syncedThresholdMs) {
      this.syncedSince ??= now;
      if (!this.syncedAnnounced && now - this.syncedSince >= SYNC.syncedHoldMs) {
        this.syncedAnnounced = true;
        toast.achievement('Synced!', `Within ${Math.round(Math.abs(drift))}ms of the room`, '✅');
        sounds.chime();
      }
    } else if (!playing || (drift != null && Math.abs(drift) >= SYNC.syncedThresholdMs)) {
      this.syncedSince = null;
    }

    const adapter = this.adapter;
    useRoom.setState((s) => ({
      sync: {
        ...s.sync,
        badge,
        driftMs: drift,
        mode,
        rttMs: this.clock.rttMs,
        offsetMs: this.clock.offsetMs,
        position: adapter?.getTime() ?? (s.state ? expectedPos(s.state, this.clock.serverNow()) : 0),
        duration: adapter?.getDuration() ?? s.state?.media?.durationSec ?? null,
        suggestResync: s.sync.suggestResync && badge !== 'IN_SYNC',
      },
      watchSeconds: playing ? s.watchSeconds + SYNC.driftLoopMs / 1000 : s.watchSeconds,
      inSyncSamples:
        playing && drift != null
          ? {
              total: s.inSyncSamples.total + 1,
              good: s.inSyncSamples.good + (Math.abs(drift) < SYNC.syncedThresholdMs ? 1 : 0),
            }
          : s.inSyncSamples,
    }));
  }

  private proxyStalled(): boolean {
    return !!this.adapter && (Date.now() < this.stallSimUntil || this.adapter.isStalled());
  }

  /** Report buffering only when it lasts > 400ms during active playback (PRD 8.6). */
  private checkBuffering(): void {
    const s = this.core.active;
    const a = this.adapter;
    const now = Date.now();
    const shouldReport =
      !!s &&
      !!a &&
      s.status === 'PLAYING' &&
      a.isReady() &&
      !this.core.blocked &&
      this.clock.serverNow() > s.anchorTime + 500 &&
      this.proxyStalled();
    if (shouldReport) {
      this.waitingSince ??= now;
      if (!this.bufferingReported && now - this.waitingSince >= SYNC.bufferReportDebounceMs) {
        this.bufferingReported = true;
        this.socket?.emit(C2S.BUFFERING, { state: 'START', pos: a!.getTime() });
      }
    } else {
      this.waitingSince = null;
      if (this.bufferingReported && !this.proxyStalled()) {
        this.bufferingReported = false;
        this.socket?.emit(C2S.BUFFERING, { state: 'END', pos: a?.getTime() ?? 0 });
      }
    }
  }

  private sendTelemetry(): void {
    const socket = this.socket;
    if (!socket?.connected || this.store().phase !== 'live') return;
    const drift = this.core.lastDriftMs;
    if (drift == null || !this.adapter) return;
    socket.volatile.emit(C2S.TELEMETRY, {
      drift: Math.round(drift * 10) / 10,
      mode: this.proxyStalled() ? 'BUFFERING' : this.core.drift.mode,
      rtt: Math.round(this.clock.rttMs * 10) / 10,
      offset: Math.round(this.clock.offsetMs),
      pos: Math.max(0, this.adapter.getTime()),
      rate: this.adapter.getRate(),
      hardSeeks: this.core.drift.totalHardSeeks,
    });
  }

  // ------------------------------------------------------------------ actions

  private async request(event: string, payload?: unknown, opts: { quiet?: boolean } = {}): Promise<AnyAck> {
    const res = (await this.emitAck(event, payload)) as AnyAck;
    if (!res.ok && !opts.quiet) toast.error(res.error.message);
    return res;
  }

  private async playback(event: string, payload: Record<string, unknown>, optimistic?: 'PLAYING' | 'PAUSED'): Promise<void> {
    if (optimistic) this.store().set({ optimisticStatus: optimistic });
    sounds.click();
    const res = await this.request(event, { eventId: uuid(), baseSeq: Math.max(0, this.core.latestSeqSeen), ...payload });
    if (!res.ok) this.store().set({ optimisticStatus: null });
    else if ((res as { vote?: boolean }).vote) {
      this.store().set({ optimisticStatus: null });
      toast.info('Vote started', 'The room decides playback in this room');
    }
  }

  play(): Promise<void> {
    return this.playback(C2S.PLAY, { pos: this.position() }, 'PLAYING');
  }
  pause(): Promise<void> {
    return this.playback(C2S.PAUSE, { pos: this.position() }, 'PAUSED');
  }
  seek(pos: number): Promise<void> {
    return this.playback(C2S.SEEK, { pos: Math.max(0, pos), final: true });
  }
  setRate(rate: number): Promise<void> {
    return this.playback(C2S.RATE, { rate });
  }
  loadMovie(movieId: string): Promise<AnyAck> {
    return this.request(C2S.LOAD, { movieId });
  }

  /** "Resync me": fetch a fresh snapshot and hard re-anchor. */
  async resync(): Promise<void> {
    const res = await this.emitAck<{ snapshot: Snapshot }>(C2S.RESYNC);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    this.applySnapshot(res.snapshot);
    this.core.forceResync();
    this.syncedAnnounced = false;
    this.syncedSince = null;
    this.patchSync({ suggestResync: false });
    toast.info('Resyncing...', 'Re-anchored to the room timeline');
  }

  async sendChat(text: string): Promise<void> {
    const item = { id: uuid(), text, at: Date.now() };
    useRoom.setState((s) => ({ outbox: [...s.outbox, item] }));
    if (this.socket?.connected && this.store().phase === 'live') await this.deliver(item);
  }

  private async deliver(item: { id: string; text: string }): Promise<void> {
    const res = await this.emitAck(C2S.CHAT_SEND, { id: item.id, text: item.text });
    if (res.ok) {
      useRoom.setState((s) => ({ outbox: s.outbox.filter((o) => o.id !== item.id) }));
      return;
    }
    // Offline/timeouts keep the message queued for resend; real rejections drop it.
    if (res.error.code !== 'INTERNAL') {
      useRoom.setState((s) => ({ outbox: s.outbox.filter((o) => o.id !== item.id) }));
      toast.error(res.error.message);
    }
  }

  private async flushOutbox(): Promise<void> {
    for (const item of this.store().outbox) await this.deliver(item);
  }

  typing(on: boolean): void {
    const now = Date.now();
    if (on && now - this.typingSentAt < 2000) return;
    this.typingSentAt = on ? now : 0;
    this.socket?.volatile.emit(C2S.CHAT_TYPING, { on });
  }

  react(emoji: string): void {
    void this.emitAck(C2S.REACTION_SEND, { emoji }).then((r) => {
      if (!r.ok && r.error.code === 'RATE_LIMITED') toast.warn('Easy there!', 'Max 10 reactions per second');
    });
  }

  queueAdd(input: { movieId?: string; url?: string; title?: string; playNext?: boolean }) {
    return this.request(C2S.QUEUE_ADD, input);
  }
  queueRemove(itemId: string) {
    return this.request(C2S.QUEUE_REMOVE, { itemId });
  }
  queueReorder(itemId: string, afterId: string | null, beforeId: string | null) {
    return this.request(C2S.QUEUE_REORDER, { itemId, afterId, beforeId, version: this.store().queue.version });
  }
  queueVote(itemId: string) {
    return this.request(C2S.QUEUE_VOTE, { itemId });
  }
  queuePlayNow(itemId: string) {
    return this.request(C2S.QUEUE_PLAY_NOW, { itemId });
  }

  pollCreate(input: unknown) {
    return this.request(C2S.POLL_CREATE, input);
  }
  async pollVote(pollId: string, optionId: string) {
    const res = await this.request(C2S.POLL_VOTE, { pollId, optionId });
    if (res.ok) useRoom.setState((s) => ({ myVotes: { ...s.myVotes, [pollId]: optionId } }));
    return res;
  }
  pollClose(pollId: string) {
    return this.request(C2S.POLL_CLOSE, { pollId });
  }

  hostTransfer(toUserId: string) {
    return this.request(C2S.HOST_TRANSFER, { toUserId });
  }
  async hostRequest() {
    const res = await this.request(C2S.HOST_REQUEST);
    if (res.ok) toast.info('Request sent', 'The host will see your request');
    return res;
  }
  hostRespond(userId: string, accept: boolean) {
    useRoom.setState((s) => ({ hostRequests: s.hostRequests.filter((r) => r.userId !== userId) }));
    return this.request(C2S.HOST_RESPOND, { userId, accept });
  }
  setRole(userId: string, role: 'MOD' | 'VIEWER') {
    return this.request(C2S.ROLE_SET, { userId, role });
  }
  updateSettings(patch: Record<string, unknown>) {
    return this.request(C2S.ROOM_SETTINGS, patch);
  }
  chaos(type: string, targetId?: string, params?: Record<string, number>) {
    return this.request(C2S.CHAOS, { type, targetId, params });
  }
  intermission(action: 'start' | 'cancel', minutes?: number) {
    return this.request(C2S.INTERMISSION, action === 'start' ? { action, minutes } : { action });
  }
  async recommend() {
    return this.emitAck<{ recommendations: Recommendation[] }>(C2S.RECOMMEND);
  }
  async subscribeMetrics(on: boolean): Promise<void> {
    const res = await this.emitAck<{ metrics?: SyncMetrics }>(C2S.METRICS_SUB, { on });
    if (res.ok && res.metrics) this.store().set({ metrics: res.metrics });
  }

  get mediaId(): string | null {
    return this.adapterMediaId;
  }
}
