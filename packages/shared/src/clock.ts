import { SYNC } from './constants';

export interface ClockSample {
  rtt: number;
  offset: number;
}

/** NTP-style sample: client sends t0, server stamps ts, client receives at t1. */
export function clockSample(t0: number, ts: number, t1: number): ClockSample {
  const rtt = Math.max(0, t1 - t0);
  return { rtt, offset: ts - (t0 + rtt / 2) };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export type SampleVerdict = 'accepted' | 'rejected-rtt' | 'pending-jump' | 'jump-confirmed';

/**
 * Estimates (server clock - local clock).
 *  - initial burst: keep the N lowest-RTT samples, take the median offset
 *  - continuous: accept a sample only if its RTT is close to the best RTT, smooth with EMA,
 *    reject jumps > 250ms unless confirmed by 3 consecutive samples (clock jump / sleep)
 */
export class ClockEstimator {
  private offset = 0;
  private best = Number.POSITIVE_INFINITY;
  private ready = false;
  private rejectStreak = 0;
  private jumpCandidates: number[] = [];
  private rttEma: number | null = null;

  get isReady(): boolean {
    return this.ready;
  }
  get offsetMs(): number {
    return this.offset;
  }
  get bestRttMs(): number {
    return Number.isFinite(this.best) ? this.best : 0;
  }
  /** Smoothed RTT of all samples (for display / lead computation). */
  get rttMs(): number {
    return this.rttEma ?? 0;
  }

  serverNow(localNow: number = Date.now()): number {
    return localNow + this.offset;
  }

  reset(): void {
    this.offset = 0;
    this.best = Number.POSITIVE_INFINITY;
    this.ready = false;
    this.rejectStreak = 0;
    this.jumpCandidates = [];
    this.rttEma = null;
  }

  private trackRtt(rtt: number): void {
    this.rttEma = this.rttEma == null ? rtt : this.rttEma + 0.3 * (rtt - this.rttEma);
  }

  /** Initialise from a burst of samples. Returns false if the burst was empty. */
  initFromBurst(samples: readonly ClockSample[]): boolean {
    if (samples.length === 0) return false;
    const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, SYNC.clockKeep);
    this.offset = median(best.map((s) => s.offset));
    this.best = best[0]!.rtt;
    this.ready = true;
    this.rejectStreak = 0;
    this.jumpCandidates = [];
    for (const s of samples) this.trackRtt(s.rtt);
    return true;
  }

  addSample(s: ClockSample): SampleVerdict {
    this.trackRtt(s.rtt);
    if (!this.ready) {
      this.initFromBurst([s]);
      return 'accepted';
    }
    const limit = Math.max(2 * this.best, this.best + SYNC.clockRttSlackMs);
    if (s.rtt > limit) {
      this.rejectStreak++;
      // The network got permanently slower: re-baseline instead of rejecting forever.
      if (this.rejectStreak >= SYNC.clockRebaselineAfter) {
        this.best = s.rtt;
        this.rejectStreak = 0;
      }
      return 'rejected-rtt';
    }
    this.rejectStreak = 0;
    if (s.rtt < this.best) this.best = s.rtt;

    if (Math.abs(s.offset - this.offset) > SYNC.clockJumpRejectMs) {
      this.jumpCandidates.push(s.offset);
      if (this.jumpCandidates.length >= SYNC.clockJumpConfirm) {
        const spread = Math.max(...this.jumpCandidates) - Math.min(...this.jumpCandidates);
        if (spread <= SYNC.clockJumpRejectMs) {
          this.offset = median(this.jumpCandidates);
          this.jumpCandidates = [];
          return 'jump-confirmed';
        }
        this.jumpCandidates.shift();
      }
      return 'pending-jump';
    }
    this.jumpCandidates = [];
    this.offset += SYNC.clockEmaAlpha * (s.offset - this.offset);
    return 'accepted';
  }
}
