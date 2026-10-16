import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { shortId } from '@willio/shared';
import { registerApi, readLatestBench } from './api/routes';
import { TokenService } from './auth/token';
import { Catalog } from './catalog/catalog';
import { fetchTmdbCatalog } from './catalog/tmdb';
import type { Config } from './config';
import { NoopDurable, PrismaDurable, type DurableStore } from './db/durable';
import { FileKv, MemoryKv, RedisKv, type KvStore } from './db/kv';
import { RoomManager } from './rooms/RoomManager';
import { HeatStore } from './services/heat';
import { attachSocketServer } from './socket';
import { RateLimiter } from './util/rateLimiter';

export interface RunningServer {
  app: FastifyInstance;
  manager: RoomManager;
  kv: KvStore;
  durable: DurableStore;
  catalog: Catalog;
  bootId: string;
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface CreateServerOptions {
  /** inject a catalog (tests) instead of reading catalog.json */
  catalog?: Catalog;
  /** inject a KV store (tests) */
  kv?: KvStore;
  logger?: boolean;
}

async function chooseKv(config: Config, log: FastifyBaseLogger): Promise<KvStore> {
  const mode = config.snapshotStore;
  if ((mode === 'auto' || mode === 'redis') && config.redisUrl) {
    const kv = new RedisKv(config.redisUrl, log);
    const ok = await kv.waitReady(3000);
    if (!ok) log.warn('redis not reachable at boot - snapshots resume once it is back');
    return kv;
  }
  if (mode === 'memory') return new MemoryKv();
  return new FileKv(config.dataDir, log);
}

function originChecker(config: Config) {
  return (origin: string | undefined): boolean => {
    // Non-browser clients (bench bots, curl) send no Origin header.
    if (!origin) return true;
    // No allowlist configured: reflect any origin (dev / LAN testing). Production sets CORS_ORIGIN.
    if (config.corsOrigins.length === 0) return true;
    return config.corsOrigins.includes(origin);
  };
}

export async function createServer(config: Config, options: CreateServerOptions = {}): Promise<RunningServer> {
  const startedAt = Date.now();
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            ...(config.isProd || config.env === 'test'
              ? {}
              : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
          },
    trustProxy: true,
    bodyLimit: 64 * 1024,
    // Request lines are noise next to realtime logs; errors are still logged.
    disableRequestLogging: true,
  });
  const log = app.log;
  if (config.usingDevSecret && !config.isProd) log.warn('JWT_SECRET not set - using the development secret');
  if (config.isProd && config.corsOrigins.length === 0) log.warn('CORS_ORIGIN not set - accepting any origin');

  const allowed = originChecker(config);
  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, allowed(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  const kv = options.kv ?? (await chooseKv(config, log));
  const durable: DurableStore = config.databaseUrl ? await PrismaDurable.create(config.databaseUrl, log) : new NoopDurable();
  const catalog = options.catalog ?? (await Catalog.load(config.catalogPath));
  const heat = new HeatStore(kv);
  await heat.hydrate(durable);
  const bootId = shortId(12);
  const tokens = new TokenService(config.jwtSecret);
  const limiter = new RateLimiter();
  const manager = new RoomManager({
    log,
    kv,
    durable,
    heat,
    catalog,
    bootId,
    chaosEnabled: config.chaosEnabled,
    roomMaxUsers: config.roomMaxUsers,
  });

  await registerApi(app, {
    manager,
    catalog,
    tokens,
    limiter,
    kv,
    durable,
    benchResultsDir: config.benchResultsDir,
    bootId,
    startedAt,
    restRateLimit: config.restRateLimit,
  });

  const sockets = attachSocketServer(app.server, { manager, tokens, limiter, log, isAllowedOrigin: allowed });
  const restored = await manager.restore();
  if (restored > 0) log.info({ restored }, 'restored rooms from snapshot store');
  if (config.seedDemoRoom) manager.ensureDemoRoom();

  await app.listen({ port: config.port, host: config.host });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  log.info(
    { port, kv: kv.kind, db: durable.enabled, catalog: catalog.size, bootId },
    `Willio server ready on http://localhost:${port}`,
  );

  // Background, non-blocking boot work.
  if (durable.enabled) {
    void durable.seedMovies(catalog.all()).then((n) => n > 0 && log.info({ n }, 'seeded movies table'));
    void readLatestBench(config.benchResultsDir).then((b) => {
      const run = b as { id?: string; scenario?: string; users?: number; durationS?: number; conditions?: unknown } | null;
      if (run?.id) {
        void durable.benchRun({
          id: run.id,
          scenario: run.scenario ?? 'suite',
          users: run.users ?? 0,
          durationS: run.durationS ?? 0,
          conditions: run.conditions ?? {},
          results: b,
        });
      }
    });
  }
  if (config.tmdbApiKey && !options.catalog) {
    fetchTmdbCatalog(config.tmdbApiKey, log)
      .then((movies) => {
        const added = catalog.merge(movies);
        log.info({ added, total: catalog.size }, 'merged TMDB movies into the catalog');
        if (durable.enabled) void durable.seedMovies(catalog.all());
      })
      .catch((err: unknown) => log.warn({ err: (err as Error).message }, 'TMDB sync failed - using bundled catalog'));
  }

  let closed = false;
  return {
    app,
    manager,
    kv,
    durable,
    catalog,
    bootId,
    port,
    url: `http://localhost:${port}`,
    async close() {
      if (closed) return;
      closed = true;
      sockets.close();
      await manager.shutdown();
      await heat.close();
      limiter.dispose();
      await app.close().catch(() => undefined);
      await kv.close();
      await durable.close();
    },
  };
}
