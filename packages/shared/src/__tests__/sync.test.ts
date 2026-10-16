import { describe, expect, it } from 'vitest';
import { SYNC } from '../constants';
import { applyTransition, clampPos, computeLead, expectedPos, formatTime, initialPlaybackState } from '../sync';
import type { MediaSource, PlaybackState } from '../types';

const media: MediaSource = {
  id: 'm1',
  title: 'Test',
  url: 'https://example.com/a.mp4',
  type: 'MP4',
  posterUrl: null,
  durationSec: 600,
  movieId: null,
};

const playing = (over: Partial<PlaybackState> = {}): PlaybackState => ({
  ...initialPlaybackState(),
  media,
  status: 'PLAYING',
  anchorPos: 10,
  anchorTime: 1000,
  ...over,
});

describe('expectedPos', () => {
  it('advances with time while playing', () => {
    expect(expectedPos(playing(), 1000)).toBe(10);
    expect(expectedPos(playing(), 3000)).toBe(12);
  });
  it('respects the playback rate', () => {
    expect(expectedPos(playing({ rate: 2 }), 2000)).toBe(12);
    expect(expectedPos(playing({ rate: 0.5 }), 3000)).toBe(11);
  });
  it('never runs backwards before a scheduled start', () => {
    expect(expectedPos(playing({ anchorTime: 5000 }), 4000)).toBe(10);
  });
  it('is frozen while paused or buffering', () => {
    expect(expectedPos(playing({ status: 'PAUSED' }), 99999)).toBe(10);
    expect(expectedPos(playing({ status: 'BUFFERING' }), 99999)).toBe(10);
  });
});

describe('computeLead', () => {
  it('clamps between 80 and 300ms', () => {
    expect(computeLead(0)).toBe(SYNC.leadMinMs);
    expect(computeLead(10)).toBe(SYNC.leadMinMs);
    expect(computeLead(100)).toBe(115);
    expect(computeLead(1000)).toBe(SYNC.leadMaxMs);
    expect(computeLead(Number.NaN)).toBe(SYNC.leadMinMs);
  });
});

describe('clampPos', () => {
  it('keeps positions inside the media', () => {
    expect(clampPos(-5, 100)).toBe(0);
    expect(clampPos(200, 100)).toBeCloseTo(99.95);
    expect(clampPos(50, null)).toBe(50);
    expect(clampPos(Number.NaN, null)).toBe(0);
  });
});

describe('applyTransition', () => {
  const ctx = { now: 10_000, lead: 120, userId: 'u1' };

  it('play from pause keeps the paused position and schedules ahead', () => {
    const prev = playing({ status: 'PAUSED', anchorPos: 42 });
    const { state, scheduledAt } = applyTransition(prev, { type: 'play' }, ctx);
    expect(state.status).toBe('PLAYING');
    expect(state.anchorPos).toBe(42);
    expect(scheduledAt).toBe(10_120);
    expect(state.anchorTime).toBe(10_120);
    expect(state.seq).toBe(prev.seq + 1);
    expect(state.updatedBy).toBe('u1');
  });

  it('pause freezes at the position of the scheduled moment', () => {
    const prev = playing({ anchorPos: 10, anchorTime: 0 });
    const { state, scheduledAt } = applyTransition(prev, { type: 'pause' }, ctx);
    expect(scheduledAt).toBe(10_000 + SYNC.pauseLeadMaxMs);
    expect(state.status).toBe('PAUSED');
    expect(state.anchorPos).toBeCloseTo(10 + 10.06);
  });

  it('seek while playing keeps playing from the new position', () => {
    const { state } = applyTransition(playing(), { type: 'seek', pos: 300 }, ctx);
    expect(state.status).toBe('PLAYING');
    expect(state.anchorPos).toBe(300);
    expect(state.anchorTime).toBe(10_120);
  });

  it('seek is clamped to the media duration', () => {
    const { state } = applyTransition(playing(), { type: 'seek', pos: 9999 }, ctx);
    expect(state.anchorPos).toBeCloseTo(599.95);
  });

  it('seek during buffering restarts playback', () => {
    const { state } = applyTransition(playing({ status: 'BUFFERING' }), { type: 'seek', pos: 5 }, ctx);
    expect(state.status).toBe('PLAYING');
  });

  it('rate change re-anchors so the position is continuous', () => {
    const prev = playing({ anchorPos: 0, anchorTime: 0 });
    const { state } = applyTransition(prev, { type: 'rate', rate: 2 }, ctx);
    expect(state.rate).toBe(2);
    expect(state.anchorPos).toBeCloseTo(10.12);
    expect(expectedPos(state, 11_120)).toBeCloseTo(12.12);
  });

  it('buffer freezes immediately and resume schedules ahead', () => {
    const prev = playing({ anchorPos: 0, anchorTime: 0 });
    const b = applyTransition(prev, { type: 'buffer' }, ctx);
    expect(b.state.status).toBe('BUFFERING');
    expect(b.state.anchorPos).toBeCloseTo(10);
    const r = applyTransition(b.state, { type: 'resume' }, { ...ctx, now: 12_000 });
    expect(r.state.status).toBe('PLAYING');
    expect(r.state.anchorPos).toBeCloseTo(10);
    expect(r.state.anchorTime).toBe(12_120);
  });

  it('load resets position and autoplays after the media lead', () => {
    const { state, scheduledAt } = applyTransition(playing({ rate: 1.5 }), { type: 'load', media, autoplay: true }, ctx);
    expect(state.anchorPos).toBe(0);
    expect(state.rate).toBe(1);
    expect(scheduledAt).toBe(10_000 + SYNC.mediaLoadLeadMs);
  });

  it('play after the end restarts from zero', () => {
    const ended = applyTransition(playing(), { type: 'end' }, ctx).state;
    expect(ended.ended).toBe(true);
    expect(ended.anchorPos).toBe(600);
    const { state } = applyTransition(ended, { type: 'play' }, ctx);
    expect(state.anchorPos).toBe(0);
    expect(state.ended).toBe(false);
  });

  it('a pause arriving inside a scheduled play window lands on the anchor', () => {
    const p = applyTransition(playing({ status: 'PAUSED', anchorPos: 30 }), { type: 'play' }, ctx).state;
    const { state } = applyTransition(p, { type: 'pause' }, { ...ctx, now: 10_010 });
    expect(state.anchorPos).toBe(30);
  });
});

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(75.9)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});
