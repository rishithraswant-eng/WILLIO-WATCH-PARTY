'use client';

import { memo, useState } from 'react';
import { posterGrid } from '@/lib/pixelArt';
import { cx } from '@/lib/util';

/**
 * Poster art: real artwork (TMDB) shown pixelated until hover, otherwise deterministic
 * generated pixel art (24x36) with the title set in the pixel font.
 */
export const PixelPoster = memo(function PixelPoster({
  id,
  genres,
  title,
  posterUrl,
  compact,
  className,
}: {
  id: string;
  genres: string[];
  title: string;
  posterUrl: string | null;
  compact?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (posterUrl && !broken) {
    return (
      <div className={cx('group/poster relative h-full w-full overflow-hidden bg-black', className)}>
        {/* tiny copy upscaled = pixel look; full copy fades in on hover */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt=""
          aria-hidden
          loading="lazy"
          className="pixelated absolute left-0 top-0 h-[12.5%] w-[12.5%] origin-top-left scale-[8]"
          onError={() => setBroken(true)}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt={`${title} poster`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-200 group-hover/poster:opacity-100"
        />
      </div>
    );
  }
  const g = posterGrid(id, genres);
  return (
    <div className={cx('relative h-full w-full overflow-hidden', className)} style={{ background: `linear-gradient(180deg, ${g.bg[1]}, ${g.bg[0]})` }}>
      <svg viewBox="0 0 24 36" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" shapeRendering="crispEdges" aria-hidden>
        {g.pixels.map((p, i) => (
          <rect key={i} x={p.x} y={p.y} width={1} height={1} fill={p.c} />
        ))}
      </svg>
      {!compact ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
          <p className="font-pixel line-clamp-3 text-[8px] leading-[1.6] text-white [text-shadow:1px_1px_0_#000]">{title.toUpperCase()}</p>
        </div>
      ) : null}
    </div>
  );
});
