import { readFile } from 'node:fs/promises';
import Fuse, { type FuseResultMatch } from 'fuse.js';
import {
  FUSE_OPTIONS,
  MOODS,
  deriveMoods,
  matchesFilters,
  sortMovies,
  type Movie,
  type MovieFilters,
  type MovieQuery,
  type MovieSort,
} from '@blockparty/shared';

export interface SearchResult {
  items: Movie[];
  total: number;
  nextCursor: number | null;
  /** movie id -> [start, end] index pairs of title matches, for highlighting */
  highlights: Record<string, [number, number][]>;
}

function titleHighlights(matches: readonly FuseResultMatch[] | undefined): [number, number][] {
  const m = matches?.find((x) => x.key === 'title');
  return m ? m.indices.map(([a, b]) => [a, b] as [number, number]) : [];
}

/** In-memory movie catalog with a Fuse index (rebuilt when TMDB data is merged). */
export class Catalog {
  private movies: Movie[] = [];
  private byId = new Map<string, Movie>();
  private fuse: Fuse<Movie> = new Fuse<Movie>([], FUSE_OPTIONS);

  static async load(path: string): Promise<Catalog> {
    const c = new Catalog();
    const raw = JSON.parse(await readFile(path, 'utf8')) as Movie[];
    c.setMovies(raw);
    return c;
  }

  static fromMovies(movies: Movie[]): Catalog {
    const c = new Catalog();
    c.setMovies(movies);
    return c;
  }

  private setMovies(movies: Movie[]): void {
    this.movies = movies.map((m) => ({ ...m, moods: m.moods?.length ? m.moods : deriveMoods(m) }));
    this.byId = new Map(this.movies.map((m) => [m.id, m]));
    this.fuse = new Fuse(this.movies, FUSE_OPTIONS);
  }

  /** Merge external movies (TMDB). Existing ids are replaced, open films are kept. */
  merge(extra: Movie[]): number {
    const map = new Map(this.movies.map((m) => [m.id, m]));
    let added = 0;
    for (const m of extra) {
      if (!map.has(m.id)) added++;
      map.set(m.id, m);
    }
    this.setMovies([...map.values()]);
    return added;
  }

  get size(): number {
    return this.movies.length;
  }

  all(): Movie[] {
    return this.movies;
  }

  get(id: string): Movie | undefined {
    return this.byId.get(id);
  }

  search(q: MovieQuery): SearchResult {
    const filters: MovieFilters = {
      genres: q.genres ? q.genres.split(',').map((g) => g.trim()).filter(Boolean) : undefined,
      yearMin: q.yearMin,
      yearMax: q.yearMax,
      ratingMin: q.ratingMin,
      runtimeMax: q.runtimeMax,
      lang: q.lang || undefined,
      mood: q.mood || undefined,
      free: q.free === 'true' ? true : undefined,
    };
    const text = q.q?.trim() ?? '';
    const highlights: Record<string, [number, number][]> = {};
    let list: Movie[];
    let sort: MovieSort = q.sort ?? (text ? 'relevance' : 'popularity');
    if (text.length >= 1) {
      const results = this.fuse.search(text, { limit: 200 });
      list = [];
      for (const r of results) {
        if (!matchesFilters(r.item, filters)) continue;
        list.push(r.item);
        const h = titleHighlights(r.matches);
        if (h.length) highlights[r.item.id] = h;
      }
    } else {
      list = this.movies.filter((m) => matchesFilters(m, filters));
      if (sort === 'relevance') sort = 'popularity';
    }
    list = sortMovies(list, sort);
    const cursor = q.cursor ?? 0;
    const limit = q.limit ?? 24;
    const items = list.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < list.length ? cursor + limit : null;
    const pageHighlights: Record<string, [number, number][]> = {};
    for (const m of items) if (highlights[m.id]) pageHighlights[m.id] = highlights[m.id]!;
    return { items, total: list.length, nextCursor, highlights: pageHighlights };
  }

  categories(): Record<string, Movie[]> {
    const byPop = sortMovies(this.movies, 'popularity');
    const out: Record<string, Movie[]> = {
      trending: byPop.filter((m) => m.year >= 2010).slice(0, 20),
      topRated: sortMovies(this.movies.filter((m) => m.popularity >= 20), 'rating').slice(0, 20),
      free: this.movies.filter((m) => m.isFree),
    };
    for (const mood of MOODS) out[`mood:${mood}`] = byPop.filter((m) => m.moods.includes(mood)).slice(0, 20);
    return out;
  }
}
