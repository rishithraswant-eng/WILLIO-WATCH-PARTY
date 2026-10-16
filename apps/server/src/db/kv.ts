import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { Redis } from 'ioredis';

/**
 * Small persistence surface used for crash recovery and cross-room aggregates.
 *   redis  - production (room:{code}:snapshot with TTL, presence hashes)
 *   file   - local dev without Redis (atomic JSON files in DATA_DIR)
 *   memory - tests
 * Every method is best-effort and never throws into the realtime path.
 */
export interface KvStore {
  readonly kind: 'redis' | 'file' | 'memory';
  saveRoom(code: string, json: string, ttlMs: number): Promise<void>;
  loadRooms(): Promise<string[]>;
  deleteRoom(code: string): Promise<void>;
  setPresence(code: string, userId: string, value: object | null): Promise<void>;
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  healthy(): boolean;
  close(): Promise<void>;
}

export class MemoryKv implements KvStore {
  readonly kind = 'memory' as const;
  private rooms = new Map<string, { json: string; expires: number }>();
  private data = new Map<string, string>();
  async saveRoom(code: string, json: string, ttlMs: number): Promise<void> {
    this.rooms.set(code, { json, expires: Date.now() + ttlMs });
  }
  async loadRooms(): Promise<string[]> {
    const now = Date.now();
    return [...this.rooms.values()].filter((r) => r.expires > now).map((r) => r.json);
  }
  async deleteRoom(code: string): Promise<void> {
    this.rooms.delete(code);
  }
  async setPresence(): Promise<void> {}
  async getJSON<T>(key: string): Promise<T | null> {
    const v = this.data.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }
  async setJSON(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  healthy(): boolean {
    return true;
  }
  async close(): Promise<void> {}
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');

export class FileKv implements KvStore {
  readonly kind = 'file' as const;
  private ready: Promise<void>;
  private writing = new Map<string, Promise<void>>();

  constructor(
    private readonly dir: string,
    private readonly log: FastifyBaseLogger,
  ) {
    this.ready = mkdir(join(dir, 'rooms'), { recursive: true }).then(() => undefined);
  }

  /** Serialise writes per file and write atomically (tmp + rename). */
  private async atomicWrite(path: string, content: string): Promise<void> {
    const prev = this.writing.get(path) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        const tmp = `${path}.${process.pid}.tmp`;
        await writeFile(tmp, content, 'utf8');
        await rename(tmp, path);
      });
    this.writing.set(path, next);
    try {
      await next;
    } catch (err) {
      this.log.warn({ err, path }, 'file kv write failed');
    } finally {
      if (this.writing.get(path) === next) this.writing.delete(path);
    }
  }

  async saveRoom(code: string, json: string, ttlMs: number): Promise<void> {
    const wrapped = JSON.stringify({ expiresAt: Date.now() + ttlMs, room: JSON.parse(json) as unknown });
    await this.atomicWrite(join(this.dir, 'rooms', `${safeName(code)}.json`), wrapped);
  }

  async loadRooms(): Promise<string[]> {
    await this.ready;
    const out: string[] = [];
    const dir = join(this.dir, 'rooms');
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      return out;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await readFile(join(dir, f), 'utf8')) as { expiresAt: number; room: unknown };
        if (parsed.expiresAt > Date.now()) out.push(JSON.stringify(parsed.room));
        else await rm(join(dir, f), { force: true });
      } catch (err) {
        this.log.warn({ err, file: f }, 'skipping unreadable room snapshot');
      }
    }
    return out;
  }

  async deleteRoom(code: string): Promise<void> {
    try {
      await rm(join(this.dir, 'rooms', `${safeName(code)}.json`), { force: true });
    } catch (err) {
      this.log.warn({ err }, 'file kv delete failed');
    }
  }

  async setPresence(): Promise<void> {}

  async getJSON<T>(key: string): Promise<T | null> {
    await this.ready;
    try {
      return JSON.parse(await readFile(join(this.dir, `${safeName(key)}.json`), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    await this.atomicWrite(join(this.dir, `${safeName(key)}.json`), JSON.stringify(value));
  }

  healthy(): boolean {
    return true;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.writing.values()]);
  }
}

export class RedisKv implements KvStore {
  readonly kind = 'redis' as const;
  private client: Redis;
  private ok = false;

  constructor(
    url: string,
    private readonly log: FastifyBaseLogger,
  ) {
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.client.on('ready', () => {
      this.ok = true;
      this.log.info('redis connected');
    });
    this.client.on('error', (err) => {
      if (this.ok) this.log.warn({ err: err.message }, 'redis error - degrading to in-memory until it is back');
      this.ok = false;
    });
    this.client.on('end', () => {
      this.ok = false;
    });
  }

  /** Wait (bounded) for the first connection so boot-time restore can read snapshots. */
  async waitReady(timeoutMs = 3000): Promise<boolean> {
    if (this.ok) return true;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(this.ok), timeoutMs);
      this.client.once('ready', () => {
        clearTimeout(t);
        resolve(true);
      });
    });
  }

  private async guard<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.ok) return fallback;
    try {
      return await fn();
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'redis op failed');
      return fallback;
    }
  }

  async saveRoom(code: string, json: string, ttlMs: number): Promise<void> {
    await this.guard(async () => {
      await this.client.set(`room:${code}:snapshot`, json, 'PX', ttlMs);
    }, undefined);
  }

  async loadRooms(): Promise<string[]> {
    return this.guard(async () => {
      const out: string[] = [];
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(cursor, 'MATCH', 'room:*:snapshot', 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          const values = await this.client.mget(...keys);
          for (const v of values) if (v) out.push(v);
        }
      } while (cursor !== '0');
      return out;
    }, []);
  }

  async deleteRoom(code: string): Promise<void> {
    await this.guard(async () => {
      await this.client.del(`room:${code}:snapshot`, `room:${code}:presence`);
    }, undefined);
  }

  async setPresence(code: string, userId: string, value: object | null): Promise<void> {
    await this.guard(async () => {
      const key = `room:${code}:presence`;
      if (value) await this.client.hset(key, userId, JSON.stringify(value));
      else await this.client.hdel(key, userId);
      await this.client.pexpire(key, 6 * 60 * 60 * 1000);
    }, undefined);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    return this.guard(async () => {
      const v = await this.client.get(key);
      return v ? (JSON.parse(v) as T) : null;
    }, null);
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    await this.guard(async () => {
      await this.client.set(key, JSON.stringify(value));
    }, undefined);
  }

  healthy(): boolean {
    return this.ok;
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
