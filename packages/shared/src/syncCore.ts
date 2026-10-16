import { SYNC } from './constants';
import { DriftController, type DriftDecision } from './drift';
import { clamp, expectedPos } from './sync';
import type { PlaybackState, StateUpdate } from './types';

/** Minimal player surface the sync core drives (HTML5/HLS/YouTube adapters and bench bots). */
export interface PlayerLike {
  readonly fineRate: boolean;
  /** media loaded and seekable */
  isReady(): boolean;
  getTime(): number;
  isPaused(): boolean;
  /** seeking or waiting for data */
  isStalled(): boolean;
  play(): Promise<void> | void;
  pause(): void;
  seek(sec: number): void;
  setRate(rate: number): void;
  getRate(): number;
}

export interface SyncCoreOptions {
  /** server clock estimate in ms */
  serverNow(): number;
  /** local monotonic ms (performance.now in browsers) */
  localNow(): number;
  /** schedule fn to run when serverNow() reaches `atServerMs` as precisely as possible */
  scheduleAt(fn: () => void, atServerMs: number): unknown;
  cancel(handle: unknown): void;
  onApplied?(update: StateUpdate, info: { recvServerTs: number; appliedAt: number }): void;
  onPlayBlocked?(): void;
  onDecision?(decision: DriftDecision, driftMs: number): void;
}

interface PendingEntry {
  update: StateUpdate;
  recvServerTs: number;
  handle: unknown;
}

export type CoreStatus = 'NO_STATE' | 'NO_PLAYER' | 'LOADING' | 'WAITING_START' | 'BLOCKED' | 'STALLED' | 'PAUSED' | 'PLAYING';

/**
 * Client half of the sync protocol, identical for browsers and bench bots:
 *  - out-of-order guard (ignore seq <= latest)
 *  - scheduled execution at `scheduledAt` (late packets still land on the intended timeline)
 *  - drift control loop with seek-latency compensation
 */
export class SyncCore {
  readonly drift = new DriftController();
  private _active: PlaybackState | null = null;
  private latestSeq = -1;
  private pending: PendingEntry[] = [];
  private player: PlayerLike | null = null;
  private startHandle: unknown = null;
  private seekStartedAt: number | null = null;
  private _seekLatencyMs: number = SYNC.seekLatencyInitMs;
  private _lastDriftMs: number | null = null;
  private _blocked = false;

  constructor(private readonly opts: SyncCoreOptions) {}

  get active(): PlaybackState | null {
    return this._active;
  }
  /** Most recent state received (may still be pending), useful to preload media early. */
  get latest(): PlaybackState | null {
    const last = this.pending[this.pending.length - 1];
    return last ? last.update.state : this._active;
  }
  get lastDriftMs(): number | null {
    return this._lastDriftMs;
  }
  get seekLatencyMs(): number {
    return this._seekLatencyMs;
  }
  get blocked(): boolean {
    return this._blocked;
  }
  get latestSeqSeen(): number {
    return this.latestSeq;
  }

  /** Replace everything with an authoritative snapshot (join / reconnect / resync). */
  loadSnapshot(state: PlaybackState): void {
    for (const p of this.pending) this.opts.cancel(p.handle);
    this.pending = [];
    this.latestSeq = state.seq;
    this._active = state;
    this.drift.reset();
    this.applyActive();
  }

  /** Feed a state:update. Returns false when stale/duplicate. */
  receive(update: StateUpdate): boolean {
    if (update.seq <= this.latestSeq) return false;
    this.latestSeq = update.seq;
    const entry: PendingEntry = { update, recvServerTs: this.opts.serverNow(), handle: null };
    if (update.scheduledAt <= entry.recvServerTs) {
      this.commit(entry);
    } else {
      this.pending.push(entry);
      entry.handle = this.opts.scheduleAt(() => this.commit(entry), update.scheduledAt);
    }
    return true;
  }

  private commit(entry: PendingEntry): void {
    this.pending = this.pending.filter((p) => p !== entry);
    // A newer state already applied (shorter lead, e.g. a pause after a play) supersedes this one.
    if (this._active && entry.update.seq <= this._active.seq) return;
    this._active = entry.update.state;
    this.drift.reset();
    this.applyActive();
    this.opts.onApplied?.(entry.update, { recvServerTs: entry.recvServerTs, appliedAt: this.opts.serverNow() });
  }

  attachPlayer(player: PlayerLike | null): void {
    this.player = player;
    this._lastDriftMs = null;
    this.drift.reset();
    if (player) this.applyActive();
  }

  /** Call when the player became ready (canplay) or after the user unlocked autoplay. */
  playerReady(): void {
    this.applyActive();
  }

  unblock(): void {
    this._blocked = false;
    this.applyActive();
  }

  /** User pressed "Resync me" or tab became visible again. */
  forceResync(): void {
    this.drift.reset();
    this.applyActive(true);
  }

  private seekTo(sec: number): void {
    if (!this.player) return;
    this.seekStartedAt = this.opts.localNow();
    this.player.seek(Math.max(0, sec));
  }

