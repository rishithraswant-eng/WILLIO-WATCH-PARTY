'use client';

import Fuse, { type FuseResult } from 'fuse.js';
import { useEffect, useState } from 'react';
import { FUSE_OPTIONS, type Movie } from '@willio/shared';
import { api } from './api';
import { readJSON, writeJSON } from './storage';

/**
 * Client-side catalog cache: the whole catalog (~150KB) is fetched once and searched locally
 * with the same Fuse options as the server for instant (<50ms) typo-tolerant results.
 * Stale-while-revalidate: a sessionStorage copy renders immediately, then refreshes.
 */

interface CatalogState {
  movies: Movie[];
  byId: Map<string, Movie>;
  fuse: Fuse<Movie>;
}

let state: CatalogState | null = null;
let inflight: Promise<CatalogState> | null = null;
const listeners = new Set<(s: CatalogState) => void>();
const CACHE_KEY = 'bp:catalog:v1';

function build(movies: Movie[]): CatalogState {
  return { movies, byId: new Map(movies.map((m) => [m.id, m])), fuse: new Fuse<Movie>(movies, FUSE_OPTIONS) };
}

function publish(s: CatalogState): void {
  state = s;
  for (const l of listeners) l(s);
}

export function loadCatalog(): Promise<CatalogState> {
  if (!state) {
    const cached = readJSON<Movie[]>(CACHE_KEY, 'session');
    if (cached && cached.length > 0) state = build(cached);
  }
  if (!inflight) {
    inflight = api
      .catalog()
      .then(({ movies }) => {
        writeJSON(CACHE_KEY, movies, 'session');
        const s = build(movies);
        publish(s);
        return s;
      })
      .catch((err: unknown) => {
        inflight = null;
        if (state) return state;
        throw err;
      });
  }
  return state ? Promise.resolve(state) : inflight;
}

export function useCatalog(): { catalog: CatalogState | null; error: string | null } {
  const [s, setS] = useState<CatalogState | null>(state);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const l = (next: CatalogState) => alive && setS(next);
    listeners.add(l);
    loadCatalog()
      .then((c) => alive && setS(c))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load movies'));
    return () => {
      alive = false;
      listeners.delete(l);
    };
  }, []);
  return { catalog: s, error };
}

export type SearchHit = { movie: Movie; titleRanges: [number, number][] };

export function searchCatalog(c: CatalogState, q: string, limit = 60): SearchHit[] {
  const results: FuseResult<Movie>[] = c.fuse.search(q, { limit });
  return results.map((r) => ({
    movie: r.item,
    titleRanges: (r.matches?.find((m) => m.key === 'title')?.indices ?? []).map(([a, b]) => [a, b] as [number, number]),
  }));
}
