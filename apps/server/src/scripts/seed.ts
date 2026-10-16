/**
 * `npm run seed` - loads catalog.json (>= 300 movies incl. the open films) into PostgreSQL.
 * The server also does this automatically on first boot when the Movie table is empty.
 */
import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import type { Movie } from '@blockparty/shared';
import { loadConfig } from '../config';

async function main(): Promise<void> {
  const config = loadConfig();
  const movies = JSON.parse(await readFile(config.catalogPath, 'utf8')) as Movie[];
  if (!config.databaseUrl) {
    console.log(`DATABASE_URL not set - nothing to seed. The server serves ${movies.length} movies from catalog.json in memory.`);
    return;
  }
  const mod = (await import('@prisma/client')) as unknown as {
    PrismaClient?: new (o: object) => PrismaClient;
    default?: { PrismaClient: new (o: object) => PrismaClient };
  };
  const Ctor = mod.PrismaClient ?? mod.default?.PrismaClient;
  if (!Ctor) throw new Error('Prisma client not generated - run `npm run db:generate`');
  const db = new Ctor({ datasources: { db: { url: config.databaseUrl } } });
  try {
    let upserted = 0;
    for (const m of movies) {
      const data = { ...m, streamType: m.streamType ?? null };
      await db.movie.upsert({ where: { id: m.id }, create: data, update: data });
      upserted++;
    }
    console.log(`Seeded ${upserted} movies (${movies.filter((m) => m.isFree).length} free/open films).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
