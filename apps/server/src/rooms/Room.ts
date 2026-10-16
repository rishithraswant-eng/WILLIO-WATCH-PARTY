import { randomInt } from 'node:crypto';
import {
  LIMITS,
  S2C,
  SYNC,
  applyTransition,
  canChangeRate,
  canClosePoll,
  canEditSettings,
  canIntermission,
  canManageQueue,
  canRemoveQueueItem,
  canSetRoles,
  canUseChaos,
  computeLead,
  decideWinner,
  detectStreamType,
  expectedPos,
  formatTime,
  initialPlaybackState,
  keyBetween,
  mediaIdForUrl,
  playbackPermission,
  shortId,
  tallyVotes,
  titleFromUrl,
  type CausedBy,
  type ChatMessage,
  type Heatmap,
  type Intermission,
  type JoinAck,
  type LoggedEvent,
  type LoggedEventName,
  type LoggedPayloads,
  type MediaSource,
  type Movie,
  type NextUp,
  type ParticipantInfo,
  type PlaybackAction,
  type PlaybackCause,
  type PlaybackState,
  type Poll,
  type PollCreateInput,
  type PollOption,
  type PollPayload,
  type PollType,
  type QueueItem,
  type QueueState,
  type ReactionBurst,
  type Recommendation,
  type Role,
  type RoomInfo,
  type RoomSettings,
  type Snapshot,
  type StateUpdate,
  type SyncLogEntry,
  type SyncMetrics,
  type TasteVector,
  type TelemetryReport,
  type ToastPayload,
  type Transition,
  type ChaosType,
  type HostChangeReason,
  type ControlMode,
} from '@willio/shared';
import { EventLog, LruMap } from '../util/collections';
import { findMentions, parseSlash, sanitizeChat, sanitizeLine } from '../util/text';
import { PropagationTracker } from './metrics';
import { RoomError, type Participant, type RoomDeps, type SessionUser } from './types';

interface PollRuntime {
  id: string;
  question: string;
  type: PollType;
  options: PollOption[];
  anonymous: boolean;
  creatorId: string | null;
  creatorName: string;
  createdAt: number;
  endsAt: number;
  status: 'OPEN' | 'CLOSED';
  payload: PollPayload | null;
  result: Poll['result'];
  votes: Map<string, string>;
}

export interface PersistedRoom {
  v: 1;
  code: string;
  dbId: string;
  name: string;
  passwordHash: string | null;
  maxUsers: number;
  createdAt: number;
  settings: RoomSettings;
  hostId: string | null;
  hostEpoch: number;
  isDemo: boolean;
  participants: { id: string; name: string; avatarSeed: string; role: Role; joinedAt: number; taste: TasteVector | null }[];
  state: PlaybackState;
  queue: QueueItem[];
  queueVersion: number;
  polls: (Omit<PollRuntime, 'votes'> & { votes: [string, string][] })[];
  chat: ChatMessage[];
  roomHeat: { mediaId: string; bins: number[] } | null;
  intermission: Intermission | null;
  resumeAfterIntermission: boolean;
  eseq: number;
  lastActiveAt: number;
}

export interface CreateRoomOptions {
  code: string;
  name: string;
  passwordHash: string | null;
  hostId: string | null;
  maxUsers: number;
  controlMode?: ControlMode;
  isDemo?: boolean;
  initialMedia?: MediaSource | null;
}

const YES_NO = (yes = 'Yes', no = 'No'): PollOption[] => [
  { id: 'yes', label: yes },
  { id: 'no', label: no },
];

const ACTION_VERB: Record<PlaybackCause, string> = {
  play: 'pressed play',
  pause: 'paused',
  seek: 'seeked',
  rate: 'changed speed',
  load: 'started',
  buffering: 'is buffering - waiting',
  resume: 'resumed',
  poll: 'poll result applied',
  intermission: 'intermission',
  ended: 'finished',
  system: 'updated playback',
};

export function mediaFromMovie(m: Movie): MediaSource | null {
  if (!m.streamUrl || !m.streamType) return null;
  return {
    id: m.id,
    title: m.title,
    url: m.streamUrl,
    type: m.streamType,
    posterUrl: m.posterUrl,
    durationSec: null,
    movieId: m.id,
  };
}

/**
 * One watch-party room. All mutations run through `enqueue` (a per-room promise chain), which
 * gives a total order; every broadcast that changes client state is logged with an eseq so a
 * reconnecting client can replay what it missed.
 */
export class Room {
  readonly code: string;
  readonly dbId: string;
  name: string;
  passwordHash: string | null;
  maxUsers: number;
  readonly createdAt: number;
  readonly isDemo: boolean;
  settings: RoomSettings;
  hostId: string | null;
  hostEpoch = 0;
  participants = new Map<string, Participant>();
  state: PlaybackState = initialPlaybackState();
  queue: QueueItem[] = [];
  queueVersion = 0;
  nextUp: NextUp | null = null;
  polls = new Map<string, PollRuntime>();
  chat: ChatMessage[] = [];
  roomHeat: { mediaId: string; bins: number[] } | null = null;
  intermission: Intermission | null = null;
  lastActiveAt = Date.now();
  emptySince: number | null = Date.now();
  eseq = 0;
  readonly metrics: PropagationTracker;

  private eventLog = new EventLog(LIMITS.eventRing);
  private dedupe = new LruMap<string, number>(LIMITS.dedupeLru);
  private chatIds = new LruMap<string, string>(LIMITS.dedupeLru);
  private chain: Promise<unknown> = Promise.resolve();
  private syncLogEntries: SyncLogEntry[] = [];
  private removeTimers = new Map<string, NodeJS.Timeout>();
  private pollTimers = new Map<string, NodeJS.Timeout>();
  private hostTimer: NodeJS.Timeout | null = null;
  private bufferTimer: NodeJS.Timeout | null = null;
  private nextUpTimer: NodeJS.Timeout | null = null;
  private intermissionTimer: NodeJS.Timeout | null = null;
  private reactionTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout;
  private reactionBuf = new Map<string, { count: number; tsSum: number }>();
  private heatDirty = false;
  private lastHeatSent = 0;
  private lastMetricsSent = 0;
  private resumeAfterIntermission = false;
  private serverDelay = { ms: 0, until: 0 };
  private disposed = false;

  constructor(
    private readonly deps: RoomDeps,
    opts: CreateRoomOptions,
  ) {
    this.code = opts.code;
    this.createdAt = Date.now();
    this.dbId = `${opts.code}-${this.createdAt.toString(36)}`;
    this.name = opts.name;
    this.passwordHash = opts.passwordHash;
    this.maxUsers = opts.maxUsers;
    this.hostId = opts.hostId;
    this.isDemo = !!opts.isDemo;
    this.settings = {
      controlMode: opts.controlMode ?? 'HOST_ONLY',
      waitPolicy: 'WAIT_FOR_ALL',
      queueMode: 'HOST_ONLY',
      tieBreak: 'HOST_VOTE',
    };
    if (opts.initialMedia) {
      this.state = applyTransition(this.state, { type: 'load', media: opts.initialMedia, autoplay: false }, {
        now: Date.now(),
        lead: 0,
        userId: null,
      }).state;
      this.roomHeat = { mediaId: opts.initialMedia.id, bins: [] };
    }
    this.metrics = new PropagationTracker((seq, info) => {
      const s = [...info.samples].sort((a, b) => a - b);
      this.deps.durable.propagation({
        roomId: this.dbId,
        seq,
        action: info.action,
        users: info.users,
        p50: s[Math.floor(s.length * 0.5)] ?? 0,
        p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0,
        max: s[s.length - 1] ?? 0,
      });
    });
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.tickTimer.unref();
  }

  // ------------------------------------------------------------------ infrastructure

