'use client';

import { memo, useId, type ReactNode } from 'react';
import { cx } from '@/lib/util';
import { avatarAccent, avatarGrid } from '@/lib/pixelArt';
import { PixelIcon } from './PixelIcon';

export function Chip({
  children,
  active,
  onClick,
  className,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? !!active : undefined}
      className={cx(
        'font-label pixel-corners-sm inline-flex items-center gap-1 px-2 py-1 text-[10px] transition-colors duration-150',
        active ? 'bg-teal-400/25 text-teal-400' : 'bg-white/[0.06] text-mid',
        onClick && 'hover:bg-white/10 hover:text-hi',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

const BADGE_TONE = {
  ok: 'bg-ok/20 text-ok',
  warn: 'bg-warn/20 text-warn',
  danger: 'bg-danger/20 text-danger',
  info: 'bg-sky/20 text-sky',
  lantern: 'bg-lantern/20 text-lantern',
  muted: 'bg-white/10 text-mid',
} as const;

export function Badge({ children, tone = 'muted', className }: { children: ReactNode; tone?: keyof typeof BADGE_TONE; className?: string }) {
  return (
    <span className={cx('font-label inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px]', BADGE_TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-mono inline-flex min-w-[1.6em] items-center justify-center border border-white/20 bg-white/10 px-1.5 text-[11px] text-hi shadow-[inset_0_-2px_0_rgba(0,0,0,0.35)]">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton-blocks pixel-corners-sm', className)} aria-hidden />;
}

/** Segmented XP-bar progress (Minecraft style). */
export function ProgressBar({ value, max = 100, segments = 20, label, className }: { value: number; max?: number; segments?: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const lit = Math.round(pct * segments);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      className={cx('flex h-3 gap-[2px] bg-black/40 p-[2px]', className)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <div key={i} className={cx('flex-1 transition-colors duration-200', i < lit ? 'bg-emerald shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]' : 'bg-white/5')} />
      ))}
    </div>
  );
}

/** Thin SVG arc gauge with a big number (ref 3). */
export function ArcGauge({
  value,
  max = 100,
  label,
  caption,
  suffix = '%',
  size = 160,
  tone = 'teal',
}: {
  value: number | null;
  max?: number;
  label: string;
  caption?: string;
  suffix?: string;
  size?: number;
  tone?: 'teal' | 'lantern';
}) {
  const id = useId();
  const r = 42;
  const circ = Math.PI * r * 1.5; // 270deg arc
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label}: ${value ?? 'no data'}${suffix}`}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor={tone === 'teal' ? 'rgb(var(--ice))' : 'rgb(var(--lantern))'} />
            <stop offset="100%" stopColor={tone === 'teal' ? 'rgb(var(--teal-400))' : 'rgb(var(--ember))'} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="5" strokeDasharray={`${circ} 999`} transform="rotate(135 50 50)" strokeLinecap="square" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={`url(#g${id})`}
          strokeWidth="5"
          strokeDasharray={`${circ * pct} 999`}
          transform="rotate(135 50 50)"
          strokeLinecap="square"
          style={{ transition: 'stroke-dasharray 400ms ease-out' }}
        />
        <text x="50" y="52" textAnchor="middle" className="fill-current font-mono" fontSize="20" fontWeight="600">
          {value == null ? '--' : Math.round(value)}
          <tspan fontSize="10">{value == null ? '' : suffix}</tspan>
        </text>
        <text x="50" y="68" textAnchor="middle" fontSize="6.5" className="font-label" fill="rgb(var(--text-mid))">
          {label.toUpperCase()}
        </text>
      </svg>
      {caption ? <p className="-mt-3 text-center text-xs text-mid">{caption}</p> : null}
    </div>
  );
}

export const Sparkline = memo(function Sparkline({
  values,
  width = 90,
  height = 24,
  limit = 500,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** symmetric y-range (ms) */
  limit?: number;
  className?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const max = Math.max(limit * 0.2, ...values.map((v) => Math.abs(v)));
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height / 2 - (Math.max(-max, Math.min(max, v)) / max) * (height / 2 - 1);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = values[values.length - 1] ?? 0;
  const color = Math.abs(last) < 100 ? 'rgb(var(--ok))' : Math.abs(last) < 500 ? 'rgb(var(--warn))' : 'rgb(var(--danger))';
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="rgb(255 255 255 / 0.15)" strokeDasharray="2 2" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
});

/** Rating out of 10 shown as 5 pixel hearts (half hearts supported). */
export function Hearts({ rating, className }: { rating: number; className?: string }) {
  const h = Math.round((rating / 10) * 10) / 2; // 0..5 in .5 steps
  return (
    <span className={cx('inline-flex items-center gap-[1px]', className)} role="img" aria-label={`Rated ${rating.toFixed(1)} out of 10`}>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = h >= i + 1 ? 1 : h >= i + 0.5 ? 0.5 : 0;
        return (
          <span key={i} className="relative inline-block h-[10px] w-[10px] text-white/15">
            <PixelIcon name="heart" size={10} />
            {fill > 0 ? (
              <span className="absolute inset-0 overflow-hidden text-danger" style={{ width: fill === 1 ? '100%' : '50%' }}>
                <PixelIcon name="heart" size={10} />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** 8x8 blocky avatar generated from a seed. */
export const Avatar = memo(function Avatar({
  seed,
  size = 32,
  name,
  online,
  className,
}: {
  seed: string;
  size?: number;
  name?: string;
  online?: boolean;
  className?: string;
}) {
  const grid = avatarGrid(seed);
  return (
    <span className={cx('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 8 8"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        role="img"
        aria-label={name ? `${name}'s avatar` : 'avatar'}
        style={{ outline: `2px solid ${avatarAccent(seed)}`, outlineOffset: -1 }}
      >
        {grid.pixels.map((p) => (
          <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.c} />
        ))}
      </svg>
      {online !== undefined ? (
        <span
          className={cx('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border border-black/60', online ? 'bg-ok' : 'bg-lo')}
          aria-label={online ? 'online' : 'reconnecting'}
        />
      ) : null}
    </span>
  );
});

export function Tooltip({ label, children, side = 'top' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap bg-bg-0/95 px-2 py-1 text-[11px] text-hi opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {label}
        <span
          className={cx(
            'absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 bg-bg-0/95',
            side === 'top' ? '-bottom-1.5' : '-top-1.5',
          )}
        />
      </span>
    </span>
  );
}
