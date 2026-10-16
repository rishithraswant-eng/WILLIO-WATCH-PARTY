import { describe, expect, it } from 'vitest';
import { ClockEstimator, clockSample, median } from '../clock';
import { SYNC } from '../constants';
import { DriftController, nudgeRate } from '../drift';

describe('clockSample', () => {
  it('computes rtt and offset NTP style', () => {
    // client clock is 1000ms behind the server, 20ms symmetric RTT
    const s = clockSample(0, 1010, 20);
    expect(s.rtt).toBe(20);
    expect(s.offset).toBe(1000);
  });
});

describe('median', () => {
  it('handles odd/even/empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('ClockEstimator', () => {
  it('keeps the lowest-RTT samples of a burst and takes their median offset', () => {
    const c = new ClockEstimator();
    c.initFromBurst([
      { rtt: 5, offset: 100 },
      { rtt: 80, offset: 400 }, // congested outlier
      { rtt: 6, offset: 102 },
      { rtt: 4, offset: 98 },
      { rtt: 90, offset: -300 },
      { rtt: 7, offset: 101 },
    ]);
    expect(c.isReady).toBe(true);
    expect(c.offsetMs).toBeCloseTo(100.5);
    expect(c.bestRttMs).toBe(4);
    expect(c.serverNow(1000)).toBeCloseTo(1100.5);
  });

  it('rejects samples with a much worse RTT', () => {
    const c = new ClockEstimator();
    c.initFromBurst([{ rtt: 10, offset: 0 }]);
    expect(c.addSample({ rtt: 50, offset: 40 })).toBe('rejected-rtt');
    expect(c.offsetMs).toBe(0);
  });

  it('smooths accepted samples with an EMA', () => {
    const c = new ClockEstimator();
    c.initFromBurst([{ rtt: 10, offset: 0 }]);
    expect(c.addSample({ rtt: 12, offset: 10 })).toBe('accepted');
    expect(c.offsetMs).toBeCloseTo(10 * SYNC.clockEmaAlpha);
  });

  it('does not reject everything on ~0ms localhost RTT', () => {
    const c = new ClockEstimator();
    c.initFromBurst([{ rtt: 0, offset: 0 }]);
    expect(c.addSample({ rtt: 3, offset: 1 })).toBe('accepted');
  });

  it('ignores a single offset jump but follows a confirmed one', () => {
    const c = new ClockEstimator();
    c.initFromBurst([{ rtt: 10, offset: 0 }]);
    expect(c.addSample({ rtt: 10, offset: 5000 })).toBe('pending-jump');
    expect(c.offsetMs).toBe(0);
    expect(c.addSample({ rtt: 10, offset: 5010 })).toBe('pending-jump');
    expect(c.addSample({ rtt: 10, offset: 5005 })).toBe('jump-confirmed');
    expect(c.offsetMs).toBe(5005);
  });

  it('a normal sample cancels a pending jump', () => {
    const c = new ClockEstimator();
    c.initFromBurst([{ rtt: 10, offset: 0 }]);
    c.addSample({ rtt: 10, offset: 5000 });
    c.addSample({ rtt: 10, offset: 1 });
    c.addSample({ rtt: 10, offset: 5000 });
    expect(c.addSample({ rtt: 10, offset: 5000 })).toBe('pending-jump');
  });

  it('re-baselines after a run of slow samples', () => {
    const c = new ClockEstimator();
    c.initFromBurst([{ rtt: 2, offset: 0 }]);
    for (let i = 0; i < SYNC.clockRebaselineAfter; i++) c.addSample({ rtt: 200, offset: 0 });
    expect(c.bestRttMs).toBe(200);
    expect(c.addSample({ rtt: 210, offset: 3 })).toBe('accepted');
  });
});

describe('DriftController (table driven)', () => {
  const cases: { name: string; drift: number; prevMode?: 'NUDGING'; mode: string; seek: boolean; rateCmp: 'eq' | 'lt' | 'gt' }[] = [
    { name: 'dead zone', drift: 20, mode: 'IDLE', seek: false, rateCmp: 'eq' },
    { name: 'just under idle threshold', drift: -59, mode: 'IDLE', seek: false, rateCmp: 'eq' },
    { name: 'ahead -> slow down', drift: 200, mode: 'NUDGING', seek: false, rateCmp: 'lt' },
    { name: 'behind -> speed up', drift: -200, mode: 'NUDGING', seek: false, rateCmp: 'gt' },
    { name: 'hysteresis keeps nudging above 30ms', drift: 45, prevMode: 'NUDGING', mode: 'NUDGING', seek: false, rateCmp: 'lt' },
    { name: 'hysteresis exits below 30ms', drift: 25, prevMode: 'NUDGING', mode: 'IDLE', seek: false, rateCmp: 'eq' },
    { name: 'hard seek at 500ms', drift: 500, mode: 'HARD_SEEK', seek: true, rateCmp: 'eq' },
    { name: 'hard seek when far behind', drift: -4000, mode: 'HARD_SEEK', seek: true, rateCmp: 'eq' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const d = new DriftController();
      if (c.prevMode) d.step({ driftMs: 200, now: 0, roomRate: 1, fineRate: true });
      const r = d.step({ driftMs: c.drift, now: 100, roomRate: 1, fineRate: true });
      expect(r.mode).toBe(c.mode);
      expect(r.seek).toBe(c.seek);
      if (c.rateCmp === 'eq') expect(r.rate).toBe(1);
      if (c.rateCmp === 'lt') expect(r.rate).toBeLessThan(1);
      if (c.rateCmp === 'gt') expect(r.rate).toBeGreaterThan(1);
    });
  }

  it('limits nudges to +-6%', () => {
    expect(nudgeRate(400, 1)).toBeCloseTo(0.94);
    expect(nudgeRate(-400, 1)).toBeCloseTo(1.06);
    expect(nudgeRate(100, 2)).toBeCloseTo(2 * 0.95);
  });

  it('enforces the 2s cooldown and 3 seeks per 10s budget', () => {
    const d = new DriftController();
    const step = (now: number) => d.step({ driftMs: 2000, now, roomRate: 1, fineRate: true });
    expect(step(0).seek).toBe(true);
    const cooling = step(1000);
    expect(cooling.seek).toBe(false);
    expect(cooling.mode).toBe('NUDGING');
    expect(step(2000).seek).toBe(true);
    expect(step(4000).seek).toBe(true);
    const exhausted = step(6000);
    expect(exhausted.seek).toBe(false);
    expect(exhausted.suggestResync).toBe(true);
    expect(step(12_500).seek).toBe(true);
    expect(d.totalHardSeeks).toBe(4);
  });

  it('coarse players (YouTube) never nudge and hard seek above 350ms', () => {
    const d = new DriftController();
    expect(d.step({ driftMs: 200, now: 0, roomRate: 1, fineRate: false })).toMatchObject({ mode: 'IDLE', rate: 1 });
    expect(d.step({ driftMs: 400, now: 0, roomRate: 1, fineRate: false }).seek).toBe(true);
  });
});
