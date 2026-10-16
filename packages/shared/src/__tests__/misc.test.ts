import { describe, expect, it } from 'vitest';
import { deriveMoods, matchesFilters, sortMovies } from '../catalog';
import { isValidKey, keyBetween } from '../fractional';
import { detectStreamType, mediaIdForUrl, titleFromUrl, youtubeId } from '../media';
import { canManageQueue, canRemoveQueueItem, playbackPermission } from '../permissions';
import { decideWinner, tallyVotes } from '../polls';
import { histogram, percentile, summarize } from '../stats';
import { buildTasteVector, fuseScores, movieSimilarity, recommendForGroup } from '../taste';
import type { ControlMode, Movie, Role } from '../types';

describe('fractional indexing', () => {
  it('generates keys strictly between neighbours', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const c = keyBetween(a, b);
    const z = keyBetween(null, a);
    expect(z < a && a < c && c < b).toBe(true);
  });

  it('survives 500 repeated inserts at the same spot', () => {
    let lo = keyBetween(null, null);
    const hi = keyBetween(lo, null);
    for (let i = 0; i < 500; i++) {
      const k = keyBetween(lo, hi);
      expect(lo < k && k < hi).toBe(true);
      expect(isValidKey(k)).toBe(true);
      lo = k;
    }
  });

  it('appending and prepending stays ordered', () => {
    const keys: string[] = [keyBetween(null, null)];
    for (let i = 0; i < 100; i++) keys.push(keyBetween(keys[keys.length - 1]!, null));
    for (let i = 0; i < 100; i++) keys.unshift(keyBetween(null, keys[0]!));
    const sorted = [...keys].sort();
    expect(sorted).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects inverted bounds', () => {
    expect(() => keyBetween('b', 'a')).toThrow();
  });
});

describe('polls', () => {
  const options = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ];
  it('tallies one vote per user and ignores unknown options', () => {
    const votes = new Map([
      ['u1', 'a'],
      ['u2', 'b'],
      ['u3', 'a'],
      ['u4', 'zzz'],
    ]);
    expect(tallyVotes(options, votes)).toEqual({ a: 2, b: 1, c: 0 });
  });
  it('picks the clear winner', () => {
    expect(decideWinner({ a: 2, b: 1 }, { tieBreak: 'RANDOM', hostVote: null, random: () => 0.9 })).toEqual({
      winnerId: 'a',
      tie: false,
    });
  });
  it('no votes means no winner', () => {
    expect(decideWinner({ a: 0, b: 0 }, { tieBreak: 'RANDOM', hostVote: null, random: Math.random }).winnerId).toBeNull();
  });
  it('host vote breaks ties when configured', () => {
    expect(decideWinner({ a: 2, b: 2 }, { tieBreak: 'HOST_VOTE', hostVote: 'b', random: () => 0 })).toEqual({
      winnerId: 'b',
      tie: true,
    });
  });
  it('falls back to random when the host did not vote for a tied option', () => {
    expect(decideWinner({ a: 2, b: 2, c: 1 }, { tieBreak: 'HOST_VOTE', hostVote: 'c', random: () => 0.99 }).winnerId).toBe('b');
  });
});

describe('permission matrix', () => {
  const roles: Role[] = ['HOST', 'MOD', 'VIEWER'];
  const modes: ControlMode[] = ['HOST_ONLY', 'EVERYONE', 'VOTE'];
  const expected: Record<string, string> = {
    'HOST/HOST_ONLY': 'ALLOW',
    'HOST/EVERYONE': 'ALLOW',
    'HOST/VOTE': 'ALLOW',
    'MOD/HOST_ONLY': 'ALLOW',
    'MOD/EVERYONE': 'ALLOW',
    'MOD/VOTE': 'ALLOW',
    'VIEWER/HOST_ONLY': 'DENY',
    'VIEWER/EVERYONE': 'ALLOW',
    'VIEWER/VOTE': 'VOTE',
  };
  for (const r of roles)
    for (const m of modes)
      it(`${r} in ${m}`, () => {
        expect(playbackPermission(r, m)).toBe(expected[`${r}/${m}`]);
      });
  it('queue management', () => {
    expect(canManageQueue('VIEWER', 'HOST_ONLY')).toBe(false);
    expect(canManageQueue('VIEWER', 'EVERYONE')).toBe(true);
    expect(canRemoveQueueItem('VIEWER', 'HOST_ONLY', true)).toBe(true);
    expect(canRemoveQueueItem('VIEWER', 'HOST_ONLY', false)).toBe(false);
  });
});

describe('stats', () => {
  it('percentiles', () => {
    const v = Array.from({ length: 101 }, (_, i) => i);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 99)).toBe(7);
  });
  it('summarize + histogram', () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s).toMatchObject({ count: 4, min: 1, max: 4, mean: 2.5 });
    const h = histogram([0, 4, 5, 9, 25], 5, 20);
    // buckets 0-5,5-10,10-15,15-20,20-25 ; 25 is above maxValue and lands in the last bucket
    expect(h.map((b) => b.count)).toEqual([2, 2, 0, 0, 1]);
  });
});

