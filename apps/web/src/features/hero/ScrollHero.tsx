'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, type CSSProperties } from 'react';
import { DEMO_ROOM_CODE } from '@willio/shared';
import { GlassButton } from '@/components/ui/Glass';
import { PixelIcon } from '@/components/ui/PixelIcon';
import {
  coverPositionCss,
  frameUrl,
  HERO,
  HERO_MANIFEST,
  MOBILE_MEDIA,
  type BeatId,
  type ScrollSequence,
} from './scrollSequence';

const ALT =
  'A panda sits in a glowing voxel swamp and holds up a phone; the camera dives into its map and the Willio W lights up.';
const RING = 2 * Math.PI * 15;
/** Height of the fixed home header; anchors scroll below it. */
const HEADER_OFFSET = -68;

const posterVars = {
  '--hero-vh': HERO.scrollVh,
  '--poster-pos': coverPositionCss('desktop', 0),
  '--poster-pos-reduced': coverPositionCss('desktop', HERO.posterFrame),
  '--hero-placeholder': `url("${HERO_MANIFEST.placeholder}")`,
  '--hero-edge': HERO_MANIFEST.edge.first,
} as CSSProperties;

/**
 * Pinned, scroll-scrubbed intro (image sequence on a canvas). Renders once: the engine
 * (scrollSequence.ts) drives the canvas and the text beats imperatively through refs.
 */
