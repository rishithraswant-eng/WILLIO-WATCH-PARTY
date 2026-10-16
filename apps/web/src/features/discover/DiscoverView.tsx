'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  GENRES,
  LANGUAGES,
  MOODS,
  matchesFilters,
  movieSimilarity,
  playbackPermission,
  recommendForGroup,
  sortMovies,
  type Movie,
  type MovieFilters,
  type MovieSort,
  type Recommendation,
} from '@willio/shared';
import { Chip, Skeleton } from '@/components/ui/Bits';
import { GlassButton } from '@/components/ui/Glass';
import { Input, Select, Slider, Switch } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { RoomClientContext, useRoomClient } from '@/features/room/context';
import { api, ApiError } from '@/lib/api';
import { searchCatalog, useCatalog, type SearchHit } from '@/lib/catalog';
import { loadProfile } from '@/lib/profile';
import { sessions } from '@/lib/storage';
import { cx } from '@/lib/util';
import { selectMyRole, useRoom } from '@/store/room';
import { toast } from '@/store/toasts';
import { PosterCard } from './PosterCard';
import { PixelPoster } from './PixelPoster';

type Mode = 'page' | 'room';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Room-aware actions for a card: Play now (host) / Add to queue / Propose poll. */
function RoomActions({ movie, compact }: { movie: Movie; compact?: boolean }) {
  const client = useRoomClient();
  const role = useRoom(selectMyRole);
  const mode = useRoom((s) => s.room?.settings.controlMode ?? 'HOST_ONLY');
  const canPlay = playbackPermission(role, mode) === 'ALLOW';
  if (!movie.isFree) {
    return (
      <span className="text-[10px] text-lo" title="Not streamable in the demo - add a link you have rights to in the Queue tab">
        Bring your own link
      </span>
    );
  }
  return (
    <>
      {canPlay ? (
        <GlassButton size="sm" variant="primary" icon="play" aria-label={`Play ${movie.title} now`} onClick={() => void client.loadMovie(movie.id)}>
          {compact ? '' : 'Play'}
        </GlassButton>
      ) : null}
      <GlassButton
        size="sm"
        icon="plus"
        aria-label={`Add ${movie.title} to the queue`}
        onClick={() => void client.queueAdd({ movieId: movie.id }).then((r) => r.ok && toast.success('Added to queue', movie.title))}
      >
        {compact ? '' : 'Queue'}
      </GlassButton>
      <GlassButton
        size="sm"
        icon="poll"
        title="Propose a 'watch this next?' poll"
        aria-label={`Propose a poll: watch ${movie.title} next?`}
        onClick={() =>
          void client.pollCreate({
            type: 'NEXT_MOVIE',
            question: `Watch "${movie.title}" next?`,
            options: [{ label: movie.title, payload: { movieId: movie.id } }, { label: 'Something else' }],
            durationSec: 45,
            anonymous: false,
          })
        }
      />
    </>
  );
}

function PageActions({ movie }: { movie: Movie }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!movie.isFree) return <span className="text-[10px] text-lo">Not streamable in the demo</span>;
  const watch = async () => {
    const profile = loadProfile();
    if (!profile) {
      router.push(`/?create=1`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.createRoom({ name: profile.name, avatarSeed: profile.avatarSeed, token: sessions.lastToken() ?? undefined });
      sessions.set(res.code, { token: res.token, userId: res.userId });
      router.push(`/r/${res.code}?play=${encodeURIComponent(movie.id)}`);
    } catch (err) {
      toast.error('Could not create a room', err instanceof ApiError ? err.message : undefined);
      setBusy(false);
    }
  };
  return (
    <GlassButton size="sm" variant="primary" icon="play" loading={busy} onClick={() => void watch()}>
      Watch together
    </GlassButton>
  );
}

