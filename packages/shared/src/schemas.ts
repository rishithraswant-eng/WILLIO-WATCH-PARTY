import { z } from 'zod';
import { GENRES, LIMITS, REACTION_EMOJIS, ROOM_CODE_REGEX } from './constants';

const finiteNum = z.number().finite();
const nonNeg = finiteNum.min(0);
const id = z.string().min(1).max(64);
const eventId = z.string().min(8).max(64);

export const roomCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(ROOM_CODE_REGEX, 'Room codes are 6 characters'));

export const displayNameSchema = z
  .string()
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Pick a name').max(LIMITS.nameMaxLen));

export const avatarSeedSchema = z.string().min(1).max(32);

export const tasteVectorSchema = z.object({
  genres: z
    .record(z.string().max(32), finiteNum.min(0).max(1))
    .refine((g) => Object.keys(g).length <= GENRES.length + 4, 'Too many genres'),
  likedIds: z.array(id).max(20),
  runtimeMax: z.number().int().min(60).max(400).nullable(),
});

export const controlModeSchema = z.enum(['HOST_ONLY', 'EVERYONE', 'VOTE']);
export const waitPolicySchema = z.enum(['WAIT_FOR_ALL', 'NEVER_WAIT']);

// ---------- REST ----------
export const createRoomSchema = z.object({
  name: displayNameSchema,
  avatarSeed: avatarSeedSchema,
  roomName: z.string().trim().max(LIMITS.roomNameMaxLen).optional(),
  password: z.string().min(4).max(64).optional(),
  controlMode: controlModeSchema.optional(),
  token: z.string().max(2048).optional(),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const joinRoomSchema = z.object({
  name: displayNameSchema,
  avatarSeed: avatarSeedSchema,
  password: z.string().max(64).optional(),
  /** a previous token (any room) lets the user keep the same identity */
  token: z.string().max(2048).optional(),
});
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;

const optNum = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().finite().min(min).max(max).optional());

export const movieQuerySchema = z.object({
  q: z.string().max(100).optional(),
  genres: z.string().max(300).optional(),
  yearMin: optNum(1900, 2100),
  yearMax: optNum(1900, 2100),
  ratingMin: optNum(0, 10),
  runtimeMax: optNum(1, 600),
  lang: z.string().max(8).optional(),
  mood: z.string().max(20).optional(),
  free: z.enum(['true', 'false']).optional(),
  sort: z.enum(['relevance', 'popularity', 'rating', 'year', 'title', 'runtime']).optional(),
  cursor: optNum(0, 100000),
  limit: optNum(1, 100),
});
export type MovieQuery = z.infer<typeof movieQuerySchema>;

// ---------- Socket C->S ----------
export const joinEventSchema = z.object({
  code: roomCodeSchema,
  lastEseq: z.number().int().min(0).optional(),
  bootId: z.string().max(64).optional(),
  tasteVector: tasteVectorSchema.optional(),
});

export const pingSchema = z.object({ t0: finiteNum });

export const playSchema = z.object({ eventId, baseSeq: z.number().int().min(0), pos: nonNeg.optional() });
export const pauseSchema = z.object({ eventId, baseSeq: z.number().int().min(0), pos: nonNeg.optional() });
export const seekSchema = z.object({
  eventId,
  baseSeq: z.number().int().min(0),
  pos: nonNeg,
  final: z.boolean().optional(),
});
export const rateSchema = z.object({
  eventId,
  baseSeq: z.number().int().min(0),
  rate: finiteNum.min(0.25).max(2),
});
export const loadMovieSchema = z.object({ movieId: id });
export const bufferingSchema = z.object({ state: z.enum(['START', 'END']), pos: nonNeg });
export const endedSchema = z.object({ mediaId: id });
export const durationSchema = z.object({ mediaId: id, duration: finiteNum.min(0).max(60 * 60 * 24) });

export const telemetrySchema = z.object({
  drift: finiteNum.min(-1e7).max(1e7),
  mode: z.enum(['IDLE', 'NUDGING', 'HARD_SEEK', 'BUFFERING']),
  rtt: finiteNum.min(0).max(60000),
  offset: finiteNum.min(-1e12).max(1e12),
  pos: nonNeg,
  rate: finiteNum.min(0).max(4),
  hardSeeks: z.number().int().min(0).max(1e6),
});

export const syncAckSchema = z.object({
  seq: z.number().int().min(0),
  recvServerTs: finiteNum,
  appliedAt: finiteNum,
});
export const replaySchema = z.object({ lastEseq: z.number().int().min(0), bootId: z.string().max(64) });
export const metricsSubSchema = z.object({ on: z.boolean() });

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed');

export const queueAddSchema = z.object({
  movieId: id.optional(),
  url: httpUrl.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  playNext: z.boolean().optional(),
}).refine((v) => Boolean(v.movieId) !== Boolean(v.url), 'Provide either a movie or a URL');
export const queueItemSchema = z.object({ itemId: id });
export const queueReorderSchema = z.object({
  itemId: id,
  beforeId: id.nullable(),
  afterId: id.nullable(),
  version: z.number().int().min(0),
});

export const chatSendSchema = z.object({
  id: z.string().min(6).max(64),
  text: z.string().max(LIMITS.chatMaxLen * 2),
});
export const typingSchema = z.object({ on: z.boolean() });
export const reactionSchema = z.object({ emoji: z.enum(REACTION_EMOJIS) });

export const pollPayloadSchema = z.object({
  movieId: id.optional(),
  pos: nonNeg.optional(),
  minutes: finiteNum.min(1).max(LIMITS.intermissionMaxMin).optional(),
  action: z.enum(['play', 'pause', 'seek', 'rate', 'skip']).optional(),
});

export const pollCreateSchema = z.object({
  question: z.string().trim().min(1).max(LIMITS.pollQuestionMaxLen),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(LIMITS.pollOptionMaxLen), payload: pollPayloadSchema.optional() }))
    .min(LIMITS.pollOptionsMin)
    .max(LIMITS.pollOptionsMax),
  durationSec: z.number().int().min(LIMITS.pollDurationMinSec).max(LIMITS.pollDurationMaxSec),
  anonymous: z.boolean().default(false),
  type: z.enum(['GENERIC', 'NEXT_MOVIE', 'SKIP_TO', 'PAUSE_BREAK']).default('GENERIC'),
  payload: pollPayloadSchema.optional(),
});
export type PollCreateInput = z.infer<typeof pollCreateSchema>;
export const pollVoteSchema = z.object({ pollId: id, optionId: id });
export const pollCloseSchema = z.object({ pollId: id });

export const hostTransferSchema = z.object({ toUserId: id });
export const hostRespondSchema = z.object({ userId: id, accept: z.boolean() });
export const roleSetSchema = z.object({ userId: id, role: z.enum(['MOD', 'VIEWER']) });

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.roomNameMaxLen).optional(),
  controlMode: controlModeSchema.optional(),
  waitPolicy: waitPolicySchema.optional(),
  queueMode: z.enum(['HOST_ONLY', 'EVERYONE']).optional(),
  tieBreak: z.enum(['HOST_VOTE', 'RANDOM']).optional(),
});

export const chaosSchema = z.object({
  type: z.enum(['LATENCY', 'DROP', 'DISCONNECT', 'BUFFER', 'DESYNC', 'SERVER_DELAY', 'CLEAR']),
  targetId: id.optional(),
  params: z
    .object({
      ms: z.number().int().min(0).max(10000).optional(),
      pct: finiteNum.min(0).max(0.9).optional(),
      durationMs: z.number().int().min(1000).max(120000).optional(),
    })
    .optional(),
});

export const intermissionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), minutes: finiteNum.min(0.25).max(LIMITS.intermissionMaxMin) }),
  z.object({ action: z.literal('cancel') }),
]);
