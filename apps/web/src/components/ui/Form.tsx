'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from '@/lib/util';
import { PixelIcon, type IconName } from './PixelIcon';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: IconName;
  hint?: string;
  error?: string | null;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, icon, hint, error, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={inputId} className="font-label text-[10px] text-mid">
          {label}
        </label>
      ) : null}
      <div className="glass glass-sm pixel-corners-sm flex items-center gap-2 px-3 focus-within:ring-2 focus-within:ring-lantern/80">
        {icon ? <PixelIcon name={icon} size={14} className="text-mid" /> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${inputId}-hint` : undefined}
          className="pixel-caret h-10 w-full bg-transparent text-sm text-hi placeholder:text-lo focus:outline-none"
          {...rest}
        />
      </div>
      {error || hint ? (
        <p id={`${inputId}-hint`} className={cx('text-xs', error ? 'text-danger' : 'text-lo')}>
          {error || hint}
        </p>
      ) : null}
    </div>
  );
});

export function Select({
  label,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={id} className="font-label text-[10px] text-mid">
          {label}
        </label>
      ) : null}
      <select
        id={id}
        className="glass glass-sm pixel-corners-sm h-10 cursor-pointer bg-transparent px-3 text-sm text-hi focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern/80 [&>option]:bg-bg-1 [&>option]:text-hi"
        {...rest}
      >
        {children}
      </select>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-hi">
          {label}
        </label>
        {description ? <p className="text-xs text-lo">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 border transition-colors duration-150 disabled:opacity-40',
          checked ? 'border-teal-400 bg-teal-400/35' : 'border-white/25 bg-white/10',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-4 w-4 transition-[left,background] duration-150 ease-out',
            checked ? 'left-[22px] bg-teal-400' : 'left-[3px] bg-white/70',
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  className?: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="font-label text-[10px] text-mid">
          {label}
        </label>
        <span className="font-mono text-xs text-hi">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none bg-white/10 accent-teal-400"
        style={{ background: `linear-gradient(90deg, rgb(var(--teal-400)) ${pct}%, rgb(255 255 255 / 0.1) ${pct}%)` }}
      />
    </div>
  );
}
