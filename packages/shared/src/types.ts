export type Role = 'HOST' | 'MOD' | 'VIEWER';
export type ControlMode = 'HOST_ONLY' | 'EVERYONE' | 'VOTE';
export type WaitPolicy = 'WAIT_FOR_ALL' | 'NEVER_WAIT';
export type QueueMode = 'HOST_ONLY' | 'EVERYONE';
export type TieBreak = 'HOST_VOTE' | 'RANDOM';
export type PlaybackStatus = 'PLAYING' | 'PAUSED' | 'BUFFERING';
export type StreamType = 'MP4' | 'HLS' | 'YOUTUBE';
export type DriftMode = 'IDLE' | 'NUDGING' | 'HARD_SEEK' | 'BUFFERING';
export type PlaybackAction = 'play' | 'pause' | 'seek' | 'rate';
export type PlaybackCause =
  | PlaybackAction
  | 'load'
  | 'buffering'
  | 'resume'
  | 'poll'
  | 'intermission'
  | 'ended'
  | 'system';

export interface MediaSource {
  /** Unique per load (movie id or hash of custom url). */
  id: string;
  title: string;
  url: string;
  type: StreamType;
  posterUrl: string | null;
  durationSec: number | null;
  movieId: string | null;
}

/** Server-authoritative playback state. Clients derive position from the anchor. */
export interface PlaybackState {
  seq: number;
  status: PlaybackStatus;
  media: MediaSource | null;
  rate: number;
  /** media position (sec) at anchorTime */
  anchorPos: number;
  /** server epoch ms at which anchorPos is true (and at which the change takes effect) */
  anchorTime: number;
  updatedBy: string | null;
  ended: boolean;
}

export interface CausedBy {
  userId: string | null;
  name: string;
  action: PlaybackCause;
}

export interface StateUpdate {
  state: PlaybackState;
  seq: number;
  causedBy: CausedBy;
  /** server ms when all clients should apply this state */
  scheduledAt: number;
  /** server ms when the update was broadcast (propagation metric) */
  serverTs: number;
}

export interface ParticipantInfo {
  id: string;
  name: string;
  avatarSeed: string;
  role: Role;
  joinedAt: number;
  connected: boolean;
  hasTaste: boolean;
}

export interface RoomSettings {
  controlMode: ControlMode;
  waitPolicy: WaitPolicy;
  queueMode: QueueMode;
  tieBreak: TieBreak;
}

export interface RoomInfo {
  code: string;
  name: string;
  hostId: string | null;
  hostEpoch: number;
  hasPassword: boolean;
  maxUsers: number;
  createdAt: number;
  settings: RoomSettings;
  chaosEnabled: boolean;
}

export interface QueueItem {
  id: string;
  movieId: string | null;
  title: string;
  url: string;
  streamType: StreamType;
  posterUrl: string | null;
  durationSec: number | null;
  addedBy: string;
  addedByName: string;
  /** fractional index key */
  position: string;
  votes: string[];
  createdAt: number;
}

export interface QueueState {
  version: number;
  items: QueueItem[];
}

export interface NextUp {
  itemId: string;
  title: string;
  at: number;
}

export type PollType = 'GENERIC' | 'NEXT_MOVIE' | 'SKIP_TO' | 'PAUSE_BREAK' | 'CONTROL';

export interface PollPayload {
  movieId?: string;
  pos?: number;
  minutes?: number;
  action?: PlaybackAction | 'skip';
}

export interface PollOption {
  id: string;
  label: string;
  payload?: PollPayload;
}

export interface PollResult {
  winnerId: string | null;
  tie: boolean;
  applied: string | null;
}

export interface Poll {
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
  counts: Record<string, number>;
  /** optionId -> voter user ids (omitted for anonymous polls) */
  voters: Record<string, string[]> | null;
  totalVotes: number;
  result: PollResult | null;
  /** extra data for actionable polls (CONTROL / SKIP_TO) */
  payload: PollPayload | null;
}

export interface ChatMessage {
  id: string;
  userId: string | null;
  name: string;
  text: string;
  system: boolean;
  /** media position (sec) when the message was sent - for spoiler-safe chat */
  videoTs: number | null;
  mediaId: string | null;
  createdAt: number;
  mentions: string[];
}

export interface ReactionBurst {
  emoji: string;
  count: number;
  videoTs: number;
  mediaId: string | null;
}

export interface Heatmap {
  mediaId: string;
  binSec: number;
  /** reactions in this room per bin */
  bins: number[];
  /** reactions across all rooms ever for this media ("crowd favorites") */
  crowd: number[];
}

