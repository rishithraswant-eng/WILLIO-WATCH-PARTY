import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** apps/server (works from src/ in dev and dist/ when bundled) */
export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..', '..');

const DEV_SECRET = 'willio-dev-secret-change-me';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? def : /^(1|true|yes|on)$/i.test(v)));

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Injected by hosts such as Render; wins over PORT_SERVER. */
  PORT: z.coerce.number().int().min(0).max(65535).optional(),
  PORT_SERVER: z.coerce.number().int().min(0).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: optionalStr,
  CORS_ORIGIN: optionalStr,
  ROOM_MAX_USERS: z.coerce.number().int().min(2).max(500).default(50),
  DATABASE_URL: optionalStr,
  REDIS_URL: optionalStr,
  TMDB_API_KEY: optionalStr,
  CHAOS_ENABLED: bool(true),
  SNAPSHOT_STORE: z.enum(['auto', 'redis', 'file', 'memory']).default('auto'),
  DATA_DIR: optionalStr,
  BENCH_RESULTS_DIR: optionalStr,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_DEMO_ROOM: bool(true),
  /** per-IP limits on room create/join (disable for local load tests) */
  RATE_LIMIT_REST: bool(true),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && (!e.JWT_SECRET || e.JWT_SECRET === DEV_SECRET)) {
    throw new Error('JWT_SECRET must be set to a strong secret in production');
  }
  const corsOrigins = (e.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return {
    env: e.NODE_ENV,
    isProd: e.NODE_ENV === 'production',
    port: e.PORT ?? e.PORT_SERVER,
    host: e.HOST,
    jwtSecret: e.JWT_SECRET ?? DEV_SECRET,
    usingDevSecret: !e.JWT_SECRET,
    /** empty = reflect any origin (development convenience, also for LAN tests) */
    corsOrigins,
    roomMaxUsers: e.ROOM_MAX_USERS,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    tmdbApiKey: e.TMDB_API_KEY,
    chaosEnabled: e.CHAOS_ENABLED,
    snapshotStore: e.SNAPSHOT_STORE,
    dataDir: resolve(REPO_ROOT, e.DATA_DIR ?? '.data'),
    benchResultsDir: resolve(REPO_ROOT, e.BENCH_RESULTS_DIR ?? 'bench/results'),
    catalogPath: resolve(SERVER_ROOT, 'data', 'catalog.json'),
    logLevel: e.LOG_LEVEL,
    seedDemoRoom: e.SEED_DEMO_ROOM,
    restRateLimit: e.RATE_LIMIT_REST,
  };
}