export function ScrollHero() {
  const router = useRouter();
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const poster = useRef<HTMLImageElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const beats = useRef<Partial<Record<BeatId, HTMLElement>>>({});
  const engine = useRef<ScrollSequence | null>(null);

  useEffect(() => {
    const els = {
      section: section.current,
      stage: stage.current,
      frame: frame.current,
      canvas: canvas.current,
    };
    if (!els.section || !els.stage || !els.frame || !els.canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let seq: ScrollSequence | null = null;
    let cancelled = false;
    const root = els.section;
    root.dataset.state = 'loading';
    void import('./scrollSequence').then(({ ScrollSequence }) => {
      if (cancelled) return;
      try {
        seq = new ScrollSequence(
          {
            section: els.section!,
            stage: els.stage!,
            frame: els.frame!,
            canvas: els.canvas!,
            poster: poster.current,
            hint: hint.current,
            beats: beats.current,
          },
          {
            onLoadProgress: (f) =>
              ring.current?.style.setProperty('stroke-dashoffset', String(RING * (1 - f))),
            onReady: () => (root.dataset.state = 'ready'),
          },
        );
      } catch {
        root.dataset.state = 'ready'; // no 2d canvas: the poster stays up and the page scrolls normally
        return;
      }
      engine.current = seq;
      if (new URLSearchParams(window.location.search).has('hero-debug'))
        (window as unknown as { __hero: ScrollSequence }).__hero = seq;
      void seq.start();
    });
    return () => {
      cancelled = true;
      seq?.destroy();
      engine.current = null;
    };
  }, []);

  const beat = (id: BeatId) => (node: HTMLElement | null) => {
    if (node) beats.current[id] = node;
    else delete beats.current[id];
  };

  const startParty = () => {
    const main = document.getElementById('main');
    if (!main) return;
    if (engine.current) engine.current.scrollTo(main, HEADER_OFFSET);
    else main.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section ref={section} className="hero" data-theme="dark" aria-label="Willio intro" style={posterVars}>
      {/* Frame 1 is the LCP image: preloaded per frame set, painted before any JS runs. */}
      <link rel="preload" as="image" href={frameUrl('mobile', 0)} media={MOBILE_MEDIA} fetchPriority="high" />
      <link
        rel="preload"
        as="image"
        href={frameUrl('desktop', 0)}
        media={`not all and ${MOBILE_MEDIA}`}
        fetchPriority="high"
      />
      <div ref={stage} className="hero-stage">
        <div ref={frame} className="hero-frame">
          <picture>
            <source
              media={`(prefers-reduced-motion: reduce) and ${MOBILE_MEDIA}`}
              srcSet={frameUrl('mobile', HERO.posterFrame)}
            />
            <source media="(prefers-reduced-motion: reduce)" srcSet={frameUrl('desktop', HERO.posterFrame)} />
            <source media={MOBILE_MEDIA} srcSet={frameUrl('mobile', 0)} />
            {/* eslint-disable-next-line @next/next/no-img-element -- exact pixel match with the canvas; next/image would re-encode */}
            <img
              ref={poster}
              className="hero-poster"
              src={frameUrl('desktop', 0)}
              alt={ALT}
              width={HERO_MANIFEST.sets.desktop.width}
              height={HERO_MANIFEST.sets.desktop.height}
              fetchPriority="high"
              decoding="async"
              {...{ elementtiming: 'hero-frame-1' }}
            />
          </picture>
          <canvas ref={canvas} className="hero-canvas" role="img" aria-label={ALT} />
        </div>
        <div className="hero-shade" aria-hidden />

        <div className="hero-copy">
          <div className="hero-slot hero-slot-side">
            <div ref={beat('intro')} className="hero-beat" data-beat="intro">
              <span className="font-pixel hero-eyebrow inline-block w-fit px-2 py-1 text-[9px] text-teal-400">
                REAL-TIME WATCH PARTIES
              </span>
              <h2 className="font-heading hero-title mt-4 text-4xl font-semibold leading-[1.05] text-hi sm:text-6xl">
                Movie night,
                <br />
                together.
              </h2>
              <p className="hero-sub mt-4 max-w-md text-base text-mid sm:text-lg">
                Even when your friends are miles apart. Willio keeps every screen on the same frame.
              </p>
              <div className="hero-reduced-only mt-6 flex flex-wrap gap-3">
                <GlassButton variant="primary" size="lg" icon="play" onClick={startParty}>
                  Start a watch party
                </GlassButton>
                <GlassButton
                  variant="secondary"
                  size="lg"
                  onClick={() => router.push(`/r/${DEMO_ROOM_CODE}`)}
                >
                  Try the demo room
                </GlassButton>
              </div>
            </div>
          </div>

          <div className="hero-slot hero-slot-side">
            <div ref={beat('play')} className="hero-beat" data-beat="play">
              <h2 className="font-heading hero-title text-3xl font-semibold leading-[1.1] text-hi sm:text-5xl">
                Press play once.
              </h2>
              <p className="hero-sub mt-3 max-w-md text-base text-mid sm:text-lg">
                One server clock schedules every play, pause and seek - everyone lands within a few
                milliseconds.
              </p>
            </div>
          </div>

          <div className="hero-slot hero-slot-center">
            <div ref={beat('social')} className="hero-beat" data-beat="social">
              <h2 className="font-heading hero-title text-3xl font-semibold leading-[1.1] text-hi sm:text-5xl">
                Chat. React. Vote.
              </h2>
              <p className="hero-sub mx-auto mt-3 max-w-md text-base text-mid sm:text-lg">
                A shared queue, live polls and reactions that hit every screen at once.
              </p>
            </div>
          </div>

          <div className="hero-slot hero-slot-bottom">
            <div ref={beat('brand')} className="hero-beat" data-beat="brand">
              <h2 className="font-heading hero-title text-3xl font-semibold leading-[1.1] text-hi sm:text-5xl">
                Welcome to Willio.
              </h2>
              <p className="hero-sub mt-2 text-base text-mid sm:text-lg">Same world. Same frame.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <GlassButton variant="primary" size="lg" icon="play" onClick={startParty}>
                  Start a watch party
                </GlassButton>
                <GlassButton
                  variant="secondary"
                  size="lg"
                  onClick={() => router.push(`/r/${DEMO_ROOM_CODE}`)}
                >
                  Try the demo room
                </GlassButton>
              </div>
            </div>
          </div>
        </div>

        <div ref={hint} className="hero-hint" aria-hidden>
          <svg className="hero-ring" width="36" height="36" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" className="hero-ring-track" />
            <circle
              ref={ring}
              cx="18"
              cy="18"
              r="15"
              className="hero-ring-bar"
              strokeDasharray={RING}
              strokeDashoffset={RING}
            />
          </svg>
          <span className="hero-hint-scroll font-label text-[10px] text-mid">
            Scroll
            <PixelIcon name="up" size={12} className="hero-hint-arrow" />
          </span>
        </div>
      </div>
      <div id="hero-end" className="hero-end" aria-hidden />
    </section>
  );
}
