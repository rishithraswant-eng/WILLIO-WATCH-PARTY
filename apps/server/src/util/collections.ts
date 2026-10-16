import type { LoggedEvent } from '@willio/shared';

/** Fixed-capacity ring of logged events with replay-from-eseq. */
export class EventLog {
  private buf: LoggedEvent[] = [];
  constructor(private readonly capacity: number) {}

  push(e: LoggedEvent): void {
    this.buf.push(e);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
  }

  get size(): number {
    return this.buf.length;
  }

  /**
   * Events with eseq > lastEseq, or null when the gap is no longer covered by the ring
   * (caller must fall back to a full snapshot).
   */
  since(lastEseq: number, currentEseq: number): LoggedEvent[] | null {
    if (lastEseq > currentEseq) return null;
    if (lastEseq === currentEseq) return [];
    const first = this.buf[0];
    if (!first || first.eseq > lastEseq + 1) return null;
    return this.buf.filter((e) => e.eseq > lastEseq);
  }

  clear(): void {
    this.buf = [];
  }
}

/** Size-bounded map that evicts the least recently inserted/touched key. */
export class LruMap<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** Rolling window of timestamped numeric samples. */
export class RollingWindow {
  private samples: { t: number; v: number }[] = [];
  constructor(
    private readonly windowMs: number,
    private readonly maxSamples = 20000,
  ) {}

  add(v: number, t = Date.now()): void {
    this.samples.push({ t, v });
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
  }

  values(now = Date.now()): number[] {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.samples.length && this.samples[i]!.t < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
    return this.samples.map((s) => s.v);
  }

  count(now = Date.now()): number {
    return this.values(now).length;
  }
}
