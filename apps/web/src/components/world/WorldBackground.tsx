'use client';

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SCENE_H, SCENE_W, farLayer, frontLayer, midLayer, waterLayer, type Rect } from './swampArt';
import { Fireflies } from './Fireflies';

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const Layer = memo(function Layer({ rects, depth, children }: { rects: Rect[]; depth: number; children?: ReactNode }) {
  return (
    <svg
      className="world-layer absolute inset-[-24px] h-[calc(100%+48px)] w-[calc(100%+48px)]"
      style={{ ['--depth' as string]: depth }}
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      preserveAspectRatio="xMidYMax slice"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {children}
      {rects.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
});

/**
 * Fixed world behind everything (z-index -1): voxel swamp (4 parallax layers), volumetric
 * light rays, firefly canvas, vignette + noise. Rendered client-side only to keep SSR HTML small.
 */
export function WorldBackground() {
  const root = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const layers = useMemo(() => (mounted ? { far: farLayer(), mid: midLayer(), water: waterLayer(), front: frontLayer() } : null), [mounted]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          el.style.setProperty('--px', tx.toFixed(3));
          el.style.setProperty('--py', ty.toFixed(3));
        });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={root} className="world pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #03100d 0%, #072620 45%, #0c3a33 75%, #04100e 100%)' }} />
      {layers ? (
        <div className="world-scene absolute inset-0">
          <Layer rects={layers.far} depth={2}>
            <defs>
              <radialGradient id="moonGlow">
                <stop offset="0%" stopColor="#9fe8ff" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#9fe8ff" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="38" cy="16" r="16" fill="url(#moonGlow)" />
            <rect x="34" y="12" width="8" height="8" fill="#d8f6ff" />
            <rect x="35" y="13" width="2" height="2" fill="#b8e2ef" />
          </Layer>
          <Layer rects={layers.mid} depth={5} />
          <Layer rects={layers.water} depth={8} />
          <Layer rects={layers.front.rects} depth={12}>
            <defs>
              <radialGradient id="lanternGlow">
                <stop offset="0%" stopColor="#ffcf5c" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#ffcf5c" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle className="lantern-glow" cx={layers.front.lantern.x} cy={layers.front.lantern.y} r="22" fill="url(#lanternGlow)" />
          </Layer>
        </div>
      ) : null}
      {/* Layer B: volumetric light rays */}
      <div className="world-rays absolute inset-0">
        {[
          { left: '12%', w: 120, d: 0 },
          { left: '30%', w: 70, d: 2.5 },
          { left: '52%', w: 160, d: 1.2 },
          { left: '74%', w: 90, d: 3.4 },
        ].map((r, i) => (
          <span
            key={i}
            className="world-ray absolute -top-[10%] h-[85%]"
            style={{ left: r.left, width: r.w, animationDelay: `${r.d}s` }}
          />
        ))}
      </div>
      {/* Layer C: fireflies */}
      {mounted ? <Fireflies /> : null}
      {/* Layer D: mist (light theme), vignette, noise */}
      <div className="absolute inset-0" style={{ background: 'var(--world-mist)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0,0,0,0.6) 100%)' }} />
      <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
    </div>
  );
}
