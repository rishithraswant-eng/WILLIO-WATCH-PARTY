import { create } from 'zustand';
import type {
  ChatMessage,
  DriftMode,
  Heatmap,
  Intermission,
  NextUp,
  ParticipantInfo,
  PlaybackState,
  Poll,
  QueueState,
  Role,
  RoomInfo,
  SyncMetrics,
} from '@blockparty/shared';

export type Phase = 'idle' | 'connecting' | 'clock' | 'joining' | 'live' | 'offline' | 'replaced' | 'error';
export type SyncBadge = 'IN_SYNC' | 'ADJUSTING' | 'RESYNCING' | 'PAUSED' | 'LOADING' | 'OFFLINE';

export interface SyncView {
  badge: SyncBadge;
  driftMs: number | null;
  mode: DriftMode;
  rttMs: number;
  offsetMs: number;
  position: number;
  duration: number | null;
  playerReady: boolean;
  needsGesture: boolean;
  suggestResync: boolean;
  mediaError: string | null;
}

export interface OutboxItem {
  id: string;
  text: string;
  at: number;
}

export interface RoomStore {
  code: string | null;
  phase: Phase;
  error: string | null;
  me: { id: string; role: Role } | null;
  room: RoomInfo | null;
  participants: Record<string, ParticipantInfo>;
  state: PlaybackState | null;
  queue: QueueState;
  nextUp: NextUp | null;
  polls: Record<string, Poll>;
  myVotes: Record<string, string>;
  chat: ChatMessage[];
  outbox: OutboxItem[];
  typing: Record<string, { name: string; at: number }>;
  heatmap: Heatmap | null;
  intermission: Intermission | null;
  metrics: SyncMetrics | null;
  hostRequests: { userId: string; name: string }[];
  sync: SyncView;
  /** optimistic play/pause button state until the authoritative update lands */
  optimisticStatus: 'PLAYING' | 'PAUSED' | null;
  /** media position when this client joined (late joiner detection) */
  joinedAtPos: number | null;
  reactionTotals: Record<string, number>;
  chatCounts: Record<string, number>;
  watchSeconds: number;
  inSyncSamples: { total: number; good: number };
  set(partial: Partial<RoomStore> | ((s: RoomStore) => Partial<RoomStore>)): void;
  reset(code: string): void;
}

const INITIAL_SYNC: SyncView = {
  badge: 'LOADING',
  driftMs: null,
  mode: 'IDLE',
  rttMs: 0,
  offsetMs: 0,
  position: 0,
  duration: null,
  playerReady: false,
  needsGesture: false,
  suggestResync: false,
  mediaError: null,
};

const initial = (code: string | null) => ({
  code,
  phase: 'idle' as Phase,
  error: null,
  me: null,
  room: null,
  participants: {},
  state: null,
  queue: { version: 0, items: [] },
  nextUp: null,
  polls: {},
  myVotes: {},
  chat: [],
  outbox: [],
  typing: {},
  heatmap: null,
  intermission: null,
  metrics: null,
  hostRequests: [],
  sync: INITIAL_SYNC,
  optimisticStatus: null,
  joinedAtPos: null,
  reactionTotals: {},
  chatCounts: {},
  watchSeconds: 0,
  inSyncSamples: { total: 0, good: 0 },
});

export const useRoom = create<RoomStore>((set) => ({
  ...initial(null),
  set: (partial) => set(partial),
  reset: (code) => set(initial(code)),
}));

export const selectIsHost = (s: RoomStore) => !!s.me && s.room?.hostId === s.me.id;
export const selectMyRole = (s: RoomStore): Role => {
  if (!s.me) return 'VIEWER';
  if (s.room?.hostId === s.me.id) return 'HOST';
  return s.participants[s.me.id]?.role ?? s.me.role;
};
