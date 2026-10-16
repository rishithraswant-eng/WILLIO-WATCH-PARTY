import { loadConfig } from './config';
import { createServer } from './server';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await createServer(config);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    server.app.log.info({ signal }, 'shutting down - saving room snapshots');
    const force = setTimeout(() => process.exit(1), 8000);
    force.unref();
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('unhandledRejection', (err) => server.app.log.error({ err }, 'unhandled rejection'));
}

main().catch((err: unknown) => {
  console.error('Failed to start BlockParty server:', err);
  process.exit(1);
});
