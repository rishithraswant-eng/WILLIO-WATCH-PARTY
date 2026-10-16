'use client';

import { forwardRef, useCallback, type ButtonHTMLAttributes, type HTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import { cx } from '@/lib/util';
import { PixelIcon, type IconName } from './PixelIcon';

/** Sets --mx/--my for the cursor-following spotlight. */
function useSpotlight<T extends HTMLElement>() {
  return useCallback((e: PointerEvent<T>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);
}

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  pixel?: boolean;
  spotlight?: boolean;
  strong?: boolean;
  blur?: 'sm' | 'md' | 'lg';
  as?: 'div' | 'section' | 'aside' | 'header' | 'article' | 'nav';
}

export const GlassPanel = forwardRef<HTMLDivElement, PanelProps>(function GlassPanel(
  { pixel = true, spotlight = false, strong = false, blur = 'md', as = 'div', className, onPointerMove, children, ...rest },
  ref,
) {
  const spot = useSpotlight<HTMLDivElement>();
  const Tag = as as 'div';
  return (
    <Tag
      ref={ref}
      className={cx(
        'glass',
        blur === 'sm' && 'glass-sm',
        blur === 'lg' && 'glass-lg',
        strong && 'glass-strong',
        pixel && 'pixel-corners',
        spotlight && 'glass-spot',
        className,
      )}
      onPointerMove={(e) => {
        if (spotlight) spot(e);
        onPointerMove?.(e);
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
});

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'pill' | 'lantern';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-teal-500/90 text-ink hover:bg-teal-400 shadow-glow border border-teal-400/80 [text-shadow:none]',
  secondary: 'glass glass-sm text-hi hover:bg-white/10',
  danger: 'bg-danger/85 text-white hover:bg-danger border border-danger',
  ghost: 'text-mid hover:text-hi hover:bg-white/5',
  pill: 'glass glass-sm rounded-full text-hi hover:bg-white/10',
  lantern: 'bg-lantern/90 text-ink hover:bg-lantern shadow-lantern border border-lantern',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-[11px] gap-1.5',
  md: 'h-10 px-4 text-xs gap-2',
  lg: 'h-12 px-6 text-sm gap-2.5',
};

export const GlassButton = forwardRef<HTMLButtonElement, ButtonProps>(function GlassButton(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'font-label inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap transition-[background,transform,box-shadow,color] duration-150 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45',
        variant !== 'pill' && 'pixel-corners-sm',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-3 w-3 animate-pulse bg-current" aria-hidden />
      ) : icon ? (
        <PixelIcon name={icon} size={size === 'lg' ? 16 : 14} />
      ) : null}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  tone?: 'default' | 'lantern' | 'danger' | 'teal';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active, tone = 'default', className, type = 'button', ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cx(
        'glass glass-sm pixel-corners-sm inline-flex shrink-0 items-center justify-center transition-colors duration-150 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40',
        dim,
        active && 'bg-teal-400/20 text-teal-400',
        tone === 'lantern' && 'text-lantern',
        tone === 'danger' && 'text-danger',
        tone === 'teal' && 'text-teal-400',
        className,
      )}
      {...rest}
    >
      <PixelIcon name={icon} size={size === 'lg' ? 20 : size === 'sm' ? 14 : 16} />
    </button>
  );
});
