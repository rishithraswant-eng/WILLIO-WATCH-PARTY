import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** Runs the real server in a child process (single process via `node --import tsx`, so kill is a real crash). */
export class ServerProcess {
  private child: ChildProcess | null = null;
  readonly dataDir = mkdtempSync(join(tmpdir(), 'bp-bench-'));
  private logTail: string[] = [];

  constructor(readonly port: number) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    const entry = join(REPO_ROOT, 'apps', 'server', 'src', 'index.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT_SERVER: String(this.port),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        SNAPSHOT_STORE: 'file',
        DATA_DIR: this.dataDir,
        RATE_LIMIT_REST: 'false',
        SEED_DEMO_ROOM: 'false',
        CHAOS_ENABLED: 'true',
        DATABASE_URL: '',
        REDIS_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    const keep = (buf: Buffer) => {
      this.logTail.push(...buf.toString().split('\n').filter(Boolean));
      if (this.logTail.length > 50) this.logTail.splice(0, this.logTail.length - 50);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    await this.waitHealthy(30_000);
  }

  private async waitHealthy(timeoutMs: number): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (this.child?.exitCode != null) throw new Error(`server exited early:\n${this.logTail.join('\n')}`);
      try {
        const r = await fetch(`${this.url}/api/health`);
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`server did not become healthy:\n${this.logTail.join('\n')}`);
  }

  /** Hard crash (no graceful shutdown, no final snapshot flush). */
  async crash(): Promise<void> {
    const c = this.child;
    if (!c) return;
    const exited = new Promise<void>((r) => c.once('exit', () => r()));
    c.kill('SIGKILL');
    await exited;
    this.child = null;
  }

  async stop(): Promise<void> {
    const c = this.child;
    if (!c) return;
    const exited = new Promise<void>((r) => c.once('exit', () => r()));
    c.kill('SIGTERM');
    const t = setTimeout(() => c.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(t);
    this.child = null;
  }

  logs(): string[] {
    return this.logTail.slice();
  }
}
