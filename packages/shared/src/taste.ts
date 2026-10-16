import type { MemberCompat, Movie, Recommendation, TasteVector } from './types';

type MovieLike = Pick<Movie, 'id' | 'genres' | 'runtimeMin' | 'rating'>;

/**
 * Build a member's taste vector from liked movies + explicitly picked genres.
 * Genre weight = share of liked movies with that genre (max-normalised), picked genres = 1.
 */
export function buildTasteVector(
  liked: readonly MovieLike[],
  pickedGenres: readonly string[] = [],
  runtimeMax: number | null = null,
): TasteVector {
  const counts: Record<string, number> = {};
  for (const m of liked) for (const g of m.genres) counts[g] = (counts[g] ?? 0) + 1;
  const maxCount = Math.max(1, ...Object.values(counts));
  const genres: Record<string, number> = {};
  for (const [g, c] of Object.entries(counts)) genres[g] = Math.round((c / maxCount) * 100) / 100;
  for (const g of pickedGenres) genres[g] = 1;
  return { genres, likedIds: liked.map((m) => m.id).slice(0, 20), runtimeMax };
}

export function hasTaste(v: TasteVector | null | undefined): v is TasteVector {
  return !!v && (Object.keys(v.genres).length > 0 || v.likedIds.length > 0);
}

/** Similarity 0..1 between a movie and a taste vector (cosine on genres + quality prior). */
export function movieSimilarity(movie: MovieLike, v: TasteVector): number {
  const weights = Object.values(v.genres);
  const norm = Math.sqrt(weights.reduce((s, w) => s + w * w, 0));
  let cos = 0.5;
  if (norm > 0 && movie.genres.length > 0) {
    const dot = movie.genres.reduce((s, g) => s + (v.genres[g] ?? 0), 0);
    cos = dot / (Math.sqrt(movie.genres.length) * norm);
  }
  let sim = 0.75 * Math.min(1, cos) + 0.25 * Math.min(1, Math.max(0, movie.rating / 10));
  if (v.likedIds.includes(movie.id)) sim = Math.max(sim, 0.95);
  if (v.runtimeMax && movie.runtimeMin > v.runtimeMax) sim *= 0.7;
  return Math.max(0, Math.min(1, sim));
}

/** "Least misery + average" fusion: 0.6 * mean + 0.4 * min. */
export function fuseScores(sims: readonly number[]): number {
  if (sims.length === 0) return 0;
  const mean = sims.reduce((s, x) => s + x, 0) / sims.length;
  return 0.6 * mean + 0.4 * Math.min(...sims);
}

export interface GroupMember {
  id: string;
  name: string;
  vector: TasteVector | null;
}

function explain(movie: MovieLike, members: readonly GroupMember[], compat: readonly MemberCompat[]): string {
  const withTaste = members.filter((m) => hasTaste(m.vector));
  const total = withTaste.length;
  const genreFans = movie.genres
    .map((g) => ({ g, fans: withTaste.filter((m) => (m.vector!.genres[g] ?? 0) >= 0.5).length }))
    .filter((x) => x.fans > 0)
    .sort((a, b) => b.fans - a.fans);
  const parts: string[] = [];
  if (genreFans.length > 0 && total > 0) {
    parts.push(
      genreFans
        .slice(0, 2)
        .map((x) => `${x.fans}/${total} like ${x.g}`)
        .join(', '),
    );
  } else {
    parts.push(`rated ${movie.rating.toFixed(1)}/10`);
  }
  const runtimeLimits = withTaste.map((m) => m.vector!.runtimeMax).filter((r): r is number => !!r);
  if (runtimeLimits.length > 0 && movie.runtimeMin <= Math.min(...runtimeLimits)) parts.push("fits everyone's runtime");
  const lowest = compat.length > 0 ? Math.min(...compat.map((c) => c.compat)) : 0;
  if (compat.length > 1 && lowest >= 55) parts.push('nobody is left out');
  return `Picked because ${parts.join(' and ')}`;
}

/** Group Taste Fusion recommender. Members without a taste vector are ignored for scoring. */
export function recommendForGroup<M extends MovieLike & { popularity: number }>(
  movies: readonly M[],
  members: readonly GroupMember[],
  limit = 12,
): (Omit<Recommendation, 'movie'> & { movie: M })[] {
  const tasted = members.filter((m) => hasTaste(m.vector));
  const scored = movies.map((movie) => {
    if (tasted.length === 0) {
      const score = (movie.rating / 10) * 0.7 + Math.min(1, movie.popularity / 100) * 0.3;
      return { movie, score, members: [] as MemberCompat[] };
    }
    const sims = tasted.map((m) => movieSimilarity(movie, m.vector!));
    const compat = tasted.map((m, i) => ({ id: m.id, name: m.name, compat: Math.round(sims[i]! * 100) }));
    return { movie, score: fuseScores(sims), members: compat };
  });
  scored.sort((a, b) => b.score - a.score || b.movie.rating - a.movie.rating);
  return scored.slice(0, limit).map((r) => ({
    ...r,
    score: Math.round(r.score * 100) / 100,
    reason:
      tasted.length === 0
        ? 'Crowd favourite - add your taste picks for personal matches'
        : explain(r.movie, members, r.members),
  }));
}