describe('media helpers', () => {
  it('detects YouTube in its many forms', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('https://youtu.be/aqz-KE-bpKQ?t=3')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('https://www.youtube.com/embed/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ');
    expect(youtubeId('https://example.com/watch?v=aqz-KE-bpKQ')).toBeNull();
  });
  it('detects stream types', () => {
    expect(detectStreamType('https://a.b/x/master.m3u8')).toBe('HLS');
    expect(detectStreamType('https://a.b/x/movie.mp4')).toBe('MP4');
    expect(detectStreamType('https://youtu.be/aqz-KE-bpKQ')).toBe('YOUTUBE');
  });
  it('derives stable ids and readable titles', () => {
    expect(mediaIdForUrl('https://a.b/c.mp4')).toBe(mediaIdForUrl('https://a.b/c.mp4'));
    expect(titleFromUrl('https://a.b/films/big_buck-bunny.mp4')).toBe('big buck bunny');
  });
});

const movie = (id: string, genres: string[], over: Partial<Movie> = {}): Movie => ({
  id,
  title: id,
  originalTitle: null,
  overview: '',
  year: 2000,
  runtimeMin: 100,
  rating: 7,
  popularity: 50,
  language: 'en',
  genres,
  keywords: [],
  cast: [],
  posterUrl: null,
  backdropUrl: null,
  trailerUrl: null,
  streamUrl: null,
  streamType: null,
  isFree: false,
  moods: [],
  ...over,
});

describe('taste fusion', () => {
  const scifi = movie('scifi', ['Sci-Fi', 'Adventure']);
  const romcom = movie('romcom', ['Romance', 'Comedy']);
  const horror = movie('horror', ['Horror'], { runtimeMin: 150 });

  it('builds weights from liked movies and picked genres', () => {
    const v = buildTasteVector([scifi, movie('x', ['Sci-Fi'])], ['Comedy'], 120);
    expect(v.genres['Sci-Fi']).toBe(1);
    expect(v.genres['Adventure']).toBe(0.5);
    expect(v.genres['Comedy']).toBe(1);
    expect(v.runtimeMax).toBe(120);
  });

  it('similarity prefers matching genres and penalises long runtimes', () => {
    const v = buildTasteVector([scifi], [], 120);
    expect(movieSimilarity(scifi, v)).toBeGreaterThan(movieSimilarity(romcom, v));
    expect(movieSimilarity(horror, v)).toBeLessThan(0.3);
  });

  it('least-misery fusion punishes a movie one member hates', () => {
    expect(fuseScores([0.9, 0.9])).toBeGreaterThan(fuseScores([1, 0.6]));
  });

  it('recommends for a group with explanations and per-member compat', () => {
    const members = [
      { id: 'a', name: 'Aman', vector: buildTasteVector([scifi]) },
      { id: 'b', name: 'Priya', vector: buildTasteVector([movie('y', ['Sci-Fi', 'Comedy'])]) },
      { id: 'c', name: 'NoTaste', vector: null },
    ];
    const recs = recommendForGroup([romcom, scifi, horror], members, 3);
    expect(recs[0]!.movie.id).toBe('scifi');
    expect(recs[0]!.members).toHaveLength(2);
    expect(recs[0]!.reason).toMatch(/2\/2 like Sci-Fi/);
  });

  it('falls back to crowd favourites when nobody shared taste', () => {
    const recs = recommendForGroup([romcom, movie('best', ['Drama'], { rating: 9.5 })], [], 2);
    expect(recs[0]!.movie.id).toBe('best');
  });
});

describe('catalog helpers', () => {
  const list = [
    movie('a', ['Comedy'], { year: 1999, rating: 6, isFree: true }),
    movie('b', ['Horror', 'Thriller'], { year: 2015, rating: 8, runtimeMin: 90, language: 'ko' }),
    movie('c', ['Adventure', 'Fantasy'], { year: 2003, rating: 9, runtimeMin: 200 }),
  ];
  it('filters combine', () => {
    expect(list.filter((m) => matchesFilters(m, { genres: ['Horror', 'Comedy'], yearMin: 2000 })).map((m) => m.id)).toEqual(['b']);
    expect(list.filter((m) => matchesFilters(m, { free: true })).map((m) => m.id)).toEqual(['a']);
    expect(list.filter((m) => matchesFilters(m, { lang: 'ko', runtimeMax: 100 })).map((m) => m.id)).toEqual(['b']);
  });
  it('sorts', () => {
    expect(sortMovies(list, 'rating').map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(sortMovies(list, 'year').map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });
  it('derives moods', () => {
    expect(deriveMoods(list[2]!)).toContain('Epic');
    expect(deriveMoods(list[1]!)).toContain('Thriller');
    expect(deriveMoods(list[0]!)).toContain('Laugh Riot');
  });
});