export interface Intermission {
  endsAt: number;
  minutes: number;
  startedBy: string;
}

export interface TelemetryReport {
  drift: number;
  mode: DriftMode;
  rtt: number;
  offset: number;
  pos: number;
  rate: number;
  hardSeeks: number;
}

export interface UserSyncMetrics {
  id: string;
  name: string;
  connected: boolean;
  rtt: number | null;
  offset: number | null;
  drift: number | null;
  mode: DriftMode | null;
  rate: number | null;
  lastCorrectionAt: number | null;
  history: number[];
  updatedAt: number | null;
  chaos: string[];
}

export interface SyncLogEntry {
  ts: number;
  kind: 'state' | 'hard-seek' | 'buffering' | 'chaos' | 'host' | 'join' | 'leave' | 'resync' | 'info';
  text: string;
}

export interface SyncMetrics {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  samples: number;
  roomSyncPct: number | null;
  eventsPerSec: number;
  seq: number;
  lead: number;
  users: UserSyncMetrics[];
  log: SyncLogEntry[];
}

export interface Snapshot {
  bootId: string;
  eseq: number;
  serverNow: number;
  room: RoomInfo;
  me: { id: string; role: Role };
  participants: ParticipantInfo[];
  state: PlaybackState;
  queue: QueueState;
  nextUp: NextUp | null;
  polls: Poll[];
  myVotes: Record<string, string>;
  chatTail: ChatMessage[];
  heatmap: Heatmap | null;
  intermission: Intermission | null;
}

/** An event that was broadcast with an event-sequence number and can be replayed. */
export interface LoggedEvent {
  eseq: number;
  event: string;
  payload: unknown;
}

export type ErrorCode =
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'BAD_PASSWORD'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'INTERNAL';

export interface AckError {
  ok: false;
  error: { code: ErrorCode; message: string };
}
export type Ack<T extends object = object> = ({ ok: true } & T) | AckError;

export type JoinAck = Ack<
  | { mode: 'snapshot'; snapshot: Snapshot }
  | { mode: 'replay'; events: LoggedEvent[]; serverNow: number; me: { id: string; role: Role } }
>;

export interface Movie {
  id: string;
  title: string;
  originalTitle: string | null;
  overview: string;
  year: number;
  runtimeMin: number;
  rating: number;
  popularity: number;
  language: string;
  genres: string[];
  keywords: string[];
  cast: string[];
  posterUrl: string | null;
  backdropUrl: string | null;
  trailerUrl: string | null;
  streamUrl: string | null;
  streamType: StreamType | null;
  isFree: boolean;
  moods: string[];
}

export interface TasteVector {
  /** genre -> weight 0..1 */
  genres: Record<string, number>;
  likedIds: string[];
  runtimeMax: number | null;
}

export interface MemberCompat {
  id: string;
  name: string;
  compat: number;
}

export interface Recommendation {
  movie: Movie;
  score: number;
  members: MemberCompat[];
  reason: string;
}

export type HostChangeReason = 'transfer' | 'succession' | 'request' | 'claim';

/** Payloads of replayable (logged) events. Every logged payload also carries `eseq`. */
export interface LoggedPayloads {
  'state:update': StateUpdate;
  'participant:join': { participant: ParticipantInfo };
  'participant:leave': { userId: string };
  'participant:update': { participant: ParticipantInfo };
  'room:update': { room: RoomInfo };
  'chat:msg': { message: ChatMessage };
  'queue:update': { queue: QueueState };
  'queue:nextup': { nextUp: NextUp | null };
  'poll:update': { poll: Poll };
  'poll:closed': { poll: Poll };
  'host:changed': { oldId: string | null; newId: string; reason: HostChangeReason; epoch: number };
  'intermission:update': { intermission: Intermission | null };
}
export type LoggedEventName = keyof LoggedPayloads;
export type WithEseq<T> = T & { eseq: number };

export type ToastKind = 'info' | 'success' | 'warn' | 'error' | 'achievement';
export interface ToastPayload {
  kind: ToastKind;
  title: string;
  text?: string;
}

export type ChaosType = 'LATENCY' | 'DROP' | 'DISCONNECT' | 'BUFFER' | 'DESYNC' | 'SERVER_DELAY' | 'CLEAR';
export interface ChaosApply {
  type: 'BUFFER' | 'DESYNC' | 'DISCONNECT';
  ms: number;
}

export interface PongPayload {
  t0: number;
  ts: number;
  eseq: number;
  seq: number;
}
