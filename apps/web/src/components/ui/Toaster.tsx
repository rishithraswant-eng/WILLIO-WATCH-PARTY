'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { cx } from '@/lib/util';
import { useToasts, type Toast } from '@/store/toasts';
import { PixelIcon, type IconName } from './PixelIcon';

const KIND: Record<Toast['kind'], { icon: IconName; block: string; title: string }> = {
  info: { icon: 'chat', block: 'bg-sky/80', title: 'text-hi' },
  success: { icon: 'check', block: 'bg-ok/80', title: 'text-hi' },
  warn: { icon: 'warning', block: 'bg-warn/90', title: 'text-warn' },
  error: { icon: 'close', block: 'bg-danger/90', title: 'text-danger' },
  achievement: { icon: 'star', block: 'bg-lantern', title: 'text-lantern' },
};

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const reduce = useReducedMotion();
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(t.id), t.ttl);
    return () => window.clearTimeout(timer);
  }, [t.id, t.ttl, dismiss]);
  const k = KIND[t.kind];
  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="glass glass-strong pixel-corners pointer-events-auto flex w-[min(92vw,340px)] items-stretch gap-3 p-2.5"
      role={t.kind === 'error' ? 'alert' : 'status'}
    >
      {/* Minecraft achievement: icon block + title + subtitle */}
      <div className={cx('pixel-corners-sm flex h-10 w-10 shrink-0 items-center justify-center text-ink', k.block)}>
        {t.icon ? <span className="text-lg leading-none">{t.icon}</span> : <PixelIcon name={k.icon} size={18} />}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className={cx('font-label truncate text-[11px]', k.title)}>{t.kind === 'achievement' ? `Achievement: ${t.title}` : t.title}</p>
        {t.text ? <p className="line-clamp-2 text-xs text-mid">{t.text}</p> : null}
        {t.action ? (
          <button
            type="button"
            className="font-label mt-1 text-[10px] text-teal-400 underline-offset-2 hover:underline"
            onClick={() => {
              t.action!.run();
              dismiss(t.id);
            }}
          >
            {t.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="self-start p-1 text-lo hover:text-hi">
        <PixelIcon name="close" size={10} />
      </button>
    </motion.li>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <ol aria-live="polite" className="pointer-events-none fixed right-3 top-3 z-[90] flex flex-col items-end gap-2 sm:right-5 sm:top-5">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
