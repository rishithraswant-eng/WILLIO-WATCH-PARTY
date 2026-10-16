import type { FastifyBaseLogger } from 'fastify';
import { deriveMoods, type Movie } from '@willio/shared';

/** Optional TMDB sync: pulls popular + top rated movies and maps them to the catalog shape. */

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

interface ListResult {
  id: number;
}
interface Detail {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  release_date?: string;
  runtime?: number | null;
  vote_average?: number;
  popularity?: number;
  original_language?: string;
  genres?: { id: number }[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  credits?: { cast?: { name: string }[] };
  keywords?: { keywords?: { name: string }[] };
  videos?: { results?: { site: string; type: string; key: string }[] };
}

async function getJson<T>(url: string, key: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const isV4 = key.length > 40;
    const res = await fetch(isV4 ? url : `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`, {
      headers: isV4 ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function mapDetail(d: Detail): Movie | null {
  const year = Number((d.release_date ?? '').slice(0, 4));
  if (!d.title || !year) return null;
  const genres = (d.genres ?? []).map((g) => GENRE_MAP[g.id]).filter((g): g is string => !!g);
  const keywords = (d.keywords?.keywords ?? []).slice(0, 8).map((k) => k.name);
  const trailer = d.videos?.results?.find((v) => v.site === 'YouTube' && v.type === 'Trailer');
  const base = {
    genres,
    keywords,
    runtimeMin: d.runtime ?? 100,
  };
  return {
    id: `tmdb-${d.id}`,
    title: d.title,
    originalTitle: d.original_title && d.original_title !== d.title ? d.original_title : null,
    overview: d.overview ?? '',
    year,
    runtimeMin: base.runtimeMin,
    rating: Math.round((d.vote_average ?? 0) * 10) / 10,
    popularity: Math.min(100, Math.round(d.popularity ?? 0)),
    language: d.original_language ?? 'en',
    genres,
    keywords,
    cast: (d.credits?.cast ?? []).slice(0, 4).map((c) => c.name),
    posterUrl: d.poster_path ? `${IMG}/w342${d.poster_path}` : null,
    backdropUrl: d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : null,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    streamUrl: null,
    streamType: null,
    isFree: false,
    moods: deriveMoods(base),
  };
}

export async function fetchTmdbCatalog(apiKey: string, log: FastifyBaseLogger, maxMovies = 300): Promise<Movie[]> {
  const ids = new Set<number>();
  for (const list of ['popular', 'top_rated']) {
    for (let page = 1; page <= 8 && ids.size < maxMovies; page++) {
      const r = await getJson<{ results: ListResult[] }>(`${API}/movie/${list}?page=${page}`, apiKey);
      for (const m of r.results) ids.add(m.id);
    }
  }
  const queue = [...ids].slice(0, maxMovies);
  const out: Movie[] = [];
  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const d = await getJson<Detail>(`${API}/movie/${id}?append_to_response=credits,keywords,videos`, apiKey);
        const m = mapDetail(d);
        if (m) out.push(m);
      } catch (err) {
        log.debug({ err: (err as Error).message, id }, 'tmdb detail failed');
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}
