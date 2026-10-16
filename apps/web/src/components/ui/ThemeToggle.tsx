'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { writeJSON } from '@/lib/storage';

export type Theme = 'dark' | 'light';

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  writeJSON('bp:theme', t);
}

/** Inline script that sets the theme before first paint (no flash); respects prefers-color-scheme. */
export const THEME_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem('bp:theme')||'null');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})();`;

/** Glass sun/moon pill (ref 2): smoky pill, bloom under the knob, spring knob, morphing icon. */
export function ThemeToggle() {
  const [theme, setT] = useState<Theme>('dark');
  const reduce = useReducedMotion();
  useEffect(() => setT(currentTheme()), []);
  const dark = theme === 'dark';
  const toggle = () => {
    const next: Theme = dark ? 'light' : 'dark';
    setTheme(next);
    setT(next);
  };
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 32 };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!dark}
      aria-label={dark ? 'Switch to Misty Dawn (light) theme' : 'Switch to Swamp Night (dark) theme'}
      title={dark ? 'Misty Dawn' : 'Swamp Night'}
      onClick={toggle}
      className="relative h-9 w-[68px] shrink-0 overflow-hidden rounded-full border border-white/25 bg-black/35 shadow-[inset_0_2px_6px_rgba(0,0,0,0.5),inset_0_-1px_0_rgba(255,255,255,0.15)] backdrop-blur-md"
    >
      <motion.span
        aria-hidden
        className="absolute top-1/2 h-14 w-14 -translate-y-1/2 rounded-full"
        animate={{ left: dark ? -10 : 22 }}
        transition={spring}
        style={{
          background: dark
            ? 'radial-gradient(circle, rgb(var(--ice) / 0.45), transparent 65%)'
            : 'radial-gradient(circle, rgb(var(--lantern) / 0.7), transparent 65%)',
        }}
      />
      <motion.span
        aria-hidden
        className="absolute top-[3px] flex h-[28px] w-[28px] items-center justify-center rounded-full border border-white/50 bg-gradient-to-br from-white/40 to-white/5 shadow-[0_2px_8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.7)]"
        animate={{ left: dark ? 3 : 35 }}
        transition={spring}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <motion.g
            initial={false}
            animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.3 : 1, rotate: dark ? -90 : 0 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
            style={{ transformOrigin: '10px 10px' }}
            fill="rgb(var(--lantern))"
          >
            <circle cx="10" cy="10" r="4" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <rect key={a} x="9" y="0.5" width="2" height="3" transform={`rotate(${a} 10 10)`} />
            ))}
          </motion.g>
          <motion.path
            initial={false}
            d="M12.5 2.5a7.5 7.5 0 1 0 5 13.1A6.3 6.3 0 0 1 12.5 2.5z"
            fill="rgb(var(--ice))"
            animate={{ opacity: dark ? 1 : 0, scale: dark ? 1 : 0.3, rotate: dark ? 0 : 90 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
            style={{ transformOrigin: '10px 10px' }}
          />
        </svg>
      </motion.span>
    </button>
  );
}
