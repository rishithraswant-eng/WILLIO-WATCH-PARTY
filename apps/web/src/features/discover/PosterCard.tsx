'use client';

import { memo, type ReactNode } from 'react';
import type { Movie } from '@willio/shared';
import { Hearts } from '@/components/ui/Bits';
import { cx } from '@/lib/util';
import { PixelPoster } from './PixelPoster';

export function Highlight({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  [...ranges]
    .sort((a, b) => a[0] - b[0])
    .forEach(([a, b], i) => {
      if (a < last) return;
      if (a > last) out.push(text.slice(last, a));
      out.push(
        <mark key={i} className="bg-lantern/35 text-hi">
          {text.slice(a, b + 1)}
        </mark>,
      );
      last = b + 1;
    });
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export const PosterCard = memo(function PosterCard({
  movie,
  ranges,
  onOpen,
  actions,
  compat,
  active,
  id,
}: {
  movie: Movie;
  ranges?: [number, number][];
  onOpen: (m: Movie) => void;
  actions?: ReactNode;
  compat?: number | null;
  active?: boolean;
  id?: string;
}) {
  const runtime = movie.runtimeMin >= 60 ? `${Math.floor(movie.runtimeMin / 60)}h${String(movie.runtimeMin % 60).padStart(2, '0')}` : `${movie.runtimeMin}m`;
  return (
    <article
      id={id}
      className={cx(
        'glass glass-sm glass-spot pixel-corners group flex w-full flex-col overflow-hidden transition-transform duration-200 ease-out hover:-translate-y-1',
        active && 'ring-2 ring-lantern',
      )}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
      }}
    >
      <button type="button" onClick={() => onOpen(movie)} className="relative block aspect-[2/3] w-full text-left" aria-label={`${movie.title} (${movie.year}) - details`}>
        <PixelPoster id={movie.id} genres={movie.genres} title={movie.title} posterUrl={movie.posterUrl} />
        {movie.isFree ? <span className="font-pixel absolute left-1.5 top-1.5 bg-emerald px-1.5 py-1 text-[7px] text-ink">FREE</span> : null}
        {compat != null ? (
          <span className="font-mono absolute right-1.5 top-1.5 bg-black/70 px-1.5 py-0.5 text-[10px] text-lantern">{compat}% match</span>
        ) : null}
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-hi">
          <Highlight text={movie.title} ranges={ranges} />
        </h3>
        <div className="flex items-center justify-between gap-1">
          <Hearts rating={movie.rating} />
          <span className="font-mono text-[10px] text-mid">
            {movie.year} - {runtime}
          </span>
        </div>
        <p className="line-clamp-1 text-[11px] text-lo">{movie.genres.join(' / ')}</p>
        {actions ? <div className="mt-auto flex flex-wrap gap-1 pt-1">{actions}</div> : null}
      </div>
    </article>
  );
});
