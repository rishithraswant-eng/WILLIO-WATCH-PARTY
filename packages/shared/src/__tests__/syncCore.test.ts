import { beforeEach, describe, expect, it } from 'vitest';
import { SYNC } from '../constants';
import { initialPlaybackState } from '../sync';
import { SyncCore, type PlayerLike } from '../syncCore';
import type { MediaSource, PlaybackState, StateUpdate } from '../types';

/** Deterministic simulated player driven by a manual clock. */
class FakePlayer implements PlayerLike {
  readonly fineRate = true;
  time = 0;
  paused = true;
  rate = 1;
  seeks: number[] = [];
  ready = true;
  stalled = false;
  isReady = () => this.ready;
  getTime = () => this.time;
  isPaused = () => this.paused;
  isStalled = () => this.stalled;
  play = () => {
    this.paused = false;
  };
  pause = () => {
    this.paused = true;
  };
  seek = (t: number) => {
    this.time = t;
    this.seeks.push(t);
  };
  setRate = (r: number) => {
    this.rate = r;
  };
  getRate = () => this.rate;
  advance(ms: number) {
    if (!this.paused) this.time += (ms / 1000) * this.rate;
  }
}

const media: MediaSource = { id: 'm', title: 'M', url: 'u', type: 'MP4', posterUrl: null, durationSec: 1000, movieId: null };

function harness() {
  let now = 100_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const applied: number[] = [];
  const player = new FakePlayer();
  const core = new SyncCore({
    serverNow: () => now,
    localNow: () => now,
    scheduleAt: (fn, at) => {
      const id = nextId++;
      timers.push({ at, fn, id });
      return id;
    },
    cancel: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    onApplied: (u) => applied.push(u.seq),
  });
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      player.advance(next.at - now);
      now = next.at;
      next.fn();
    }
    player.advance(target - now);
    now = target;
  };
  return { core, player, advance, applied, getNow: () => now };
}

const state = (over: Partial<PlaybackState>): PlaybackState => ({ ...initialPlaybackState(), media, ...over });
const update = (s: PlaybackState, scheduledAt: number): StateUpdate => ({
  state: s,
  seq: s.seq,
  causedBy: { userId: 'x', name: 'X', action: 'play' },
  scheduledAt,
  serverTs: scheduledAt - 100,
});

describe('SyncCore', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
    h.core.attachPlayer(h.player);
  });

  it('applies an update exactly at scheduledAt, not on receipt', () => {
    const t = h.getNow();
    h.core.receive(update(state({ seq: 1, status: 'PLAYING', anchorPos: 50, anchorTime: t + 120 }), t + 120));
    expect(h.player.paused).toBe(true);
    h.advance(119);
    expect(h.applied).toEqual([]);
    h.advance(1);
    expect(h.applied).toEqual([1]);
    expect(h.player.paused).toBe(false);
    expect(h.player.time).toBeCloseTo(50 + SYNC.seekLatencyInitMs / 1000, 3);
  });

  it('ignores stale and duplicate sequence numbers', () => {
    const t = h.getNow();
    expect(h.core.receive(update(state({ seq: 5, status: 'PAUSED', anchorPos: 1 }), t))).toBe(true);
    expect(h.core.receive(update(state({ seq: 5, status: 'PAUSED', anchorPos: 2 }), t))).toBe(false);
    expect(h.core.receive(update(state({ seq: 3, status: 'PAUSED', anchorPos: 3 }), t))).toBe(false);
    expect(h.core.active?.anchorPos).toBe(1);
  });

  it('a newer update with a shorter lead supersedes an older pending one', () => {
    const t = h.getNow();
    h.core.receive(update(state({ seq: 1, status: 'PLAYING', anchorPos: 10, anchorTime: t + 300 }), t + 300));
    h.core.receive(update(state({ seq: 2, status: 'PAUSED', anchorPos: 20, anchorTime: t + 60 }), t + 60));
    h.advance(400);
    expect(h.applied).toEqual([2]);
    expect(h.player.paused).toBe(true);
    expect(h.player.time).toBe(20);
  });

  it('applies late packets immediately on the intended timeline', () => {
    const t = h.getNow();
    // scheduled 500ms in the past (very late delivery)
    h.core.receive(update(state({ seq: 1, status: 'PLAYING', anchorPos: 10, anchorTime: t - 500 }), t - 500));
    expect(h.applied).toEqual([1]);
    expect(h.player.time).toBeCloseTo(10.5 + SYNC.seekLatencyInitMs / 1000, 3);
  });

  it('parks at the anchor when a snapshot timeline starts in the future', () => {
    const t = h.getNow();
    h.core.loadSnapshot(state({ seq: 9, status: 'PLAYING', anchorPos: 0, anchorTime: t + 2000 }));
    expect(h.player.paused).toBe(true);
    h.advance(2000);
    expect(h.player.paused).toBe(false);
  });

  it('drift loop corrects a desynced player back under 100ms', () => {
    const t = h.getNow();
    h.core.loadSnapshot(state({ seq: 1, status: 'PLAYING', anchorPos: 0, anchorTime: t }));
    h.advance(1000);
    h.player.time += 0.3; // 300ms ahead
    let last = 0;
    for (let i = 0; i < 40; i++) {
      h.advance(SYNC.driftLoopMs);
      h.core.tick();
      last = h.core.lastDriftMs ?? 0;
    }
    expect(Math.abs(last)).toBeLessThan(SYNC.driftExitMs + 5);
    expect(h.player.rate).toBe(1);
  });

  it('hard seeks a far-off player', () => {
    const t = h.getNow();
    h.core.loadSnapshot(state({ seq: 1, status: 'PLAYING', anchorPos: 0, anchorTime: t }));
    h.advance(500);
    h.player.time = 100;
    const d = h.core.tick();
    expect(d?.seek).toBe(true);
    expect(h.player.time).toBeCloseTo(0.5 + SYNC.seekLatencyInitMs / 1000, 2);
  });

  it('reports a blocked autoplay and recovers on unblock', async () => {
    const t = h.getNow();
    let blocked = 0;
    const p = new FakePlayer();
    let allow = false;
    p.play = () => {
      if (!allow) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      p.paused = false;
      return Promise.resolve();
    };
    const core = new SyncCore({
      serverNow: () => t,
      localNow: () => t,
      scheduleAt: () => null,
      cancel: () => undefined,
      onPlayBlocked: () => blocked++,
    });
    core.attachPlayer(p);
    core.loadSnapshot(state({ seq: 1, status: 'PLAYING', anchorPos: 0, anchorTime: t - 10 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(blocked).toBe(1);
    expect(core.blocked).toBe(true);
    allow = true;
    core.unblock();
    await Promise.resolve();
    expect(p.paused).toBe(false);
  });

  it('waits while the media is not ready', () => {
    h.player.ready = false;
    const t = h.getNow();
    h.core.loadSnapshot(state({ seq: 1, status: 'PLAYING', anchorPos: 30, anchorTime: t }));
    expect(h.core.status()).toBe('LOADING');
    expect(h.player.seeks).toEqual([]);
    h.player.ready = true;
    h.core.playerReady();
    expect(h.player.seeks.length).toBe(1);
  });
});