function Row({
  title,
  movies,
  onOpen,
  mode,
  compat,
  reasons,
}: {
  title: string;
  movies: Movie[];
  onOpen: (m: Movie) => void;
  mode: Mode;
  compat?: Map<string, number>;
  reasons?: Map<string, string>;
}) {
  if (movies.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="font-heading text-gradient text-lg font-semibold">{title}</h2>
      <ul className="scroll-thin -mx-1 flex gap-3 overflow-x-auto px-1 pb-3">
        {movies.map((m) => (
          <li key={m.id} className={mode === 'room' ? 'w-[150px] shrink-0' : 'w-[170px] shrink-0'}>
            <PosterCard
              movie={m}
              onOpen={onOpen}
              compat={compat?.get(m.id) ?? null}
              actions={mode === 'room' ? <RoomActions movie={m} compact /> : <PageActions movie={m} />}
            />
            {reasons?.get(m.id) ? <p className="mt-1 line-clamp-2 text-[10px] text-mid">{reasons.get(m.id)}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MovieModal({ movie, onClose, mode, rec }: { movie: Movie | null; onClose: () => void; mode: Mode; rec: Recommendation | null }) {
  const profile = useMemo(() => loadProfile(), []);
  const me = profile?.taste ? Math.round(movieSimilarity(movie ?? { id: '', genres: [], runtimeMin: 0, rating: 0 }, profile.taste) * 100) : null;
  return (
    <Modal open={!!movie} onClose={onClose} title={movie ? `${movie.title} (${movie.year})` : ''} wide>
      {movie ? (
        <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
          <div className="aspect-[2/3] w-full overflow-hidden">
            <PixelPoster id={movie.id} genres={movie.genres} title={movie.title} posterUrl={movie.posterUrl} />
          </div>
          <div className="flex flex-col gap-3">
            {movie.originalTitle ? <p className="text-xs text-lo">Original title: {movie.originalTitle}</p> : null}
            <div className="flex flex-wrap gap-1.5">
              {movie.genres.map((g) => (
                <Chip key={g}>{g}</Chip>
              ))}
              {movie.moods.map((m) => (
                <Chip key={m} active>
                  {m}
                </Chip>
              ))}
            </div>
            <p className="text-sm text-hi/90">{movie.overview}</p>
            <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-xs">
              <dt className="text-lo">Rating</dt>
              <dd className="font-mono text-hi">{movie.rating.toFixed(1)} / 10</dd>
              <dt className="text-lo">Runtime</dt>
              <dd className="font-mono text-hi">{movie.runtimeMin} min</dd>
              <dt className="text-lo">Language</dt>
              <dd className="text-hi">{LANGUAGES[movie.language] ?? movie.language}</dd>
              <dt className="text-lo">Cast</dt>
              <dd className="text-hi">{movie.cast.join(', ') || '-'}</dd>
            </dl>
            <div className="flex flex-col gap-1.5">
              <p className="font-label text-[10px] text-mid">Compatibility with the room</p>
              {rec && rec.members.length > 0 ? (
                rec.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate text-hi">{m.name}</span>
                    <span className="h-2 flex-1 bg-white/10">
                      <span className="block h-full bg-gradient-to-r from-teal-400 to-lantern" style={{ width: `${m.compat}%` }} />
                    </span>
                    <span className="font-mono w-9 text-right text-mid">{m.compat}%</span>
                  </div>
                ))
              ) : me != null ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate text-hi">You</span>
                  <span className="h-2 flex-1 bg-white/10">
                    <span className="block h-full bg-gradient-to-r from-teal-400 to-lantern" style={{ width: `${me}%` }} />
                  </span>
                  <span className="font-mono w-9 text-right text-mid">{me}%</span>
                </div>
              ) : (
                <p className="text-xs text-lo">Add taste picks to your profile to see matches.</p>
              )}
              {rec?.reason ? <p className="text-xs text-mid">{rec.reason}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">{mode === 'room' ? <RoomActions movie={movie} /> : <PageActions movie={movie} />}</div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function DiscoverView({ mode }: { mode: Mode }) {
  const { catalog, error } = useCatalog();
  const roomClient = useContext(RoomClientContext);
  const participantsKey = useRoom((s) =>
    Object.values(s.participants)
      .filter((p) => p.connected)
      .map((p) => `${p.id}:${p.hasTaste ? 1 : 0}`)
      .sort()
      .join(','),
  );
  const [q, setQ] = useState('');
  const query = useDebounced(q, 150);
  const [genres, setGenres] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState(1950);
  const [ratingMin, setRatingMin] = useState(0);
  const [runtimeMax, setRuntimeMax] = useState<number | null>(null);
  const [lang, setLang] = useState('');
  const [mood, setMood] = useState('');
  const [free, setFree] = useState(false);
  const [sort, setSort] = useState<MovieSort>('relevance');
  const [showFilters, setShowFilters] = useState(false);
  const [open, setOpen] = useState<Movie | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const resultsRef = useRef<HTMLUListElement>(null);

  // Taste Fusion: the room's recommendations (recomputed on join/leave), or personal picks on the page.
  useEffect(() => {
    if (mode === 'room' && roomClient) {
      let alive = true;
      void roomClient.recommend().then((r) => alive && r.ok && setRecs(r.recommendations));
      return () => {
        alive = false;
      };
    }
    if (mode === 'page' && catalog) {
      const p = loadProfile();
      setRecs(p?.taste ? recommendForGroup(catalog.movies, [{ id: 'me', name: 'You', vector: p.taste }], 14) : []);
    }
    return undefined;
  }, [mode, roomClient, catalog, participantsKey]);

  const filters: MovieFilters = useMemo(
    () => ({
      genres: genres.length ? genres : undefined,
      yearMin: yearMin > 1950 ? yearMin : undefined,
      ratingMin: ratingMin > 0 ? ratingMin : undefined,
      runtimeMax: runtimeMax ?? undefined,
      lang: lang || undefined,
      mood: mood || undefined,
      free: free || undefined,
    }),
    [genres, yearMin, ratingMin, runtimeMax, lang, mood, free],
  );
  const filtering = Object.values(filters).some((v) => v !== undefined);
  const searching = query.trim().length > 0;

  const hits: SearchHit[] = useMemo(() => {
    if (!catalog || (!searching && !filtering)) return [];
    if (searching) {
      const found = searchCatalog(catalog, query.trim(), 120).filter((h) => matchesFilters(h.movie, filters));
      if (sort === 'relevance') return found;
      const order = sortMovies(
        found.map((h) => h.movie),
        sort,
      );
      const byId = new Map(found.map((h) => [h.movie.id, h]));
      return order.map((m) => byId.get(m.id)!);
    }
    return sortMovies(catalog.movies.filter((m) => matchesFilters(m, filters)), sort === 'relevance' ? 'popularity' : sort).map((movie) => ({
      movie,
      titleRanges: [],
    }));
  }, [catalog, query, searching, filtering, filters, sort]);

  useEffect(() => setCursor(-1), [query, filters]);

  const rows = useMemo(() => {
    if (!catalog) return null;
    const byPop = sortMovies(catalog.movies, 'popularity');
    return {
      trending: byPop.filter((m) => m.year >= 2010).slice(0, 16),
      topRated: sortMovies(
        catalog.movies.filter((m) => m.popularity >= 20),
        'rating',
      ).slice(0, 16),
      free: catalog.movies.filter((m) => m.isFree),
      moods: MOODS.map((md) => ({ mood: md, movies: byPop.filter((m) => m.moods.includes(md)).slice(0, 14) })),
    };
  }, [catalog]);

  const recCompat = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recs) if (r.members.length) map.set(r.movie.id, Math.round(r.score * 100));
    return map;
  }, [recs]);
  const recReasons = useMemo(() => new Map(recs.map((r) => [r.movie.id, r.reason])), [recs]);
  const openRec = open ? (recs.find((r) => r.movie.id === open.id) ?? null) : null;

  const onSearchKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (hits.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(hits.length - 1, c + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(-1, c - 1));
      } else if (e.key === 'Enter' && cursor >= 0) {
        e.preventDefault();
        setOpen(hits[cursor]!.movie);
      } else if (e.key === 'Escape') setQ('');
    },
    [hits, cursor],
  );

  useEffect(() => {
    if (cursor < 0) return;
    document.getElementById(`hit-${cursor}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cursor]);

  const clearFilters = () => {
    setGenres([]);
    setYearMin(1950);
    setRatingMin(0);
    setRuntimeMax(null);
    setLang('');
    setMood('');
    setFree(false);
  };

  return (
    <div className={cx('flex flex-col gap-4', mode === 'room' ? 'p-3' : '')}>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            className="flex-1"
            icon="search"
            placeholder="Search titles, cast, keywords... (typos welcome)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label="Search movies"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="discover-results"
            aria-activedescendant={cursor >= 0 ? `hit-${cursor}` : undefined}
          />
          <GlassButton icon="gear" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="discover-filters">
            Filters{filtering ? ` (${Object.values(filters).filter((v) => v !== undefined).length})` : ''}
          </GlassButton>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Genres">
          {GENRES.map((g) => (
            <Chip key={g} active={genres.includes(g)} onClick={() => setGenres((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))}>
              {g}
            </Chip>
          ))}
        </div>
        {showFilters ? (
          <div id="discover-filters" className="glass glass-sm pixel-corners-sm grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Slider label="From year" min={1950} max={2024} value={yearMin} onChange={setYearMin} format={(v) => (v <= 1950 ? 'any' : String(v))} />
            <Slider label="Min rating" min={0} max={9} step={0.5} value={ratingMin} onChange={setRatingMin} format={(v) => (v === 0 ? 'any' : `${v}+`)} />
            <Select label="Max runtime" value={runtimeMax ?? ''} onChange={(e) => setRuntimeMax(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any length</option>
              <option value="30">Shorts (&le; 30m)</option>
              <option value="100">&le; 1h40</option>
              <option value="120">&le; 2h</option>
              <option value="150">&le; 2h30</option>
            </Select>
            <Select label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="">Any language</option>
              {Object.entries(LANGUAGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Select label="Mood" value={mood} onChange={(e) => setMood(e.target.value)}>
              <option value="">Any mood</option>
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Select label="Sort" value={sort} onChange={(e) => setSort(e.target.value as MovieSort)}>
              <option value="relevance">Relevance</option>
              <option value="popularity">Popularity</option>
              <option value="rating">Rating</option>
              <option value="year">Newest</option>
              <option value="title">Title A-Z</option>
              <option value="runtime">Shortest</option>
            </Select>
            <div className="flex items-end">
              <Switch checked={free} onChange={setFree} label="Free to watch now" />
            </div>
            <div className="flex items-end justify-end">
              <GlassButton size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </GlassButton>
            </div>
          </div>
        ) : null}
      </div>

      {error && !catalog ? (
        <p className="glass pixel-corners-sm p-4 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!catalog && !error ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-[150px] shrink-0" />
          ))}
        </div>
      ) : null}

      {catalog && (searching || filtering) ? (
        <section aria-label="Results" className="flex flex-col gap-2">
          <p className="text-xs text-mid" aria-live="polite">
            {hits.length} {hits.length === 1 ? 'result' : 'results'}
            {searching ? ` for "${query.trim()}"` : ''}
            {hits.length > 0 && searching ? ' - use arrow keys + Enter' : ''}
          </p>
          {hits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-lo">
              <PixelIcon name="search" size={24} />
              Nothing in this chunk. Try fewer filters.
            </div>
          ) : (
            <ul
              id="discover-results"
              ref={resultsRef}
              role="listbox"
              aria-label="Search results"
              className={cx('grid gap-3', mode === 'room' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6')}
            >
              {hits.slice(0, 120).map((h, i) => (
                <li key={h.movie.id} role="option" aria-selected={i === cursor}>
                  <PosterCard
                    id={`hit-${i}`}
                    movie={h.movie}
                    ranges={h.titleRanges}
                    onOpen={setOpen}
                    active={i === cursor}
                    compat={recCompat.get(h.movie.id) ?? null}
                    actions={mode === 'room' ? <RoomActions movie={h.movie} compact /> : <PageActions movie={h.movie} />}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {catalog && rows && !searching && !filtering ? (
        <div className="flex flex-col gap-4">
          <Row
            title={mode === 'room' ? 'Picked for this room (Taste Fusion)' : 'Picked for you'}
            movies={recs.map((r) => r.movie)}
            onOpen={setOpen}
            mode={mode}
            compat={recCompat}
            reasons={recReasons}
          />
          <Row title="Open & free - watch right now" movies={rows.free} onOpen={setOpen} mode={mode} />
          <Row title="Trending" movies={rows.trending} onOpen={setOpen} mode={mode} />
          <Row title="Top rated" movies={rows.topRated} onOpen={setOpen} mode={mode} />
          {rows.moods.map((m) => (
            <Row key={m.mood} title={`Mood: ${m.mood}`} movies={m.movies} onOpen={setOpen} mode={mode} />
          ))}
        </div>
      ) : null}

      <MovieModal movie={open} onClose={() => setOpen(null)} mode={mode} rec={openRec} />
    </div>
  );
}
