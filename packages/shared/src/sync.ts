import { SYNC } from './constants';
import type { MediaSource, PlaybackState } from './types';

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

type AnchorLike = Pick<PlaybackState, 'status' | 'anchorPos' | 'anchorTime' | 'rate'>;

/**
 * Where the media should be at `serverNow`.
 * PLAYING: anchorPos + elapsed * rate, where elapsed never goes negative (a timeline
 * scheduled for the future has not started yet). Otherwise the anchor itself.
 */
export function expectedPos(state: AnchorLike, serverNow: number): number {
  if (state.status !== 'PLAYING') return state.anchorPos;
  const elapsedMs = Math.max(0, serverNow - state.anchorTime);
  return state.anchorPos + (elapsedMs / 1000) * state.rate;
}

/** Scheduled-start lead: clamp(1.5 * maxRTT/2 + 40ms, 80, 300). */
export function computeLead(maxRttMs: number): number {
  const rtt = Number.isFinite(maxRttMs) && maxRttMs > 0 ? maxRttMs : 0;
  return Math.round(clamp((1.5 * rtt) / 2 + SYNC.leadBaseMs, SYNC.leadMinMs, SYNC.leadMaxMs));
}

export function clampPos(pos: number, durationSec: number | null | undefined): number {
  const p = Number.isFinite(pos) ? Math.max(0, pos) : 0;
  if (durationSec && durationSec > 0) return Math.min(p, Math.max(0, durationSec - 0.05));
  return p;
}

export function initialPlaybackState(): PlaybackState {
  return {
    seq: 0,
    status: 'PAUSED',
    media: null,
    rate: 1,
    anchorPos: 0,
    anchorTime: 0,
    updatedBy: null,
    ended: false,
  };
}

export type Transition =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; pos: number }
  | { type: 'rate'; rate: number }
  | { type: 'load'; media: MediaSource; autoplay: boolean; startPos?: number }
  | { type: 'buffer' }
  | { type: 'resume' }
  | { type: 'end' };

export interface TransitionContext {
  /** server ms */
  now: number;
  /** scheduled-start lead in ms (see computeLead) */
  lead: number;
  userId: string | null;
}

export interface TransitionResult {
  state: PlaybackState;
  scheduledAt: number;
}

/**
 * Pure, total state machine for playback. Every call produces a new state with seq+1.
 * The server is the only caller that commits results; tests and bots use it too.
 */
export function applyTransition(prev: PlaybackState, t: Transition, ctx: TransitionContext): TransitionResult {
  const { now, lead, userId } = ctx;
  const quickLead = Math.min(lead, SYNC.pauseLeadMaxMs);
  const duration = prev.media?.durationSec ?? null;
  const base = { ...prev, seq: prev.seq + 1, updatedBy: userId };

  switch (t.type) {
    case 'play': {
      const scheduledAt = now + lead;
      let startPos =
        prev.status === 'PLAYING' ? expectedPos(prev, scheduledAt) : prev.anchorPos;
      if (prev.ended) startPos = 0;
      return {
        state: { ...base, status: 'PLAYING', anchorPos: clampPos(startPos, duration), anchorTime: scheduledAt, ended: false },
        scheduledAt,
      };
    }
    case 'pause': {
      const scheduledAt = now + quickLead;
      return {
        state: {
          ...base,
          status: 'PAUSED',
          anchorPos: clampPos(expectedPos(prev, scheduledAt), duration),
          anchorTime: scheduledAt,
        },
        scheduledAt,
      };
    }
    case 'seek': {
      // A seek during BUFFERING restarts playback: everybody re-buffers at the new spot anyway.
      const status = prev.status === 'PAUSED' ? 'PAUSED' : 'PLAYING';
      const scheduledAt = now + (status === 'PLAYING' ? lead : quickLead);
      return {
        state: { ...base, status, anchorPos: clampPos(t.pos, duration), anchorTime: scheduledAt, ended: false },
        scheduledAt,
      };
    }
    case 'rate': {
      const scheduledAt = now + lead;
      return {
        state: {
          ...base,
          rate: clamp(t.rate, 0.25, 2),
          anchorPos: clampPos(expectedPos(prev, scheduledAt), duration),
          anchorTime: scheduledAt,
        },
        scheduledAt,
      };
    }
    case 'load': {
      const scheduledAt = now + (t.autoplay ? SYNC.mediaLoadLeadMs : quickLead);
      return {
        state: {
          ...base,
          media: t.media,
          status: t.autoplay ? 'PLAYING' : 'PAUSED',
          rate: 1,
          anchorPos: clampPos(t.startPos ?? 0, t.media.durationSec),
          anchorTime: scheduledAt,
          ended: false,
        },
        scheduledAt,
      };
    }
    case 'buffer': {
      return {
        state: { ...base, status: 'BUFFERING', anchorPos: clampPos(expectedPos(prev, now), duration), anchorTime: now },
        scheduledAt: now,
      };
    }
    case 'resume': {
      const scheduledAt = now + lead;
      return {
        state: { ...base, status: 'PLAYING', anchorPos: prev.anchorPos, anchorTime: scheduledAt },
        scheduledAt,
      };
    }
    case 'end': {
      const endPos = duration ?? expectedPos(prev, now);
      return {
        state: { ...base, status: 'PAUSED', anchorPos: Math.max(0, endPos), anchorTime: now, ended: true },
        scheduledAt: now,
      };
    }
  }
}

/** Formats seconds as H:MM:SS / M:SS. */
export function formatTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
