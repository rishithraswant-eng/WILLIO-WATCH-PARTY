'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cx } from '@/lib/util';
import { PixelIcon, type IconName } from './PixelIcon';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  badge?: number;
}

/** Accessible tabs (arrow-key roving) with a pixel-block underline. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
  className,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(tabs[next]!.id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="tablist" aria-orientation="horizontal" className={cx('flex items-stretch gap-0.5 overflow-x-auto scroll-thin', className)}>
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'font-label relative flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 pb-2.5 pt-2 text-[10px] transition-colors duration-150',
              active ? 'text-teal-400' : 'text-mid hover:text-hi',
            )}
          >
            {t.icon ? <PixelIcon name={t.icon} size={12} /> : null}
            <span className="truncate">{t.label}</span>
            {t.badge ? (
              <span className="font-mono min-w-[16px] bg-lantern px-1 text-[9px] leading-4 text-ink">{t.badge > 99 ? '99+' : t.badge}</span>
            ) : null}
            <span
              aria-hidden
              className={cx(
                'absolute bottom-0 left-2 right-2 h-1 transition-opacity duration-150',
                active ? 'opacity-100' : 'opacity-0',
              )}
              style={{ background: 'repeating-linear-gradient(90deg, rgb(var(--teal-400)) 0 4px, transparent 4px 6px)' }}
            />
          </button>
        );
      })}
    </div>
  );
}
