import { performance } from 'node:perf_hooks';
import type { PlayerLike } from '@blockparty/shared';

/**
 * Deterministic-ish simulated video element:
 *  - a hardware clock skew (decoders never run at exactly 1.000x) so drift actually accumulates
 *  - seek latency (time stands still while "seeking", like a real decoder)
 *  - injectable stalls (buffering)
 */
export class SimPlayer implements PlayerLike {
  readonly fineRate = true;
  private base = 0;
  private lastT = performance.now();
  private playing = false;
  private rate = 1;
  private blockedUntil = 0;
  private seekingUntil = 0;
  onSeeked: (() => void) | null = null;

  constructor(
    private readonly skew: number,
    private readonly seekLatency: () => number,
  ) {}

  private now(): number {
    return performance.now();
  }

  private progressSince(from: number, to: number): number {
    const start = Math.max(from, this.blockedUntil, this.seekingUntil);
    if (!this.playing || to <= start) return 0;
    return ((to - start) / 1000) * this.rate * this.skew;
  }

  private fold(): void {
    const n = this.now();
    this.base += this.progressSince(this.lastT, n);
    this.lastT = n;
  }

  isReady(): boolean {
    return true;
  }
  getTime(): number {
    return this.base + this.progressSince(this.lastT, this.now());
  }
  isPaused(): boolean {
    return !this.playing;
  }
  isStalled(): boolean {
    const n = this.now();
    return n < this.seekingUntil || n < this.blockedUntil;
  }
  play(): void {
    this.fold();
    this.playing = true;
  }
  pause(): void {
    this.fold();
    this.playing = false;
  }
  seek(sec: number): void {
    this.fold();
    this.base = Math.max(0, sec);
    const latency = this.seekLatency();
    this.seekingUntil = this.now() + latency;
    setTimeout(() => this.onSeeked?.(), latency).unref();
  }
  setRate(r: number): void {
    this.fold();
    this.rate = r;
  }
  getRate(): number {
    return this.rate;
  }
  /** Simulate a network stall (buffering) for ms. */
  stall(ms: number): void {
    this.fold();
    this.blockedUntil = this.now() + ms;
  }
  /** Knock the player off the timeline (chaos / desync tests). */
  jump(deltaSec: number): void {
    this.fold();
    this.base = Math.max(0, this.base + deltaSec);
  }
}
