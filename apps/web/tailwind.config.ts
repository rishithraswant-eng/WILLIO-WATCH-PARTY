import type { Config } from 'tailwindcss';

/** Colours are RGB triplets in tokens.css so Tailwind opacity modifiers work (bg-teal-400/20). */
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: { 0: c('--bg-0'), 1: c('--bg-1'), 2: c('--bg-2') },
        teal: { 400: c('--teal-400'), 500: c('--teal-500') },
        emerald: c('--emerald'),
        moss: c('--moss'),
        lantern: c('--lantern'),
        ember: c('--ember'),
        wood: c('--wood'),
        ice: c('--ice'),
        sky: c('--sky'),
        hi: c('--text-hi'),
        mid: c('--text-mid'),
        lo: c('--text-lo'),
        danger: c('--danger'),
        warn: c('--warn'),
        ok: c('--ok'),
        ink: c('--ink'),
      },
      fontFamily: {
        pixel: ['var(--font-press)', 'monospace'],
        silk: ['var(--font-silk)', 'monospace'],
        heading: ['var(--font-pixelify)', 'var(--font-plex)', 'sans-serif'],
        sans: ['var(--font-plex)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgb(var(--teal-400) / 0.45)',
        lantern: '0 0 28px rgb(var(--lantern) / 0.5)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'pixel-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        blink: { '50%': { opacity: '0' } },
        bob: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'pixel-in': 'pixel-in 220ms steps(4) both',
        shimmer: 'shimmer 1.6s linear infinite',
        blink: 'blink 1s steps(1) infinite',
        bob: 'bob 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
