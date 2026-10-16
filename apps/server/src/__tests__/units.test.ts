import { describe, expect, it } from 'vitest';
import { EventLog, LruMap, RollingWindow } from '../util/collections';
import { RateLimiter } from '../util/rateLimiter';
import { findMentions, generateRoomCode, parseSlash, sanitizeChat } from '../util/text';
import { ROOM_CODE_REGEX } from '@willio/shared';

describe('EventLog (ring buffer replay)', () => {
  const fill = (n: number, cap: number) => {
    const log = new EventLog(cap);
    for (let i = 1; i <= n; i++) log.push({ eseq: i, event: 'x', payload: i });
    return log;
  };
  it('replays exactly the missed events', () => {
    const log = fill(10, 300);
    expect(log.since(7, 10)!.map((e) => e.eseq)).toEqual([8, 9, 10]);
    expect(log.since(10, 10)).toEqual([]);
  });
  it('requires a snapshot when the gap fell out of the ring', () => {
    const log = fill(400, 300);
    expect(log.size).toBe(300);
    expect(log.since(50, 400)).toBeNull();
    expect(log.since(100, 400)!.length).toBe(300);
    expect(log.since(99, 400)).toBeNull();
  });
  it('rejects a client that is ahead of the server (restart)', () => {
    expect(fill(5, 10).since(9, 5)).toBeNull();
  });
});

describe('LruMap', () => {
  it('evicts the oldest entry', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.get('a');
    m.set('c', 3);
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
    expect(m.size).toBe(2);
  });
});

describe('RollingWindow', () => {
  it('drops samples outside the window', () => {
    const w = new RollingWindow(1000);
    w.add(1, 0);
    w.add(2, 500);
    w.add(3, 1200);
    expect(w.values(1300)).toEqual([2, 3]);
  });
});

describe('RateLimiter', () => {
  it('allows max hits per window then blocks until reset', () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 5; i++) expect(rl.hit('u', 'chat:send')).toBe(true);
    expect(rl.hit('u', 'chat:send')).toBe(false);
    expect(rl.hit('other', 'chat:send')).toBe(true);
    now = 5001;
    expect(rl.hit('u', 'chat:send')).toBe(true);
    rl.dispose();
  });
});

describe('text utils', () => {
  it('generates valid unambiguous codes', () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode()).toMatch(ROOM_CODE_REGEX);
  });
  it('sanitizes chat text', () => {
    const rlo = String.fromCodePoint(0x202e);
    const zwsp = String.fromCodePoint(0x200b);
    expect(sanitizeChat(`  hi${rlo} there${zwsp}  `)).toBe('hi there');
    expect(sanitizeChat('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(sanitizeChat('a'.repeat(900)).length).toBe(500);
    expect(sanitizeChat('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('parses slash commands', () => {
    expect(parseSlash('hello')).toBeNull();
    expect(parseSlash('/shrug ok')).toEqual({ kind: 'shrug', rest: 'ok' });
    expect(parseSlash('/poll "Pizza or tacos?" pizza | tacos | both')).toEqual({
      kind: 'poll',
      question: 'Pizza or tacos?',
      options: ['pizza', 'tacos', 'both'],
    });
    expect(parseSlash('/poll Skip intro? yes | no')).toEqual({ kind: 'poll', question: 'Skip intro?', options: ['yes', 'no'] });
    expect(parseSlash('/skip')).toEqual({ kind: 'skip' });
    expect(parseSlash('/dance')).toEqual({ kind: 'unknown', name: 'dance' });
  });
  it('finds mentions by display name', () => {
    const people = [
      { id: '1', name: 'Aman' },
      { id: '2', name: 'Priya S' },
      { id: '3', name: 'Am' },
    ];
    expect(findMentions('hey @aman and @Priya S!', people).sort()).toEqual(['1', '2']);
    expect(findMentions('email me at x@amanda.com', people)).toEqual([]);
  });
});
