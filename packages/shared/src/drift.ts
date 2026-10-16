import { SYNC } from './constants';
import { clamp } from './sync';
import type { DriftMode } from './types';

export interface DriftInput {
  /** player position - expected position, in ms. Positive = ahead. */
  driftMs: number;
  /** local monotonic-ish ms (used for cooldowns) */
  now: number;
  roomRate: number;
  /** false for players that cannot change playbackRate smoothly (e.g. YouTube) */
  fineRate: boolean;
}

export interface DriftDecision {
  mode: DriftMode;
  /** playback rate to apply */
  rate: number;
  /** hard seek to the expected position (plus seek latency compensation) */
  seek: boolean;
  /** hard-seek budget exhausted: suggest the "Resync me" button */
  suggestResync: boolean;
}

/** Rate for a proportional nudge: ahead -> slow down, behind -> speed up. */
export function nudgeRate(driftMs: number, roomRate: number): number {
  const k = clamp((driftMs / 1000) * SYNC.nudgeGain, -SYNC.nudgeMax, SYNC.nudgeMax);
  return roomRate * (1 - k);
}

/**
 * Tiered drift controller (PRD 8.5):
 *   |d| < 60ms            IDLE (dead zone)
 *   60ms <= |d| < 500ms   NUDGING via playbackRate, exits below 30ms (hysteresis)
 *   |d| >= 500ms          HARD_SEEK, 2s cooldown, max 3 per 10s, then suggest resync
 */
export class DriftController {
  private _mode: DriftMode = 'IDLE';
  private lastHardSeekAt = Number.NEGATIVE_INFINITY;
  private hardSeekTimes: number[] = [];
  private _totalHardSeeks = 0;

  get mode(): DriftMode {
    return this._mode;
  }
  get totalHardSeeks(): number {
    return this._totalHardSeeks;
  }
  get lastHardSeek(): number | null {
    return Number.isFinite(this.lastHardSeekAt) ? this.lastHardSeekAt : null;
  }

  /** Forget correction state (after an authoritative re-anchor). Keeps the hard-seek budget. */
  reset(): void {
    this._mode = 'IDLE';
  }

  setBuffering(): void {
    this._mode = 'BUFFERING';
  }

  step({ driftMs, now, roomRate, fineRate }: DriftInput): DriftDecision {
    const abs = Math.abs(driftMs);
    this.hardSeekTimes = this.hardSeekTimes.filter((t) => now - t < SYNC.hardSeekWindowMs);
    const hardThreshold = fineRate ? SYNC.driftHardMs : SYNC.coarseHardMs;

    if (abs >= hardThreshold) {
      const cooldownOk = now - this.lastHardSeekAt >= SYNC.hardSeekCooldownMs;
      const budgetOk = this.hardSeekTimes.length < SYNC.hardSeekMax;
      if (cooldownOk && budgetOk) {
        this.lastHardSeekAt = now;
        this.hardSeekTimes.push(now);
        this._totalHardSeeks++;
        this._mode = 'HARD_SEEK';
        return { mode: 'HARD_SEEK', rate: roomRate, seek: true, suggestResync: false };
      }
      // Cannot seek right now: push as hard as allowed with the rate.
      this._mode = fineRate ? 'NUDGING' : 'HARD_SEEK';
      return {
        mode: this._mode,
        rate: fineRate ? nudgeRate(driftMs, roomRate) : roomRate,
        seek: false,
        suggestResync: !budgetOk,
      };
    }

    if (!fineRate) {
      this._mode = 'IDLE';
      return { mode: 'IDLE', rate: roomRate, seek: false, suggestResync: false };
    }

    const correcting = this._mode === 'NUDGING' || this._mode === 'HARD_SEEK';
    const shouldNudge = correcting ? abs >= SYNC.driftExitMs : abs >= SYNC.driftIdleMs;
    if (shouldNudge) {
      this._mode = 'NUDGING';
      return { mode: 'NUDGING', rate: nudgeRate(driftMs, roomRate), seek: false, suggestResync: false };
    }
    this._mode = 'IDLE';
    return { mode: 'IDLE', rate: roomRate, seek: false, suggestResync: false };
  }
}
