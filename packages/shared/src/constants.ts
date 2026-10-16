/** Room codes: 6 chars, no ambiguous characters (no 0/O, 1/I). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
/** Seeded demo room that never expires. Reserved: it contains an 'O', which generated codes never use. */
export const DEMO_ROOM_CODE = 'DEMO42';
export const ROOM_CODE_REGEX = /^(?:[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}|DEMO42)$/;

/** Reaction hotbar (9 slots, Minecraft style). */
export const REACTION_EMOJIS = ['🔥', '😂', '😮', '😢', '👏', '❤️', '💀', '🍿', '🤯'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const LIMITS = {
  nameMaxLen: 24,
  roomNameMaxLen: 40,
  chatMaxLen: 500,
  chatHistory: 100,
  queueMax: 50,
  pollQuestionMaxLen: 140,
  pollOptionMaxLen: 60,
  pollOptionsMin: 2,
  pollOptionsMax: 6,
  pollDurationMinSec: 15,
  pollDurationMaxSec: 120,
  roomMaxUsersDefault: 50,
  eventRing: 300,
  dedupeLru: 500,
  reactionWindowMs: 250,
  heatBinSec: 5,
  syncLogSize: 50,
  driftHistory: 40,
  intermissionMaxMin: 30,
} as const;

/** Per-user, per-event rate limits (fixed window). */
export const RATE_LIMITS = {
  'chat:send': { max: 5, windowMs: 5000 },
  'chat:typing': { max: 10, windowMs: 5000 },
  'reaction:send': { max: 10, windowMs: 1000 },
  playback: { max: 15, windowMs: 3000 },
  'playback:buffering': { max: 10, windowMs: 5000 },
  queue: { max: 15, windowMs: 5000 },
  'poll:create': { max: 3, windowMs: 30000 },
  'poll:vote': { max: 20, windowMs: 10000 },
  'time:ping': { max: 30, windowMs: 1000 },
  telemetry: { max: 5, windowMs: 1000 },
  host: { max: 10, windowMs: 10000 },
  chaos: { max: 20, windowMs: 10000 },
  misc: { max: 30, windowMs: 5000 },
  'sync:ack': { max: 60, windowMs: 1000 },
  'rest:create': { max: 10, windowMs: 60000 },
  'rest:join': { max: 40, windowMs: 60000 },
} as const satisfies Record<string, { max: number; windowMs: number }>;
export type RateLimitKey = keyof typeof RATE_LIMITS;

/** Sync engine tunables (Section 8 of the PRD). All times in ms unless stated. */
export const SYNC = {
  // clock sync
  clockBurst: 10,
  clockBurstGapMs: 100,
  clockKeep: 4,
  clockIntervalMs: 5000,
  clockEmaAlpha: 0.2,
  clockJumpRejectMs: 250,
  clockJumpConfirm: 3,
  /** RTT acceptance: rtt <= max(2 * best, best + slack). Slack avoids rejecting everything on ~0ms localhost. */
  clockRttSlackMs: 8,
  clockRebaselineAfter: 5,
  pongTimeoutMs: 5000,
  // scheduled execution
  leadMinMs: 80,
  leadMaxMs: 300,
  leadBaseMs: 40,
  pauseLeadMaxMs: 60,
  mediaLoadLeadMs: 2500,
  timerEarlyMs: 8,
  // drift control loop
  driftLoopMs: 500,
  driftIdleMs: 60,
  driftExitMs: 30,
  driftHardMs: 500,
  /** Players without fine-grained playbackRate (YouTube) can only hard seek. */
  coarseHardMs: 350,
  nudgeGain: 0.5,
  nudgeMax: 0.06,
  hardSeekCooldownMs: 2000,
  hardSeekWindowMs: 10000,
  hardSeekMax: 3,
  seekLatencyInitMs: 120,
  telemetryMs: 2000,
  syncedThresholdMs: 100,
  syncedHoldMs: 2000,
  /** Re-anchor on apply only if the local position is off by more than this (avoids stutter). */
  applySeekThresholdSec: 0.1,
  pausedSeekThresholdSec: 0.04,
  // buffering policy
  bufferWaitTimeoutMs: 4000,
  bufferReportDebounceMs: 400,
  catchUpMs: 30000,
  // presence
  hostGraceMs: 10000,
  participantGraceMs: 30000,
  roomTtlMs: 6 * 60 * 60 * 1000,
  // metrics
  metricsWindowMs: 5 * 60 * 1000,
  metricsBroadcastMs: 2000,
  nextUpCountdownMs: 5000,
} as const;

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export const GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Music',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller',
  'War',
  'Western',
] as const;

export const MOODS = ['Cozy', 'Thriller', 'Mind-bend', 'Laugh Riot', 'Epic'] as const;
export type Mood = (typeof MOODS)[number];

export const LANGUAGES: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  hi: 'Hindi',
  zh: 'Chinese',
  pt: 'Portuguese',
  sv: 'Swedish',
  da: 'Danish',
  fa: 'Persian',
  ta: 'Tamil',
  kn: 'Kannada',
  id: 'Indonesian',
  te: 'Telugu',
  ru: 'Russian',
  xx: 'No dialogue',
};
