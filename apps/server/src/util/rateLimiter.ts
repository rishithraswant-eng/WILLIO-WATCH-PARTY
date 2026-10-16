import { RATE_LIMITS, type RateLimitKey } from '@willio/shared';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window per (user, event) limiter. In-memory on purpose: a room (and therefore its
 * users) is owned by one server process, so counters never need cross-node coordination.
 */
export class RateLimiter {
  private windows = new Map<string, Window>();
  private sweep: NodeJS.Timeout;

  constructor(private readonly now: () => number = Date.now) {
    this.sweep = setInterval(() => this.cleanup(), 30_000);
    this.sweep.unref();
  }

  /** Returns true when allowed (and counts the hit). */
  hit(subject: string, key: RateLimitKey): boolean {
    const limit = RATE_LIMITS[key];
    const k = `${subject}:${key}`;
    const now = this.now();
    const w = this.windows.get(k);
    if (!w || now >= w.resetAt) {
      this.windows.set(k, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    if (w.count >= limit.max) return false;
    w.count++;
    return true;
  }

  private cleanup(): void {
    const now = this.now();
    for (const [k, w] of this.windows) if (now >= w.resetAt) this.windows.delete(k);
  }

  dispose(): void {
    clearInterval(this.sweep);
  }
}