  /** Serialise a mutation behind every earlier one (total order per room). */
  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.disposed) throw new RoomError('NOT_FOUND', 'Room closed');
      if (this.serverDelay.ms > 0 && Date.now() < this.serverDelay.until) {
        await new Promise((r) => setTimeout(r, this.serverDelay.ms));
      }
      this.metrics.countEvent();
      return fn();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private timeout(fn: () => void, ms: number): NodeJS.Timeout {
    const t = setTimeout(() => {
      if (this.disposed) return;
      this.enqueue(fn).catch((err: unknown) => this.deps.log.error({ err, code: this.code }, 'room timer failed'));
    }, ms);
    t.unref();
    return t;
  }

  private chaosFor(p: Participant): Participant['chaos'] {
    if (p.chaos && Date.now() > p.chaos.until) {
      p.chaos = null;
      this.syncLog('chaos', `chaos on ${p.name} ended`);
    }
    return p.chaos;
  }

  /**
   * One-way delay injected for a user (Chaos Mode). The configured latency is extra RTT and is
   * split evenly between the inbound and outbound legs, so clock-offset estimation stays unbiased.
   */
  chaosOneWayMs(userId: string): number {
    const p = this.participants.get(userId);
    return p ? (this.chaosFor(p)?.latencyMs ?? 0) / 2 : 0;
  }

  private deliverTo(p: Participant, event: string, payload: unknown): void {
    if (!p.socketId) return;
    const c = this.chaosFor(p);
    if (c && c.dropPct > 0 && Math.random() < c.dropPct) return;
    const socketId = p.socketId;
    if (c && c.latencyMs > 0) {
      setTimeout(() => this.deps.io.toSocket(socketId, event, payload), c.latencyMs / 2).unref();
    } else this.deps.io.toSocket(socketId, event, payload);
  }

  /** Broadcast to every socket of the room, honouring per-user chaos (latency / drops). */
  private send(event: string, payload: unknown, exceptUserId?: string): void {
    const affected: Participant[] = [];
    const except: string[] = [];
    for (const p of this.participants.values()) {
      if (!p.socketId) continue;
      if (p.id === exceptUserId) {
        except.push(p.socketId);
        continue;
      }
      if (this.chaosFor(p)) {
        affected.push(p);
        except.push(p.socketId);
      }
    }
    this.deps.io.toRoom(this.code, event, payload, except);
    for (const p of affected) this.deliverTo(p, event, payload);
  }

  private emitLogged<E extends LoggedEventName>(event: E, payload: LoggedPayloads[E]): void {
    this.eseq++;
    const full = { ...payload, eseq: this.eseq };
    this.eventLog.push({ eseq: this.eseq, event, payload: full });
    this.send(event, full);
    this.lastActiveAt = Date.now();
    this.deps.onChange(this.code);
  }

  private toUser(userId: string, event: string, payload: unknown): void {
    const p = this.participants.get(userId);
    if (p) this.deliverTo(p, event, payload);
  }

  private toast(userId: string | null, t: ToastPayload): void {
    if (userId) this.toUser(userId, S2C.TOAST, t);
    else this.send(S2C.TOAST, t);
  }

  private syncLog(kind: SyncLogEntry['kind'], text: string): void {
    this.syncLogEntries.push({ ts: Date.now(), kind, text });
    if (this.syncLogEntries.length > LIMITS.syncLogSize) this.syncLogEntries.shift();
  }

  requireParticipant(userId: string, socketId?: string): Participant {
    const p = this.participants.get(userId);
    if (!p) throw new RoomError('NOT_FOUND', 'You are not in this room');
    if (socketId && p.socketId !== socketId) throw new RoomError('UNAUTHORIZED', 'This session was opened elsewhere');
    return p;
  }

  private connected(): Participant[] {
    return [...this.participants.values()].filter((p) => p.connected);
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.participants.values()) if (p.connected) n++;
    return n;
  }

  /** Scheduled-start lead adapted to the worst fresh RTT in the room. */
  currentLead(now = Date.now()): number {
    let maxRtt = 0;
    for (const p of this.participants.values()) {
      if (!p.connected || !p.tele || now - p.tele.updatedAt > 30_000) continue;
      maxRtt = Math.max(maxRtt, p.tele.rtt);
    }
    return computeLead(maxRtt);
  }

  private touch(): void {
    this.lastActiveAt = Date.now();
  }

  // ------------------------------------------------------------------ views

  info(): RoomInfo {
    return {
      code: this.code,
      name: this.name,
      hostId: this.hostId,
      hostEpoch: this.hostEpoch,
      hasPassword: !!this.passwordHash,
      maxUsers: this.maxUsers,
      createdAt: this.createdAt,
      settings: { ...this.settings },
      chaosEnabled: this.deps.chaosEnabled,
    };
  }

  participantInfo(p: Participant): ParticipantInfo {
    return {
      id: p.id,
      name: p.name,
      avatarSeed: p.avatarSeed,
      role: p.role,
      joinedAt: p.joinedAt,
      connected: p.connected,
      hasTaste: !!p.taste && (Object.keys(p.taste.genres).length > 0 || p.taste.likedIds.length > 0),
    };
  }

  private sortedQueue(): QueueItem[] {
    return [...this.queue].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  }

  queueState(): QueueState {
    return { version: this.queueVersion, items: this.sortedQueue() };
  }

  private pollView(rt: PollRuntime): Poll {
    const counts = tallyVotes(rt.options, rt.votes);
    let voters: Record<string, string[]> | null = null;
    if (!rt.anonymous) {
      voters = {};
      for (const o of rt.options) voters[o.id] = [];
      for (const [uid, oid] of rt.votes) voters[oid]?.push(uid);
    }
    return {
      id: rt.id,
      question: rt.question,
      type: rt.type,
      options: rt.options,
      anonymous: rt.anonymous,
      creatorId: rt.creatorId,
      creatorName: rt.creatorName,
      createdAt: rt.createdAt,
      endsAt: rt.endsAt,
      status: rt.status,
      counts,
      voters,
      totalVotes: rt.votes.size,
      result: rt.result,
      payload: rt.payload,
    };
  }

  heatmap(): Heatmap | null {
    const mediaId = this.state.media?.id;
    if (!mediaId) return null;
    const bins = this.roomHeat?.mediaId === mediaId ? this.roomHeat.bins.slice() : [];
    return { mediaId, binSec: LIMITS.heatBinSec, bins, crowd: this.deps.heat.get(mediaId) };
  }

  snapshotFor(userId: string): Snapshot {
    const me = this.participants.get(userId);
    const myVotes: Record<string, string> = {};
    for (const rt of this.polls.values()) {
      const v = rt.votes.get(userId);
      if (v) myVotes[rt.id] = v;
    }
    return {
      bootId: this.deps.bootId,
      eseq: this.eseq,
      serverNow: Date.now(),
      room: this.info(),
      me: { id: userId, role: me?.role ?? 'VIEWER' },
      participants: [...this.participants.values()].map((p) => this.participantInfo(p)),
      state: this.state,
      queue: this.queueState(),
      nextUp: this.nextUp,
      polls: [...this.polls.values()].map((rt) => this.pollView(rt)),
      myVotes,
      chatTail: this.chat.slice(-LIMITS.chatHistory),
      heatmap: this.heatmap(),
      intermission: this.intermission,
    };
  }

  /** Events after lastEseq, or null when a snapshot is required. */
  replaySince(lastEseq: number, bootId: string): LoggedEvent[] | null {
    if (bootId !== this.deps.bootId) return null;
    return this.eventLog.since(lastEseq, this.eseq);
  }

  // ------------------------------------------------------------------ presence & host

  join(user: SessionUser, socketId: string, taste: TasteVector | undefined, lastEseq?: number, bootId?: string): JoinAck {
    const now = Date.now();
    let p = this.participants.get(user.id);
    let replacedSocket: string | null = null;
    if (!p) {
      if (this.connectedCount() >= this.maxUsers) throw new RoomError('ROOM_FULL', `Room is full (${this.maxUsers} max)`);
      p = {
        id: user.id,
        name: user.name,
        avatarSeed: user.seed,
        role: 'VIEWER',
        joinedAt: now,
        connected: true,
        socketId,
        lastSeenAt: now,
        taste: taste ?? null,
        buffering: false,
        catchUpUntil: 0,
        tele: null,
        lastSampleAt: 0,
        chaos: null,
      };
      this.participants.set(user.id, p);
      if (this.hostId === user.id) p.role = 'HOST';
      this.emitLogged(S2C.PARTICIPANT_JOIN, { participant: this.participantInfo(p) });
      this.systemChat(`${p.name} joined the party`);
      this.syncLog('join', `${p.name} joined`);
      this.deps.durable.user({ id: p.id, name: p.name, avatarSeed: p.avatarSeed, tasteVector: p.taste });
      this.deps.durable.participant({ roomId: this.dbId, userId: p.id, role: p.role, joinedAt: new Date(now), leftAt: null });
    } else {
      if (p.socketId && p.socketId !== socketId) replacedSocket = p.socketId;
      const wasConnected = p.connected;
      p.connected = true;
      p.socketId = socketId;
      p.lastSeenAt = now;
      const changedName = p.name !== user.name || p.avatarSeed !== user.seed;
      p.name = user.name;
      p.avatarSeed = user.seed;
      if (taste) p.taste = taste;
      const rt = this.removeTimers.get(p.id);
      if (rt) {
        clearTimeout(rt);
        this.removeTimers.delete(p.id);
      }
      if (!wasConnected || changedName || taste) {
        this.emitLogged(S2C.PARTICIPANT_UPDATE, { participant: this.participantInfo(p) });
        if (!wasConnected) this.syncLog('join', `${p.name} reconnected`);
      }
    }
    if (taste && p.taste === taste) {
      this.deps.durable.user({ id: p.id, name: p.name, avatarSeed: p.avatarSeed, tasteVector: taste });
    }

    if (this.hostId === p.id) {
      if (this.hostTimer) {
        clearTimeout(this.hostTimer);
        this.hostTimer = null;
      }
      p.role = 'HOST';
    } else {
      this.promoteIfHostless(p);
    }
    this.emptySince = null;
    this.touch();
    void this.presence(p);

    if (replacedSocket) {
      this.deps.io.toSocket(replacedSocket, S2C.SESSION_REPLACED, {});
      this.deps.io.disconnect(replacedSocket, 'replaced');
    }

    if (lastEseq != null && bootId) {
      const events = this.replaySince(lastEseq, bootId);
      if (events) return { ok: true, mode: 'replay', events, serverNow: Date.now(), me: { id: p.id, role: p.role } };
    }
    return { ok: true, mode: 'snapshot', snapshot: this.snapshotFor(p.id) };
  }

  /** A room without a reachable host promotes the newcomer (or the next in line). */
  private promoteIfHostless(candidate: Participant): void {
    const host = this.hostId ? this.participants.get(this.hostId) : undefined;
    const roomAgeMs = Date.now() - this.createdAt;
    const hostMissing = !this.hostId || (!host && (roomAgeMs > 30_000 || this.isDemo));
    const hostGone = !!host && !host.connected && this.hostTimer == null;
    if (hostMissing || hostGone) this.setHost(candidate.id, 'succession');
  }

  disconnect(userId: string, socketId: string): void {
    const p = this.participants.get(userId);
    if (!p || p.socketId !== socketId) return; // replaced by a newer tab
    const now = Date.now();
    p.connected = false;
    p.socketId = null;
    p.lastSeenAt = now;
    p.chaos = null;
    if (p.buffering) {
      p.buffering = false;
      this.maybeResumeFromBuffering();
    }
    this.emitLogged(S2C.PARTICIPANT_UPDATE, { participant: this.participantInfo(p) });
    this.syncLog('leave', `${p.name} disconnected`);
    void this.presence(p);

    const existing = this.removeTimers.get(userId);
    if (existing) clearTimeout(existing);
    this.removeTimers.set(
      userId,
      this.timeout(() => this.removeParticipant(userId), SYNC.participantGraceMs),
    );
    if (this.hostId === userId) {
      const epoch = this.hostEpoch;
      if (this.hostTimer) clearTimeout(this.hostTimer);
      this.hostTimer = this.timeout(() => {
        this.hostTimer = null;
        this.hostGraceExpired(userId, epoch);
      }, SYNC.hostGraceMs);
    }
    if (this.connectedCount() === 0) this.emptySince = now;
  }

  private removeParticipant(userId: string): void {
    this.removeTimers.delete(userId);
    const p = this.participants.get(userId);
    if (!p || p.connected) return;
    this.participants.delete(userId);
    this.emitLogged(S2C.PARTICIPANT_LEAVE, { userId });
    this.systemChat(`${p.name} left`);
    this.deps.durable.participant({
      roomId: this.dbId,
      userId,
      role: p.role,
      joinedAt: new Date(p.joinedAt),
      leftAt: new Date(),
    });
    void this.deps.kvPresence?.(this.code, userId, null);
  }

  private hostGraceExpired(oldHostId: string, epoch: number): void {
    if (this.hostEpoch !== epoch || this.hostId !== oldHostId) return;
    const host = this.participants.get(oldHostId);
    if (host?.connected) return;
    this.succeedHost();
  }

  /** Promote the longest-connected participant (tie: lowest id). */
  private succeedHost(): void {
    const candidates = this.connected()
      .filter((p) => p.id !== this.hostId)
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
    const next = candidates[0];
    if (next) this.setHost(next.id, 'succession');
  }

  private setHost(newId: string, reason: HostChangeReason): void {
    const next = this.participants.get(newId);
    if (!next) return;
    const oldId = this.hostId;
    if (oldId === newId) return;
    const old = oldId ? this.participants.get(oldId) : undefined;
    if (old && old.role === 'HOST') old.role = 'VIEWER';
    next.role = 'HOST';
    this.hostId = newId;
    this.hostEpoch++;
    if (this.hostTimer) {
      clearTimeout(this.hostTimer);
      this.hostTimer = null;
    }
    this.emitLogged(S2C.HOST_CHANGED, { oldId, newId, reason, epoch: this.hostEpoch });
    const why =
      reason === 'succession'
        ? old
          ? ` (${old.name} dropped)`
          : ''
        : reason === 'request'
          ? ' (request accepted)'
          : '';
    this.systemChat(`👑 ${next.name} is now the host${why}`);
    this.syncLog('host', `host -> ${next.name} (${reason})`);
    this.persistRoomRecord();
    this.deps.durable.participant({ roomId: this.dbId, userId: next.id, role: 'HOST', joinedAt: new Date(next.joinedAt), leftAt: null });
  }

  hostTransfer(userId: string, toUserId: string): void {
    if (this.hostId !== userId) throw new RoomError('FORBIDDEN', 'Only the host can hand over the crown');
    if (toUserId === userId) throw new RoomError('INVALID', 'You are already the host');
    const target = this.participants.get(toUserId);
    if (!target || !target.connected) throw new RoomError('NOT_FOUND', 'That person is not connected');
    this.setHost(toUserId, 'transfer');
  }

  hostRequest(userId: string): void {
    const p = this.requireParticipant(userId);
    if (this.hostId === userId) throw new RoomError('INVALID', 'You are already the host');
    const host = this.hostId ? this.participants.get(this.hostId) : undefined;
    if (!host || !host.connected) {
      this.setHost(userId, 'claim');
      return;
    }
    this.toUser(host.id, S2C.HOST_REQUESTED, { userId: p.id, name: p.name });
  }

  hostRespond(userId: string, requesterId: string, accept: boolean): void {
    if (this.hostId !== userId) throw new RoomError('FORBIDDEN', 'Only the host can answer');
    const r = this.participants.get(requesterId);
    if (!r || !r.connected) throw new RoomError('NOT_FOUND', 'That person left');
    if (accept) this.setHost(requesterId, 'request');
    else this.toast(requesterId, { kind: 'info', title: 'Host request declined' });
  }

  setRole(userId: string, targetId: string, role: 'MOD' | 'VIEWER'): void {
    const p = this.requireParticipant(userId);
    if (!canSetRoles(p.role)) throw new RoomError('FORBIDDEN', 'Only the host can change roles');
    const t = this.participants.get(targetId);
    if (!t) throw new RoomError('NOT_FOUND', 'Unknown participant');
    if (t.id === this.hostId) throw new RoomError('INVALID', 'Transfer host instead');
    t.role = role;
    this.emitLogged(S2C.PARTICIPANT_UPDATE, { participant: this.participantInfo(t) });
    this.systemChat(role === 'MOD' ? `🛡️ ${t.name} is now a moderator` : `${t.name} is a viewer again`);
  }

  private async presence(p: Participant): Promise<void> {
    await this.deps.kvPresence?.(this.code, p.id, { connected: p.connected, lastSeen: p.lastSeenAt });
  }

  // ------------------------------------------------------------------ playback

  private commit(t: Transition, causedBy: CausedBy): StateUpdate {
    const now = Date.now();
    const lead = this.currentLead(now);
    const { state, scheduledAt } = applyTransition(this.state, t, { now, lead, userId: causedBy.userId });
    this.state = state;
    if (state.status !== 'BUFFERING') {
      if (this.bufferTimer) {
        clearTimeout(this.bufferTimer);
        this.bufferTimer = null;
      }
      for (const p of this.participants.values()) p.buffering = false;
    }
    const update: StateUpdate = { state, seq: state.seq, causedBy, scheduledAt, serverTs: Date.now() };
    this.metrics.onBroadcast(state.seq, update.serverTs, causedBy.action, this.connectedCount());
    this.emitLogged(S2C.STATE_UPDATE, update);
    const at = state.media ? ` @ ${formatTime(state.anchorPos)}` : '';
    this.syncLog('state', `#${state.seq} ${causedBy.name} ${ACTION_VERB[causedBy.action]}${at} (lead ${scheduledAt - now}ms)`);
    return update;
  }

  private loadMedia(media: MediaSource, autoplay: boolean, causedBy: CausedBy): void {
    this.cancelNextUp();
    this.commit({ type: 'load', media, autoplay }, causedBy);
    this.roomHeat = { mediaId: media.id, bins: [] };
    this.heatDirty = true;
    this.persistRoomRecord();
  }

  playback(
    userId: string,
    socketId: string,
    action: PlaybackAction,
    data: { eventId: string; baseSeq: number; pos?: number; rate?: number; final?: boolean },
  ): { seq: number; duplicate?: boolean; vote?: boolean } {
    const p = this.requireParticipant(userId, socketId);
    const dedupeKey = `${userId}:${data.eventId}`;
    const dup = this.dedupe.get(dedupeKey);
    if (dup !== undefined) return { seq: dup, duplicate: true };

    if (action === 'rate') {
      if (!canChangeRate(p.role)) throw new RoomError('FORBIDDEN', 'Only the host or a moderator can change speed');
    } else {
      const perm = playbackPermission(p.role, this.settings.controlMode);
      if (perm === 'DENY') throw new RoomError('FORBIDDEN', 'The host controls playback in this room');
      if (perm === 'VOTE') {
        if (!this.state.media) throw new RoomError('INVALID', 'Nothing is loaded yet');
        this.createControlPoll(p, action, data.pos);
        this.dedupe.set(dedupeKey, this.state.seq);
        return { seq: this.state.seq, vote: true };
      }
    }
    if (!this.state.media) throw new RoomError('INVALID', 'Nothing is loaded yet - pick something from Discover or the queue');
    if (action === 'seek' && data.pos == null) throw new RoomError('INVALID', 'Seek needs a position');
    if (action === 'seek' && data.final === false && this.state.status === 'PLAYING') {
      return { seq: this.state.seq };
    }
    if (action === 'play' && this.intermission) this.endIntermission(false);

    const t: Transition =
      action === 'play'
        ? { type: 'play' }
        : action === 'pause'
          ? { type: 'pause' }
          : action === 'seek'
            ? { type: 'seek', pos: data.pos ?? 0 }
            : { type: 'rate', rate: data.rate ?? 1 };
    if (action === 'play' || action === 'seek') this.cancelNextUp();
    const u = this.commit(t, { userId: p.id, name: p.name, action });
    this.dedupe.set(dedupeKey, u.seq);
    return { seq: u.seq };
  }

  buffering(userId: string, socketId: string, kind: 'START' | 'END'): void {
    const p = this.requireParticipant(userId, socketId);
    const now = Date.now();
    if (kind === 'START') {
      if (now < p.catchUpUntil) return; // laggard in catch-up mode: the room no longer waits
      if (p.buffering) return;
      p.buffering = true;
      this.syncLog('buffering', `${p.name} is buffering`);
      if (
        this.settings.waitPolicy === 'WAIT_FOR_ALL' &&
        this.state.status === 'PLAYING' &&
        now >= this.state.anchorTime + 500
      ) {
        this.commit({ type: 'buffer' }, { userId: p.id, name: p.name, action: 'buffering' });
        if (this.bufferTimer) clearTimeout(this.bufferTimer);
        this.bufferTimer = this.timeout(() => this.bufferTimeout(), SYNC.bufferWaitTimeoutMs);
      }
    } else {
      if (!p.buffering) return;
      p.buffering = false;
      this.maybeResumeFromBuffering();
    }
  }

  private maybeResumeFromBuffering(): void {
    if (this.state.status !== 'BUFFERING') return;
    if (this.connected().some((p) => p.buffering)) return;
    this.commit({ type: 'resume' }, { userId: null, name: 'Everyone', action: 'resume' });
  }

  private bufferTimeout(): void {
    this.bufferTimer = null;
    if (this.state.status !== 'BUFFERING') return;
    const laggards = this.connected().filter((p) => p.buffering);
    const now = Date.now();
    for (const p of laggards) p.catchUpUntil = now + SYNC.catchUpMs;
    this.commit({ type: 'resume' }, { userId: null, name: 'Room', action: 'resume' });
    if (laggards.length > 0) {
      const names = laggards.map((p) => p.name).join(', ');
      this.toast(null, { kind: 'warn', title: `Not waiting for ${names}`, text: "They'll catch up automatically" });
      this.syncLog('buffering', `waited ${SYNC.bufferWaitTimeoutMs}ms, ${names} -> catch-up mode`);
    }
  }

  ended(userId: string, mediaId: string): void {
    this.requireParticipant(userId);
    this.checkEnded(mediaId, false);
  }

  private checkEnded(mediaId: string, serverDetected: boolean): void {
    const s = this.state;
    if (!s.media || s.media.id !== mediaId || s.ended || s.status !== 'PLAYING') return;
    const now = Date.now();
    if (now < s.anchorTime) return;
    const pos = expectedPos(s, now);
    const dur = s.media.durationSec;
    if (dur != null && pos < dur - 3) return;
    if (dur == null && pos < 5) return;
    this.commit({ type: 'end' }, { userId: null, name: serverDetected ? 'Server' : 'Playback', action: 'ended' });
    this.systemChat(`🎬 "${s.media.title}" finished`);
    this.afterEnd();
  }

  private afterEnd(): void {
    if (this.queue.length > 0) {
      this.scheduleNextUp();
      return;
    }
    if (this.connectedCount() >= 2 && ![...this.polls.values()].some((p) => p.status === 'OPEN' && p.type === 'NEXT_MOVIE')) {
      this.autoNextMoviePoll();
    }
  }

  private scheduleNextUp(): void {
    const first = this.sortedQueue()[0];
    if (!first) return;
    if (this.nextUpTimer) clearTimeout(this.nextUpTimer);
    this.nextUp = { itemId: first.id, title: first.title, at: Date.now() + SYNC.nextUpCountdownMs };
    this.emitLogged(S2C.NEXT_UP, { nextUp: this.nextUp });
    this.nextUpTimer = this.timeout(() => {
      this.nextUpTimer = null;
      if (this.nextUp?.itemId === first.id && this.queue.some((q) => q.id === first.id)) {
        this.playItem(first.id, { userId: null, name: 'Auto-advance', action: 'load' });
      } else this.cancelNextUp();
    }, SYNC.nextUpCountdownMs);
  }

  private cancelNextUp(): void {
    if (this.nextUpTimer) {
      clearTimeout(this.nextUpTimer);
      this.nextUpTimer = null;
    }
    if (this.nextUp) {
      this.nextUp = null;
      this.emitLogged(S2C.NEXT_UP, { nextUp: null });
    }
  }

  setDuration(mediaId: string, duration: number): void {
    const m = this.state.media;
    if (!m || m.id !== mediaId || m.durationSec != null || !(duration > 1)) return;
    this.state = { ...this.state, media: { ...m, durationSec: Math.round(duration * 1000) / 1000 } };
    this.deps.onChange(this.code);
  }

  /** Periodic housekeeping: server-side end detection, heatmap + metrics pushes. */
  private tick(): void {
    if (this.disposed) return;
    const now = Date.now();
    const s = this.state;
    if (s.media && s.status === 'PLAYING' && s.media.durationSec != null && !s.ended) {
      if (expectedPos(s, now) > s.media.durationSec + 2) {
        const mediaId = s.media.id;
        this.enqueue(() => this.checkEnded(mediaId, true)).catch(() => undefined);
      }
    }
    if (this.heatDirty && now - this.lastHeatSent >= 2000) {
      this.heatDirty = false;
      this.lastHeatSent = now;
      const h = this.heatmap();
      if (h) this.send(S2C.HEATMAP, { heatmap: h });
    }
    if (now - this.lastMetricsSent >= SYNC.metricsBroadcastMs && this.deps.io.hasMetricsSubscribers(this.code)) {
      this.lastMetricsSent = now;
      this.deps.io.toMetrics(this.code, S2C.METRICS, this.metricsPayload(now));
    }
  }

  // ------------------------------------------------------------------ telemetry & metrics

  telemetry(userId: string, r: TelemetryReport): void {
    const p = this.participants.get(userId);
    if (!p) return;
    const now = Date.now();
    const prev = p.tele;
    const history = prev ? prev.history.slice(-(LIMITS.driftHistory - 1)) : [];
    history.push(Math.round(r.drift));
    const corrected = r.mode === 'HARD_SEEK' || (prev != null && r.hardSeeks > prev.hardSeeks);
    if (prev && r.hardSeeks > prev.hardSeeks) {
      this.syncLog('hard-seek', `${p.name} hard-seeked (${r.hardSeeks - prev.hardSeeks}x, drift now ${Math.round(r.drift)}ms)`);
    }
    p.tele = {
      ...r,
      updatedAt: now,
      lastCorrectionAt: corrected ? now : (prev?.lastCorrectionAt ?? null),
      history,
    };
    if (now - p.lastSampleAt >= 10_000) {
      p.lastSampleAt = now;
      this.deps.durable.syncSample({
        roomId: this.dbId,
        userId,
        rttMs: r.rtt,
        offsetMs: r.offset,
        driftMs: r.drift,
        mode: r.mode,
      });
    }
  }

  syncAck(_userId: string, seq: number, recvServerTs: number): void {
    this.metrics.onAck(seq, recvServerTs);
  }

  resyncRequested(userId: string): Snapshot {
    const p = this.requireParticipant(userId);
    this.syncLog('resync', `${p.name} requested a resync`);
    return this.snapshotFor(userId);
  }

  metricsPayload(now = Date.now()): SyncMetrics {
    const prop = this.metrics.summary(now);
    const users = [...this.participants.values()].map((p) => {
      const fresh = p.tele && now - p.tele.updatedAt < 10_000 ? p.tele : null;
      const c = p.chaos && now <= p.chaos.until ? p.chaos : null;
      const chaos: string[] = [];
      if (c?.latencyMs) chaos.push(`+${c.latencyMs}ms`);
      if (c?.dropPct) chaos.push(`${Math.round(c.dropPct * 100)}% drop`);
      return {
        id: p.id,
        name: p.name,
        connected: p.connected,
        rtt: fresh ? Math.round(fresh.rtt) : null,
        offset: fresh ? Math.round(fresh.offset) : null,
        drift: fresh ? Math.round(fresh.drift) : null,
        mode: fresh ? (p.buffering ? 'BUFFERING' : fresh.mode) : null,
        rate: fresh ? fresh.rate : null,
        lastCorrectionAt: p.tele?.lastCorrectionAt ?? null,
        history: p.tele?.history ?? [],
        updatedAt: p.tele?.updatedAt ?? null,
        chaos,
      };
    });
    const measured = users.filter((u) => u.connected && u.drift != null);
    const inSync = measured.filter((u) => Math.abs(u.drift!) < SYNC.syncedThresholdMs).length;
    return {
      ...prop,
      roomSyncPct: measured.length > 0 ? Math.round((inSync / measured.length) * 100) : null,
      eventsPerSec: this.metrics.eventsPerSec(now),
      seq: this.state.seq,
      lead: this.currentLead(now),
      users,
      log: this.syncLogEntries.slice(),
    };
  }

  // ------------------------------------------------------------------ chat & reactions

  private pushChat(m: ChatMessage): void {
    this.chat.push(m);
    if (this.chat.length > LIMITS.chatHistory) this.chat.splice(0, this.chat.length - LIMITS.chatHistory);
    this.emitLogged(S2C.CHAT_MSG, { message: m });
    this.deps.durable.message({
      id: m.id,
      roomId: this.dbId,
      userId: m.userId,
      text: m.text,
      videoTs: m.videoTs,
      system: m.system,
      createdAt: new Date(m.createdAt),
    });
  }

  private currentVideoTs(): number | null {
    return this.state.media ? Math.round(expectedPos(this.state, Date.now()) * 100) / 100 : null;
  }

  systemChat(text: string): void {
    this.pushChat({
      id: shortId(16),
      userId: null,
      name: 'System',
      text,
      system: true,
      videoTs: this.currentVideoTs(),
      mediaId: this.state.media?.id ?? null,
      createdAt: Date.now(),
      mentions: [],
    });
  }

  chatSend(userId: string, socketId: string, clientId: string, rawText: string): { id: string } {
    const p = this.requireParticipant(userId, socketId);
    const key = `${userId}:${clientId}`;
    const seen = this.chatIds.get(key);
    if (seen) return { id: seen };
    let text = sanitizeChat(rawText);
    if (!text) throw new RoomError('INVALID', 'Message is empty');
    const slash = parseSlash(text);
    if (slash) {
      switch (slash.kind) {
        case 'shrug':
          text = `${slash.rest} ¯\\_(ツ)_/¯`.trim();
          break;
        case 'poll': {
          if (!slash.question || slash.options.length < 2)
            throw new RoomError('INVALID', 'Usage: /poll "Question" option A | option B');
          const id = this.pollCreate(userId, {
            question: slash.question,
            options: slash.options.map((label) => ({ label: label.slice(0, LIMITS.pollOptionMaxLen) })),
            durationSec: 60,
            anonymous: false,
            type: 'GENERIC',
          }).pollId;
          this.chatIds.set(key, id);
          return { id };
        }
        case 'skip':
          this.skip(p);
          this.chatIds.set(key, 'skip');
          return { id: 'skip' };
        case 'help':
          this.toast(userId, {
            kind: 'info',
            title: 'Chat commands',
            text: '/shrug - /poll "Question" a | b - /skip (next in queue)',
          });
          return { id: 'help' };
        case 'unknown':
          throw new RoomError('INVALID', `Unknown command /${slash.name} - try /help`);
      }
    }
    const message: ChatMessage = {
      id: shortId(16),
      userId: p.id,
      name: p.name,
      text,
      system: false,
      videoTs: this.currentVideoTs(),
      mediaId: this.state.media?.id ?? null,
      createdAt: Date.now(),
      mentions: findMentions(text, [...this.participants.values()].map((x) => ({ id: x.id, name: x.name }))),
    };
    this.chatIds.set(key, message.id);
    this.pushChat(message);
    return { id: message.id };
  }

  typing(userId: string, on: boolean): void {
    const p = this.participants.get(userId);
    if (!p) return;
    this.send(S2C.CHAT_TYPING, { userId, name: p.name, on }, userId);
  }

  reaction(userId: string, emoji: string): void {
    const p = this.requireParticipant(userId);
    const ts = this.currentVideoTs() ?? 0;
    const b = this.reactionBuf.get(emoji) ?? { count: 0, tsSum: 0 };
    b.count++;
    b.tsSum += ts;
    this.reactionBuf.set(emoji, b);
    if (!this.reactionTimer) {
      this.reactionTimer = setTimeout(() => this.flushReactions(), LIMITS.reactionWindowMs);
      this.reactionTimer.unref();
    }
    if (this.state.media) {
      this.deps.durable.reaction({
        roomId: this.dbId,
        userId: p.id,
        mediaId: this.state.media.id,
        emoji,
        videoTs: ts,
        createdAt: new Date(),
      });
    }
  }

  /** Aggregate reactions per 250ms window into one burst message (avoids floods at 25 users). */
  private flushReactions(): void {
    this.reactionTimer = null;
    if (this.disposed || this.reactionBuf.size === 0) return;
    const mediaId = this.state.media?.id ?? null;
    const bursts: ReactionBurst[] = [];
    for (const [emoji, b] of this.reactionBuf) {
      const videoTs = b.tsSum / b.count;
      bursts.push({ emoji, count: b.count, videoTs, mediaId });
      if (mediaId) {
        if (!this.roomHeat || this.roomHeat.mediaId !== mediaId) this.roomHeat = { mediaId, bins: [] };
        const bin = Math.floor(videoTs / LIMITS.heatBinSec);
        if (bin >= 0 && bin < 5000) {
          while (this.roomHeat.bins.length <= bin) this.roomHeat.bins.push(0);
          this.roomHeat.bins[bin] = (this.roomHeat.bins[bin] ?? 0) + b.count;
        }
        this.deps.heat.add(mediaId, videoTs, b.count);
        this.heatDirty = true;
      }
    }
    this.reactionBuf.clear();
    this.send(S2C.REACTION_BURST, { bursts });
  }

  // ------------------------------------------------------------------ queue

  private bumpQueue(): void {
    this.queueVersion++;
    this.emitLogged(S2C.QUEUE_UPDATE, { queue: this.queueState() });
    this.deps.durable.queue(
      this.dbId,
      this.queue.map((q) => ({
        id: `${this.dbId}:${q.id}`,
        roomId: this.dbId,
        movieId: q.movieId,
        customUrl: q.movieId ? null : q.url,
        title: q.title,
        addedById: q.addedBy,
        position: q.position,
        votes: q.votes.length,
        createdAt: new Date(q.createdAt),
      })),
    );
  }

  queueAdd(userId: string, data: { movieId?: string; url?: string; title?: string; playNext?: boolean }): { itemId: string } {
    const p = this.requireParticipant(userId);
    if (this.queue.length >= LIMITS.queueMax) throw new RoomError('INVALID', `Queue is full (${LIMITS.queueMax} max)`);
    let item: Omit<QueueItem, 'position'>;
    if (data.movieId) {
      const m = this.deps.catalog.get(data.movieId);
      if (!m) throw new RoomError('NOT_FOUND', 'Unknown movie');
      if (!m.streamUrl || !m.streamType)
        throw new RoomError('INVALID', `"${m.title}" has no free stream here - paste a link you have rights to`);
      if (this.queue.some((q) => q.movieId === m.id)) throw new RoomError('CONFLICT', 'Already in the queue');
      item = {
        id: shortId(12),
        movieId: m.id,
        title: m.title,
        url: m.streamUrl,
        streamType: m.streamType,
        posterUrl: m.posterUrl,
        durationSec: m.runtimeMin * 60,
        addedBy: p.id,
        addedByName: p.name,
        votes: [],
        createdAt: Date.now(),
      };
    } else if (data.url) {
      const url = data.url.trim();
      if (this.queue.some((q) => q.url === url)) throw new RoomError('CONFLICT', 'Already in the queue');
      item = {
        id: shortId(12),
        movieId: null,
        title: sanitizeLine(data.title || titleFromUrl(url), 120) || 'Custom video',
        url,
        streamType: detectStreamType(url),
        posterUrl: null,
        durationSec: null,
        addedBy: p.id,
        addedByName: p.name,
        votes: [],
        createdAt: Date.now(),
      };
    } else throw new RoomError('INVALID', 'Provide a movie or a URL');

    const sorted = this.sortedQueue();
    const front = data.playNext && canManageQueue(p.role, this.settings.queueMode);
    const position = front
      ? keyBetween(null, sorted[0]?.position ?? null)
      : keyBetween(sorted[sorted.length - 1]?.position ?? null, null);
    this.queue.push({ ...item, position });
    this.bumpQueue();

    // Nothing loaded yet: the first queued item becomes the current media (paused).
    if (!this.state.media) {
      this.playItem(item.id, { userId: p.id, name: p.name, action: 'load' }, false);
    } else if (this.state.ended && !this.nextUp) {
      this.scheduleNextUp();
    }
    return { itemId: item.id };
  }

  queueRemove(userId: string, itemId: string): void {
    const p = this.requireParticipant(userId);
    const item = this.queue.find((q) => q.id === itemId);
    if (!item) throw new RoomError('NOT_FOUND', 'Already removed');
    if (!canRemoveQueueItem(p.role, this.settings.queueMode, item.addedBy === p.id))
      throw new RoomError('FORBIDDEN', 'Only the host (or whoever added it) can remove this');
    this.queue = this.queue.filter((q) => q.id !== itemId);
    if (this.nextUp?.itemId === itemId) this.cancelNextUp();
    this.bumpQueue();
  }

  /** Move itemId so that it sits after `afterId` and before `beforeId` (null = open end). */
  queueReorder(userId: string, itemId: string, afterId: string | null, beforeId: string | null): void {
    const p = this.requireParticipant(userId);
    if (!canManageQueue(p.role, this.settings.queueMode)) throw new RoomError('FORBIDDEN', 'The host manages the queue order');
    const item = this.queue.find((q) => q.id === itemId);
    if (!item) throw new RoomError('NOT_FOUND', 'Item no longer in the queue');
    const a = afterId ? this.queue.find((q) => q.id === afterId) : null;
    const b = beforeId ? this.queue.find((q) => q.id === beforeId) : null;
    if ((afterId && !a) || (beforeId && !b) || a === item || b === item)
      throw new RoomError('CONFLICT', 'Queue changed - try again');
    const lo = a?.position ?? null;
    const hi = b?.position ?? null;
    if (lo !== null && hi !== null && lo >= hi) throw new RoomError('CONFLICT', 'Queue changed - try again');
    item.position = keyBetween(lo, hi);
    this.bumpQueue();
  }

  queueVote(userId: string, itemId: string): { voted: boolean } {
    const p = this.requireParticipant(userId);
    const item = this.queue.find((q) => q.id === itemId);
    if (!item) throw new RoomError('NOT_FOUND', 'Item no longer in the queue');
    const had = item.votes.includes(p.id);
    item.votes = had ? item.votes.filter((v) => v !== p.id) : [...item.votes, p.id];
    if (!had) {
      // Bubble up past items with fewer votes.
      const sorted = this.sortedQueue();
      const idx = sorted.findIndex((q) => q.id === itemId);
      let target = idx;
      while (target > 0 && sorted[target - 1]!.votes.length < item.votes.length) target--;
      if (target !== idx) {
        item.position = keyBetween(sorted[target - 1]?.position ?? null, sorted[target]!.position);
      }
    }
    this.bumpQueue();
    return { voted: !had };
  }

  queuePlayNow(userId: string, itemId: string): void {
    const p = this.requireParticipant(userId);
    const allowed =
      playbackPermission(p.role, this.settings.controlMode) === 'ALLOW' && canManageQueue(p.role, this.settings.queueMode);
    if (!allowed) throw new RoomError('FORBIDDEN', 'Only the host can start something new');
    if (!this.queue.some((q) => q.id === itemId)) throw new RoomError('NOT_FOUND', 'Item no longer in the queue');
    this.playItem(itemId, { userId: p.id, name: p.name, action: 'load' });
  }

  private playItem(itemId: string, causedBy: CausedBy, autoplay = true): void {
    const item = this.queue.find((q) => q.id === itemId);
    if (!item) return;
    this.queue = this.queue.filter((q) => q.id !== itemId);
    this.bumpQueue();
    const media: MediaSource = {
      id: item.movieId ?? mediaIdForUrl(item.url),
      title: item.title,
      url: item.url,
      type: item.streamType,
      posterUrl: item.posterUrl,
      durationSec: null,
      movieId: item.movieId,
    };
    this.loadMedia(media, autoplay, causedBy);
    this.systemChat(`▶️ Now playing "${item.title}"`);
  }

  /** Load a catalog movie directly (Discover "Play now"). */
  playMovie(userId: string, movieId: string): void {
    const p = this.requireParticipant(userId);
    if (playbackPermission(p.role, this.settings.controlMode) !== 'ALLOW')
      throw new RoomError('FORBIDDEN', 'Only the host can start something new');
    const m = this.deps.catalog.get(movieId);
    if (!m) throw new RoomError('NOT_FOUND', 'Unknown movie');
    const media = mediaFromMovie(m);
    if (!media) throw new RoomError('INVALID', `"${m.title}" has no free stream here`);
    this.loadMedia(media, true, { userId: p.id, name: p.name, action: 'load' });
    this.systemChat(`▶️ ${p.name} started "${m.title}"`);
  }

  private skip(p: Participant): void {
    const perm = playbackPermission(p.role, this.settings.controlMode);
    if (perm === 'DENY') throw new RoomError('FORBIDDEN', 'The host controls playback in this room');
    const next = this.sortedQueue()[0];
    if (!next) throw new RoomError('INVALID', 'The queue is empty');
    if (perm === 'VOTE') {
      this.createActionPoll(p, `Skip to "${next.title}"?`, { action: 'skip' });
      return;
    }
    this.playItem(next.id, { userId: p.id, name: p.name, action: 'load' });
  }

  // ------------------------------------------------------------------ polls

  private openPollCount(): number {
    let n = 0;
    for (const rt of this.polls.values()) if (rt.status === 'OPEN') n++;
    return n;
  }

  private prunePolls(): void {
    const closed = [...this.polls.values()].filter((p) => p.status === 'CLOSED').sort((a, b) => a.endsAt - b.endsAt);
    while (closed.length > 10) this.polls.delete(closed.shift()!.id);
  }

  private insertPoll(rt: PollRuntime): void {
    this.polls.set(rt.id, rt);
    this.pollTimers.set(
      rt.id,
      this.timeout(() => this.closePoll(rt.id), Math.max(0, rt.endsAt - Date.now())),
    );
    this.emitLogged(S2C.POLL_UPDATE, { poll: this.pollView(rt) });
    this.persistPoll(rt);
    this.prunePolls();
  }

  pollCreate(userId: string, input: PollCreateInput): { pollId: string } {
    const p = this.requireParticipant(userId);
    if (this.openPollCount() >= 5) throw new RoomError('INVALID', 'Too many polls running - close one first');
    const type = input.type ?? 'GENERIC';
    let options: PollOption[] = input.options.map((o, i) => ({
      id: `o${i + 1}`,
      label: sanitizeLine(o.label, LIMITS.pollOptionMaxLen),
      payload: o.payload,
    }));
    if (type === 'NEXT_MOVIE') {
      for (const o of options) {
        if (o.payload?.movieId && !this.deps.catalog.get(o.payload.movieId)) throw new RoomError('INVALID', 'Unknown movie in poll');
      }
    }
    if (type === 'SKIP_TO' || type === 'PAUSE_BREAK') {
      // Actionable yes/no polls: the first option means "do it".
      options = [
        { id: 'yes', label: options[0]?.label || 'Yes' },
        { id: 'no', label: options[1]?.label || 'No' },
      ];
    }
    if (type === 'SKIP_TO' && input.payload?.pos == null) throw new RoomError('INVALID', 'Skip polls need a time');
    const now = Date.now();
    const rt: PollRuntime = {
      id: shortId(10),
      question: sanitizeLine(input.question, LIMITS.pollQuestionMaxLen),
      type,
      options,
      anonymous: input.anonymous ?? false,
      creatorId: p.id,
      creatorName: p.name,
      createdAt: now,
      endsAt: now + input.durationSec * 1000,
      status: 'OPEN',
      payload: input.payload ?? (type === 'PAUSE_BREAK' ? { minutes: 5 } : null),
      result: null,
      votes: new Map(),
    };
    this.insertPoll(rt);
    return { pollId: rt.id };
  }

  private createControlPoll(p: Participant, action: PlaybackAction, pos?: number): void {
    const label =
      action === 'seek' ? `seek to ${formatTime(pos ?? 0)}` : action === 'play' ? 'press play' : action === 'pause' ? 'pause' : action;
    this.createActionPoll(p, `${p.name} wants to ${label} - allow?`, { action, pos });
    this.toast(p.id, { kind: 'info', title: 'Vote started', text: 'This room decides playback by vote' });
  }

  private createActionPoll(p: Participant | null, question: string, payload: PollPayload): void {
    if ([...this.polls.values()].some((x) => x.status === 'OPEN' && x.type === 'CONTROL'))
      throw new RoomError('CONFLICT', 'A playback vote is already running');
    const now = Date.now();
    const rt: PollRuntime = {
      id: shortId(10),
      question,
      type: 'CONTROL',
      options: YES_NO('Allow', 'Nope'),
      anonymous: false,
      creatorId: p?.id ?? null,
      creatorName: p?.name ?? 'System',
      createdAt: now,
      endsAt: now + 20_000,
      status: 'OPEN',
      payload,
      result: null,
      votes: new Map(),
    };
    if (p) rt.votes.set(p.id, 'yes');
    this.insertPoll(rt);
  }

  private autoNextMoviePoll(): void {
    const picks = this.recommend(30)
      .map((r) => r.movie)
      .filter((m) => m.isFree && m.id !== this.state.media?.movieId)
      .slice(0, 3);
    if (picks.length < 2) return;
    const now = Date.now();
    const rt: PollRuntime = {
      id: shortId(10),
      question: 'What should we watch next?',
      type: 'NEXT_MOVIE',
      options: picks.map((m, i) => ({ id: `o${i + 1}`, label: m.title, payload: { movieId: m.id } })),
      anonymous: false,
      creatorId: null,
      creatorName: 'Taste Fusion',
      createdAt: now,
      endsAt: now + 45_000,
      status: 'OPEN',
      payload: null,
      result: null,
      votes: new Map(),
    };
    this.insertPoll(rt);
  }

  pollVote(userId: string, pollId: string, optionId: string): void {
    const p = this.requireParticipant(userId);
    const rt = this.polls.get(pollId);
    if (!rt) throw new RoomError('NOT_FOUND', 'Poll not found');
    if (rt.status !== 'OPEN' || Date.now() > rt.endsAt) throw new RoomError('INVALID', 'Poll is closed');
    if (!rt.options.some((o) => o.id === optionId)) throw new RoomError('INVALID', 'Unknown option');
    if (rt.votes.get(p.id) === optionId) return;
    rt.votes.set(p.id, optionId);
    this.emitLogged(S2C.POLL_UPDATE, { poll: this.pollView(rt) });
  }

  pollClose(userId: string, pollId: string): void {
    const p = this.requireParticipant(userId);
    const rt = this.polls.get(pollId);
    if (!rt) throw new RoomError('NOT_FOUND', 'Poll not found');
    if (!canClosePoll(p.role, rt.creatorId === p.id)) throw new RoomError('FORBIDDEN', 'Only the creator or host can close this poll');
    this.closePoll(pollId);
  }

  private closePoll(pollId: string): void {
    const rt = this.polls.get(pollId);
    if (!rt || rt.status !== 'OPEN') return;
    const t = this.pollTimers.get(pollId);
    if (t) clearTimeout(t);
    this.pollTimers.delete(pollId);
    const counts = tallyVotes(rt.options, rt.votes);
    const decision = decideWinner(counts, {
      tieBreak: this.settings.tieBreak,
      hostVote: this.hostId ? (rt.votes.get(this.hostId) ?? null) : null,
      random: () => randomInt(1_000_000) / 1_000_000,
    });
    rt.status = 'CLOSED';
    rt.endsAt = Math.min(rt.endsAt, Date.now());
    const winner = rt.options.find((o) => o.id === decision.winnerId) ?? null;
    let applied: string | null = null;
    try {
      applied = this.applyPollResult(rt, winner);
    } catch (err) {
      applied = err instanceof RoomError ? `not applied: ${err.message}` : 'not applied';
    }
    rt.result = { winnerId: decision.winnerId, tie: decision.tie, applied };
    this.emitLogged(S2C.POLL_CLOSED, { poll: this.pollView(rt) });
    const tie = decision.tie ? ' (tie-break)' : '';
    this.systemChat(
      winner ? `📊 "${rt.question}" -> ${winner.label}${tie}${applied ? ` - ${applied}` : ''}` : `📊 "${rt.question}" closed with no votes`,
    );
    this.persistPoll(rt);
  }

  private applyPollResult(rt: PollRuntime, winner: PollOption | null): string | null {
    if (!winner) return null;
    const by: CausedBy = { userId: null, name: 'Poll', action: 'poll' };
    switch (rt.type) {
      case 'NEXT_MOVIE': {
        const movieId = winner.payload?.movieId;
        const m = movieId ? this.deps.catalog.get(movieId) : undefined;
        if (!m) return null;
        const media = mediaFromMovie(m);
        if (!media) return 'not streamable here';
        if (!this.state.media || this.state.ended) {
          this.loadMedia(media, true, by);
          return 'now playing';
        }
        if (!this.queue.some((q) => q.movieId === m.id)) {
          const sorted = this.sortedQueue();
          this.queue.push({
            id: shortId(12),
            movieId: m.id,
            title: m.title,
            url: media.url,
            streamType: media.type,
            posterUrl: m.posterUrl,
            durationSec: m.runtimeMin * 60,
            addedBy: rt.creatorId ?? 'system',
            addedByName: 'Poll',
            position: keyBetween(null, sorted[0]?.position ?? null),
            votes: [],
            createdAt: Date.now(),
          });
          this.bumpQueue();
        }
        return 'queued up next';
      }
      case 'SKIP_TO': {
        if (winner.id !== 'yes' || rt.payload?.pos == null || !this.state.media) return null;
        this.commit({ type: 'seek', pos: rt.payload.pos }, by);
        return `skipped to ${formatTime(rt.payload.pos)}`;
      }
      case 'PAUSE_BREAK': {
        if (winner.id !== 'yes') return null;
        this.startIntermission(rt.payload?.minutes ?? 5, 'Poll');
        return 'intermission started';
      }
      case 'CONTROL': {
        if (winner.id !== 'yes' || !rt.payload?.action) return 'vetoed';
        const a = rt.payload.action;
        if (a === 'skip') {
          const next = this.sortedQueue()[0];
          if (!next) return 'queue empty';
          this.playItem(next.id, { userId: null, name: 'Vote', action: 'load' });
          return 'skipped';
        }
        if (!this.state.media) return null;
        const voteBy: CausedBy = { userId: null, name: 'Vote', action: a };
        if (a === 'play') this.commit({ type: 'play' }, voteBy);
        else if (a === 'pause') this.commit({ type: 'pause' }, voteBy);
        else if (a === 'seek' && rt.payload.pos != null) this.commit({ type: 'seek', pos: rt.payload.pos }, voteBy);
        return 'applied';
      }
      default:
        return null;
    }
  }

  private persistPoll(rt: PollRuntime): void {
    this.deps.durable.poll(
      {
        id: rt.id,
        roomId: this.dbId,
        creatorId: rt.creatorId,
        question: rt.question,
        type: rt.type,
        options: rt.options,
        anonymous: rt.anonymous,
        endsAt: new Date(rt.endsAt),
        status: rt.status,
        result: rt.result,
      },
      rt.status === 'CLOSED' ? [...rt.votes].map(([uid, optionId]) => ({ userId: uid, optionId })) : [],
    );
  }

  // ------------------------------------------------------------------ intermission

  intermissionSet(userId: string, data: { action: 'start'; minutes: number } | { action: 'cancel' }): void {
    const p = this.requireParticipant(userId);
    if (!canIntermission(p.role)) throw new RoomError('FORBIDDEN', 'Only the host or a moderator can call an intermission');
    if (data.action === 'start') this.startIntermission(data.minutes, p.name);
    else {
      if (!this.intermission) throw new RoomError('INVALID', 'No intermission running');
      this.endIntermission(true);
    }
  }

  private startIntermission(minutes: number, by: string): void {
    const now = Date.now();
    this.resumeAfterIntermission = this.state.status === 'PLAYING' || (this.intermission ? this.resumeAfterIntermission : false);
    if (this.state.media && this.state.status !== 'PAUSED') {
      this.commit({ type: 'pause' }, { userId: null, name: 'Intermission', action: 'intermission' });
    }
    if (this.intermissionTimer) clearTimeout(this.intermissionTimer);
    const ms = Math.round(minutes * 60_000);
    this.intermission = { endsAt: now + ms, minutes, startedBy: by };
    this.intermissionTimer = this.timeout(() => {
      this.intermissionTimer = null;
      this.endIntermission(true);
    }, ms);
    this.emitLogged(S2C.INTERMISSION, { intermission: this.intermission });
    this.systemChat(`🍿 Snack break! ${by} started a ${minutes < 1 ? `${Math.round(minutes * 60)}s` : `${minutes} min`} intermission`);
  }

  private endIntermission(resume: boolean): void {
    if (this.intermissionTimer) {
      clearTimeout(this.intermissionTimer);
      this.intermissionTimer = null;
    }
    if (!this.intermission) return;
    this.intermission = null;
    this.emitLogged(S2C.INTERMISSION, { intermission: null });
    if (resume && this.resumeAfterIntermission && this.state.media && this.state.status === 'PAUSED') {
      this.commit({ type: 'play' }, { userId: null, name: 'Intermission over', action: 'intermission' });
    }
    this.resumeAfterIntermission = false;
  }

  // ------------------------------------------------------------------ settings & chaos

  updateSettings(
    userId: string,
    patch: Partial<RoomSettings> & { name?: string },
  ): void {
    const p = this.requireParticipant(userId);
    if (!canEditSettings(p.role)) throw new RoomError('FORBIDDEN', 'Only the host can change room settings');
    const { name, ...rest } = patch;
    if (name) this.name = sanitizeLine(name, LIMITS.roomNameMaxLen) || this.name;
    const before = this.settings.waitPolicy;
    this.settings = { ...this.settings, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
    this.emitLogged(S2C.ROOM_UPDATE, { room: this.info() });
    if (before === 'WAIT_FOR_ALL' && this.settings.waitPolicy === 'NEVER_WAIT' && this.state.status === 'BUFFERING') {
      this.commit({ type: 'resume' }, { userId: p.id, name: p.name, action: 'resume' });
    }
    this.persistRoomRecord();
  }

  chaos(
    userId: string,
    data: { type: ChaosType; targetId?: string; params?: { ms?: number; pct?: number; durationMs?: number } },
  ): { target: string | null } {
    const p = this.requireParticipant(userId);
    if (!this.deps.chaosEnabled) throw new RoomError('FORBIDDEN', 'Chaos Mode is disabled on this server');
    if (!canUseChaos(p.role)) throw new RoomError('FORBIDDEN', 'Only the host can unleash chaos');
    const now = Date.now();
    const duration = data.params?.durationMs ?? 20_000;
    if (data.type === 'CLEAR') {
      for (const x of this.participants.values()) x.chaos = null;
      this.serverDelay = { ms: 0, until: 0 };
      this.syncLog('chaos', 'chaos cleared');
      return { target: null };
    }
    if (data.type === 'SERVER_DELAY') {
      const ms = data.params?.ms ?? 200;
      this.serverDelay = { ms, until: now + duration };
      this.syncLog('chaos', `server event delay +${ms}ms for ${Math.round(duration / 1000)}s`);
      return { target: null };
    }
    let target = data.targetId ? this.participants.get(data.targetId) : undefined;
    if (data.targetId && (!target || !target.connected)) throw new RoomError('NOT_FOUND', 'Target is not connected');
    if (!target) {
      const others = this.connected().filter((x) => x.id !== p.id);
      const pool = others.length > 0 ? others : this.connected();
      target = pool[randomInt(pool.length)];
    }
    if (!target || !target.socketId) throw new RoomError('NOT_FOUND', 'Nobody to target');
    const base = this.chaosFor(target) ?? { latencyMs: 0, dropPct: 0, until: now + duration };
    switch (data.type) {
      case 'LATENCY':
        target.chaos = { ...base, latencyMs: data.params?.ms ?? 300, until: now + duration };
        this.syncLog('chaos', `+${target.chaos.latencyMs}ms latency -> ${target.name}`);
        break;
      case 'DROP':
        target.chaos = { ...base, dropPct: data.params?.pct ?? 0.1, until: now + duration };
        this.syncLog('chaos', `${Math.round(target.chaos.dropPct * 100)}% packet drop -> ${target.name}`);
        break;
      case 'DISCONNECT':
        this.syncLog('chaos', `forced disconnect -> ${target.name}`);
        this.deps.io.disconnect(target.socketId, 'chaos');
        break;
      case 'BUFFER':
        this.syncLog('chaos', `simulated buffering -> ${target.name}`);
        this.deps.io.toSocket(target.socketId, S2C.CHAOS_APPLY, { type: 'BUFFER', ms: data.params?.ms ?? 3000 });
        break;
      case 'DESYNC':
        this.syncLog('chaos', `desync +${(data.params?.ms ?? 3000) / 1000}s -> ${target.name}`);
        this.deps.io.toSocket(target.socketId, S2C.CHAOS_APPLY, { type: 'DESYNC', ms: data.params?.ms ?? 3000 });
        break;
    }
    return { target: target.name };
  }

  // ------------------------------------------------------------------ recommendations

  recommend(limit = 12): Recommendation[] {
    return this.deps.recommend(
      [...this.participants.values()].filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, vector: p.taste })),
      limit,
    );
  }

  // ------------------------------------------------------------------ persistence

  roomRecord() {
    return {
      id: this.dbId,
      code: this.code,
      name: this.name,
      passwordHash: this.passwordHash,
      hostUserId: this.hostId,
      hostEpoch: this.hostEpoch,
      controlMode: this.settings.controlMode,
      waitPolicy: this.settings.waitPolicy,
      maxUsers: this.maxUsers,
      currentMediaId: this.state.media?.id ?? null,
      createdAt: new Date(this.createdAt),
      lastActiveAt: new Date(this.lastActiveAt),
      closedAt: null,
    };
  }

  persistRoomRecord(): void {
    this.deps.durable.room(this.roomRecord());
  }

  toPersisted(): PersistedRoom {
    return {
      v: 1,
      code: this.code,
      dbId: this.dbId,
      name: this.name,
      passwordHash: this.passwordHash,
      maxUsers: this.maxUsers,
      createdAt: this.createdAt,
      settings: this.settings,
      hostId: this.hostId,
      hostEpoch: this.hostEpoch,
      isDemo: this.isDemo,
      participants: [...this.participants.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatarSeed: p.avatarSeed,
        role: p.role,
        joinedAt: p.joinedAt,
        taste: p.taste,
      })),
      state: this.state,
      queue: this.queue,
      queueVersion: this.queueVersion,
      polls: [...this.polls.values()].map((rt) => ({ ...rt, votes: [...rt.votes] })),
      chat: this.chat,
      roomHeat: this.roomHeat,
      intermission: this.intermission,
      resumeAfterIntermission: this.resumeAfterIntermission,
      eseq: this.eseq,
      lastActiveAt: this.lastActiveAt,
    };
  }

  /**
   * Rebuild after a server restart. Everyone starts disconnected with the normal grace timers,
   * so reconnecting clients slot straight back in and absent ones are cleaned up.
   */
  static fromPersisted(deps: RoomDeps, d: PersistedRoom): Room {
    const room = new Room(deps, {
      code: d.code,
      name: d.name,
      passwordHash: d.passwordHash,
      hostId: d.hostId,
      maxUsers: d.maxUsers,
      isDemo: d.isDemo,
    });
    const mutable = room as unknown as { dbId: string; createdAt: number };
    mutable.dbId = d.dbId;
    mutable.createdAt = d.createdAt;
    room.settings = d.settings;
    room.hostEpoch = d.hostEpoch;
    room.state = d.state;
    room.queue = d.queue;
    room.queueVersion = d.queueVersion;
    room.chat = d.chat;
    room.roomHeat = d.roomHeat;
    room.eseq = d.eseq;
    room.lastActiveAt = d.lastActiveAt;
    room.resumeAfterIntermission = d.resumeAfterIntermission;
    const now = Date.now();
    for (const p of d.participants) {
      room.participants.set(p.id, {
        ...p,
        connected: false,
        socketId: null,
        lastSeenAt: now,
        buffering: false,
        catchUpUntil: 0,
        tele: null,
        lastSampleAt: 0,
        chaos: null,
      });
      room.removeTimers.set(
        p.id,
        room.timeout(() => room.removeParticipant(p.id), SYNC.participantGraceMs),
      );
    }
    if (room.hostId && room.participants.has(room.hostId)) {
      const epoch = room.hostEpoch;
      const hostId = room.hostId;
      room.hostTimer = room.timeout(() => {
        room.hostTimer = null;
        room.hostGraceExpired(hostId, epoch);
      }, SYNC.hostGraceMs);
    }
    // A room that was buffering when we died resumes with a fresh lead.
    if (room.state.status === 'BUFFERING') {
      room.state = applyTransition(room.state, { type: 'resume' }, { now, lead: SYNC.leadMaxMs, userId: null }).state;
    }
    for (const p of d.polls) {
      const rt: PollRuntime = { ...p, votes: new Map(p.votes) };
      room.polls.set(rt.id, rt);
      if (rt.status === 'OPEN') {
        room.pollTimers.set(
          rt.id,
          room.timeout(() => room.closePoll(rt.id), Math.max(0, rt.endsAt - now)),
        );
      }
    }
    if (d.intermission) {
      room.intermission = d.intermission;
      room.intermissionTimer = room.timeout(() => {
        room.intermissionTimer = null;
        room.endIntermission(true);
      }, Math.max(0, d.intermission.endsAt - now));
    }
    room.emptySince = now;
    return room;
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.tickTimer);
    for (const t of this.removeTimers.values()) clearTimeout(t);
    for (const t of this.pollTimers.values()) clearTimeout(t);
    for (const t of [this.hostTimer, this.bufferTimer, this.nextUpTimer, this.intermissionTimer, this.reactionTimer]) {
      if (t) clearTimeout(t);
    }
    this.removeTimers.clear();
    this.pollTimers.clear();
  }
}
