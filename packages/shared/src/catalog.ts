import type { Mood } from './constants';
import type { Movie } from './types';

/** Fuse.js options shared by server search and client instant search (PRD section 10). */
export const FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'originalTitle', weight: 0.2 },
    { name: 'cast', weight: 0.15 },
    { name: 'keywords', weight: 0.1 },
    { name: 'overview', weight: 0.05 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  includeMatches: true,
  includeScore: true,
  minMatchCharLength: 2,
};

export interface MovieFilters {
  genres?: string[];
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  runtimeMax?: number;
  lang?: string;
  mood?: string;
  free?: boolean;
}

export type MovieSort = 'relevance' | 'popularity' | 'rating' | 'year' | 'title' | 'runtime';

export function matchesFilters(m: Movie, f: MovieFilters): boolean {
  if (f.genres && f.genres.length > 0 && !f.genres.some((g) => m.genres.includes(g))) return false;
  if (f.yearMin != null && m.year < f.yearMin) return false;
  if (f.yearMax != null && m.year > f.yearMax) return false;
  if (f.ratingMin != null && m.rating < f.ratingMin) return false;
  if (f.runtimeMax != null && m.runtimeMin > f.runtimeMax) return false;
  if (f.lang && m.language !== f.lang) return false;
  if (f.mood && !m.moods.includes(f.mood)) return false;
  if (f.free && !m.isFree) return false;
  return true;
}

export function sortMovies<T extends Movie>(list: T[], sort: MovieSort): T[] {
  const s = [...list];
  switch (sort) {
    case 'rating':
      return s.sort((a, b) => b.rating - a.rating || b.popularity - a.popularity);
    case 'year':
      return s.sort((a, b) => b.year - a.year || b.popularity - a.popularity);
    case 'title':
      return s.sort((a, b) => a.title.localeCompare(b.title));
    case 'runtime':
      return s.sort((a, b) => a.runtimeMin - b.runtimeMin);
    case 'popularity':
      return s.sort((a, b) => b.popularity - a.popularity);
    case 'relevance':
    default:
      return s;
  }
}

/** Mood tags derived from genres + keywords + runtime. */
export function deriveMoods(m: Pick<Movie, 'genres' | 'keywords' | 'runtimeMin'>): Mood[] {
  const g = new Set(m.genres);
  const kw = m.keywords.join(' ').toLowerCase();
  const moods: Mood[] = [];
  if ((g.has('Family') || g.has('Animation') || g.has('Romance') || /friendship|holiday|cozy|food|home/.test(kw)) && !g.has('Horror'))
    moods.push('Cozy');
  if (g.has('Thriller') || g.has('Horror') || g.has('Crime') || (g.has('Mystery') && !g.has('Family'))) moods.push('Thriller');
  if (/time|dream|memory|simulation|twist|identity|parallel|reality|loop|mind/.test(kw) || (g.has('Sci-Fi') && g.has('Mystery')))
    moods.push('Mind-bend');
  if (g.has('Comedy')) moods.push('Laugh Riot');
  if (g.has('War') || g.has('History') || ((g.has('Adventure') || g.has('Fantasy') || g.has('Action')) && m.runtimeMin >= 130))
    moods.push('Epic');
  return moods;
}