  /** Call when the player reports `seeked` / playback resumed after a seek. */
  onSeeked(): void {
    if (this.seekStartedAt == null) return;
    const measured = this.opts.localNow() - this.seekStartedAt;
    this.seekStartedAt = null;
    if (measured >= 0 && measured < 5000) {
      // Fast attack on slow hosts (range requests to a far CDN), slow decay when seeks get quicker.
      const w = measured > this._seekLatencyMs ? 0.6 : 0.3;
      this._seekLatencyMs = clamp((1 - w) * this._seekLatencyMs + w * measured, 0, 3000);
    }
  }

  private playSafe(): void {
    const p = this.player;
    if (!p) return;
    try {
      const r = p.play();
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch((err: unknown) => {
          const name = (err as { name?: string } | null)?.name;
          if (name === 'NotAllowedError') {
            this._blocked = true;
            this.opts.onPlayBlocked?.();
          }
          // AbortError (play interrupted by pause/load) is expected and harmless.
        });
      }
    } catch {
      /* adapters may throw if torn down mid-call */
    }
  }

  /** Align the player with the active state right now. */
  applyActive(forceSeek = false): void {
    if (this.startHandle != null) {
      this.opts.cancel(this.startHandle);
      this.startHandle = null;
    }
    const s = this._active;
    const p = this.player;
    if (!s || !p || !p.isReady() || !s.media) return;
    const now = this.opts.serverNow();
    if (Math.abs(p.getRate() - s.rate) > 1e-4) p.setRate(s.rate);

    if (s.status === 'PLAYING') {
      if (now < s.anchorTime) {
        // Timeline starts in the future (media load lead / late join during lead): park at the anchor.
        p.pause();
        if (forceSeek || Math.abs(p.getTime() - s.anchorPos) > SYNC.pausedSeekThresholdSec) this.seekTo(s.anchorPos);
        this.startHandle = this.opts.scheduleAt(() => {
          this.startHandle = null;
          this.applyActive();
        }, s.anchorTime);
        return;
      }
      if (this._blocked) return;
      const target = expectedPos(s, now);
      if (forceSeek || Math.abs(p.getTime() - target) > SYNC.applySeekThresholdSec) {
        this.seekTo(target + (this._seekLatencyMs / 1000) * s.rate);
      }
      if (p.isPaused()) this.playSafe();
    } else {
      p.pause();
      if (forceSeek || Math.abs(p.getTime() - s.anchorPos) > SYNC.pausedSeekThresholdSec) this.seekTo(s.anchorPos);
    }
  }

  status(): CoreStatus {
    const s = this._active;
    const p = this.player;
    if (!s || !s.media) return 'NO_STATE';
    if (!p) return 'NO_PLAYER';
    if (!p.isReady()) return 'LOADING';
    if (s.status !== 'PLAYING') return 'PAUSED';
    if (this.opts.serverNow() < s.anchorTime) return 'WAITING_START';
    if (this._blocked) return 'BLOCKED';
    if (p.isStalled()) return 'STALLED';
    return 'PLAYING';
  }

  /** One iteration of the drift loop (call every SYNC.driftLoopMs). */
  tick(): DriftDecision | null {
    const s = this._active;
    const p = this.player;
    const st = this.status();
    if (!s || !p || st === 'NO_STATE' || st === 'NO_PLAYER' || st === 'LOADING') {
      this._lastDriftMs = null;
      return null;
    }
    if (st === 'PAUSED') {
      this.drift.reset();
      this._lastDriftMs = (p.getTime() - s.anchorPos) * 1000;
      if (!p.isPaused()) p.pause();
      if (!p.isStalled() && Math.abs(this._lastDriftMs) > SYNC.pausedSeekThresholdSec * 1000) this.seekTo(s.anchorPos);
      return null;
    }
    if (st === 'WAITING_START' || st === 'BLOCKED') return null;
    if (st === 'STALLED') {
      this.drift.setBuffering();
      return null;
    }
    if (p.isPaused()) {
      this.playSafe();
      return null;
    }
    const target = expectedPos(s, this.opts.serverNow());
    const driftMs = (p.getTime() - target) * 1000;
    this._lastDriftMs = driftMs;
    const d = this.drift.step({ driftMs, now: this.opts.localNow(), roomRate: s.rate, fineRate: p.fineRate });
    if (d.seek) {
      this.seekTo(expectedPos(s, this.opts.serverNow()) + (this._seekLatencyMs / 1000) * s.rate);
      if (Math.abs(p.getRate() - s.rate) > 1e-4) p.setRate(s.rate);
    } else if (Math.abs(p.getRate() - d.rate) > 1e-4) {
      p.setRate(d.rate);
    }
    this.opts.onDecision?.(d, driftMs);
    return d;
  }

  dispose(): void {
    for (const p of this.pending) this.opts.cancel(p.handle);
    this.pending = [];
    if (this.startHandle != null) this.opts.cancel(this.startHandle);
    this.startHandle = null;
    this.player = null;
  }
}
