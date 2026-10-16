'use client';

import { useEffect, useRef } from 'react';

interface Fly {
  x: number;
  y: number;
  phase: number;
  speed: number;
  amp: number;
  size: number;
  hue: 'lantern' | 'teal';
}

/**
 * 40-80 square pixel fireflies on a half-resolution canvas (upscaled with pixelated rendering).
 * Capped at 30fps, paused while the tab is hidden, static 15 when reduced motion is requested.
 */
export function Fireflies() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const SCALE = 2;
    let flies: Fly[] = [];
    let w = 0;
    let h = 0;

    const resize = () => {
      w = Math.ceil(window.innerWidth / SCALE);
      h = Math.ceil(window.innerHeight / SCALE);
      el.width = w;
      el.height = h;
      const count = reduce ? 15 : Math.round(Math.min(80, Math.max(40, (window.innerWidth * window.innerHeight) / 26000)));
      flies = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: h * 0.25 + Math.random() * h * 0.7,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.5,
        amp: 4 + Math.random() * 10,
        size: Math.random() < 0.3 ? 2 : 1,
        hue: Math.random() < 0.65 ? 'lantern' : 'teal',
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const f of flies) {
        const tt = t / 1000;
        const x = f.x + Math.sin(tt * f.speed + f.phase) * f.amp;
        const y = f.y + Math.cos(tt * f.speed * 0.7 + f.phase) * f.amp * 0.6;
        const pulse = reduce ? 0.8 : 0.45 + 0.55 * Math.abs(Math.sin(tt * (0.8 + f.speed) + f.phase));
        const core = f.hue === 'lantern' ? `rgba(255,207,92,${pulse})` : `rgba(46,230,197,${pulse})`;
        const glow = f.hue === 'lantern' ? `rgba(255,207,92,${pulse * 0.18})` : `rgba(46,230,197,${pulse * 0.18})`;
        const px = Math.round(x);
        const py = Math.round(y);
        ctx.fillStyle = glow;
        ctx.fillRect(px - 2, py - 2, f.size + 4, f.size + 4);
        ctx.fillStyle = core;
        ctx.fillRect(px, py, f.size, f.size);
      }
    };

    resize();
    window.addEventListener('resize', resize);
    if (reduce) {
      draw(0);
      return () => window.removeEventListener('resize', resize);
    }
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || t - last < 1000 / 30) return;
      last = t;
      draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvas} className="pixelated absolute inset-0 h-full w-full mix-blend-screen" aria-hidden />;
}
