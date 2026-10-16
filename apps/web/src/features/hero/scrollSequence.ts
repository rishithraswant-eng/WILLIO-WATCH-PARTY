import type Lenis from 'lenis';
import manifest from '../../../public/hero-frames/manifest.json';

/**
 * Every tunable of the scroll-driven hero. Frames come from `npm run frames` (scripts/extract-frames.sh),
 * which also owns the subject focal track (it is baked into the mobile crop) and writes manifest.json.
 */
export const HERO = {
  /** Height of the hero section in viewport heights. 500 = 400vh of pinned scrubbing for 10s of footage. */
  scrollVh: 500,
  /** Playhead damping rate K (1/s): current += (target - current) * (1 - exp(-dt * K)). */
  damping: 12,
  /** Upper bound for the rAF delta (s), so a tab switch or long task never causes a jump. */
  maxDt: 1 / 20,
  /** Below this progress difference the playhead snaps onto the target and the loop can sleep. */
  settle: 0.00002,
  /** After this long without scroll input the playhead glides onto the nearest whole frame, so a resting
   *  hero never shows a half-blended (ghosted) image. */
  restSnapMs: 140,
  /** Redraw only when the playhead moved by more than this many frames. */
  redrawFrames: 0.003,
  /** Decoded full-res frames kept around the playhead, in the direction of travel / behind it. */
  cacheAhead: 36,
  cacheBehind: 18,
  /** Concurrent createImageBitmap() calls (they run off the main thread). */
  maxDecodes: 4,
  /** Concurrent frame downloads. */
  fetchConcurrency: 6,
  /** Every Nth frame is fetched first (after frame 1) so scrubbing works before everything arrived. */
  sparseStride: 8,
  /** Every Nth frame also keeps a small always-resident proxy, drawn during violent flicks. */
  proxyStride: 4,
  proxyScale: 0.3,
  /** The mobile (portrait crop) set is used on portrait viewports up to this width, or with Save-Data. */
  mobileMaxWidth: 768,
  mobileMaxAspect: '7/10',
  /** Mobile set only, [frame, zoom]: <1 zooms out of the cover crop (letterboxed in black). Lets the wide
   *  W logo fit a portrait screen; the change happens during the black frames, so it is invisible. */
  mobileZoom: [
    [0, 1],
    [176, 1],
    [184, 0.78],
    [239, 0.78],
  ],
  /** Canvas backing store = CSS size x min(devicePixelRatio, dprCap). */
  dprCap: 2,
  resizeDebounceMs: 120,
  /** Scroll stays locked until frame 1 + the sparse pass are ready, but never longer than this. */
  loadTimeoutMs: 4500,
  /** Static frame (0-based) for prefers-reduced-motion: the panda holding the glowing phone. */
  posterFrame: 124,
  /** Progress range over which the canvas fades out, revealing the page background underneath. */
  fadeOut: [0.93, 1] as const,
  /** Progress range over which the scroll hint fades out. */
  hint: [0.004, 0.035] as const,
  /** Text beats: [fade-in start, fade-in end, fade-out start, fade-out end] in progress (0..1). */
  beats: {
    intro: [-1, 0, 0.09, 0.14],
    play: [0.17, 0.22, 0.36, 0.42],
    social: [0.635, 0.67, 0.72, 0.755],
    brand: [0.83, 0.87, 0.935, 0.985],
  },
  /** Beats rise by this many px while fading in and leave upwards by the same amount. */
  beatShiftPx: 28,
  /** Inertial wheel smoothing. Touch stays native (smoother with iOS momentum); the damped playhead smooths it. */
  lenis: { lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1, syncTouch: false },
} as const;

export type BeatId = keyof typeof HERO.beats;
export type FrameSet = 'desktop' | 'mobile';
type Range = readonly [number, number, number, number];
type Frame = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export const HERO_MANIFEST = manifest;
export const FRAME_COUNT = manifest.frameCount;
export const MOBILE_MEDIA = `(max-width: ${HERO.mobileMaxWidth}px) and (max-aspect-ratio: ${HERO.mobileMaxAspect})`;

export function frameUrl(set: FrameSet, index: number): string {
  return `/hero-frames/${set}/f_${String(index + 1).padStart(4, '0')}.${manifest.ext}?v=${manifest.version}`;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => v * v * (3 - 2 * v);

/** Value of a [frame, value] keyframe track at a fractional frame position, smoothstep between keyframes. */
function track(k: readonly (readonly [number, number])[], pos: number): number {
  if (pos <= k[0]![0]) return k[0]![1];
  for (let i = 0; i < k.length - 1; i++) {
    const [n0, a] = k[i]!;
    const [n1, b] = k[i + 1]!;
    if (pos <= n1) return a + (b - a) * smooth(clamp01((pos - n0) / Math.max(1, n1 - n0)));
  }
  return k[k.length - 1]![1];
}

/** Subject centre (0..1 of the frame width); the mobile set already has it baked into its crop. */
export function focalAt(set: FrameSet, pos: number): number {
  return set === 'mobile' ? 0.5 : track(manifest.focal as [number, number][], pos);
}

function zoomAt(set: FrameSet, pos: number): number {
  return set === 'mobile' ? track(HERO.mobileZoom, pos) : 1;
}

/**
 * CSS object-position that reproduces the canvas cover-crop (subject centred, clamped to the frame edges)
 * for any box size, using container query units of the frame box.
 */
export function coverPositionCss(set: FrameSet, frame: number): string {
  const w = manifest.sets[set].width / manifest.sets[set].height;
  const rendered = `max(100cqw, ${(100 * w).toFixed(3)}cqh)`;
  return `clamp(calc(100cqw - ${rendered}), calc(50cqw - ${focalAt(set, frame).toFixed(4)} * ${rendered}), 0px) 50%`;
}

/** Opacity (0..1, eased) of a beat at a progress value. */
export function beatOpacity(r: Range, p: number): number {
  const fadeIn = r[1] <= r[0] ? 1 : clamp01((p - r[0]) / (r[1] - r[0]));
  const fadeOut = r[3] <= r[2] ? 1 : clamp01((r[3] - p) / (r[3] - r[2]));
  return smooth(Math.min(fadeIn, fadeOut));
}

export function pickFrameSet(): FrameSet {
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (window.matchMedia(MOBILE_MEDIA).matches) return 'mobile';
  return saveData && window.matchMedia(`(max-aspect-ratio: ${HERO.mobileMaxAspect})`).matches
    ? 'mobile'
    : 'desktop';
}

function release(f: Frame | null | undefined) {
  if (f && 'close' in f) f.close();
}

function frameWidth(f: Frame) {
  return f instanceof HTMLImageElement ? f.naturalWidth : f.width;
}

function frameHeight(f: Frame) {
  return f instanceof HTMLImageElement ? f.naturalHeight : f.height;
}

/** Off-main-thread decode via createImageBitmap, falling back to HTMLImageElement.decode(). */
async function decodeBlob(blob: Blob, resizeWidth?: number): Promise<Frame> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await (resizeWidth
        ? createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })
        : createImageBitmap(blob));
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Resolves once the page has loaded and its largest paint has settled (no new LCP entry for a moment, e.g.
 * after the web-font swap), then on the next idle moment. Bulk frame downloads start only after that.
 */
function afterPageLoad(): Promise<void> {
  const loaded = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });
  const settled = new Promise<void>((resolve) => {
    const QUIET_MS = 600;
    let quiet = window.setTimeout(resolve, QUIET_MS);
    const cap = window.setTimeout(resolve, 3000);
    try {
      const obs = new PerformanceObserver(() => {
        window.clearTimeout(quiet);
        quiet = window.setTimeout(() => {
          obs.disconnect();
          window.clearTimeout(cap);
          resolve();
        }, QUIET_MS);
      });
      obs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // no LCP API (Safari): the plain quiet period applies
    }
  });
  return Promise.all([loaded, document.fonts?.ready, settled]).then(
    () =>
      new Promise<void>((resolve) => {
        const idle = (
          window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
        ).requestIdleCallback;
        if (idle) idle(() => resolve(), { timeout: 300 });
        else window.setTimeout(resolve, 0);
      }),
  );
}

export interface HeroElements {
  section: HTMLElement;
  /** The sticky (pinned) box. */
  stage: HTMLElement;
  /** Canvas wrapper; fades out at the end. */
  frame: HTMLElement;
  canvas: HTMLCanvasElement;
  poster: HTMLElement | null;
  hint: HTMLElement | null;
  beats: Partial<Record<BeatId, HTMLElement>>;
}

export interface HeroCallbacks {
  /** 0..1 while frame 1 + the sparse pass load. */
  onLoadProgress?: (fraction: number) => void;
  onReady?: () => void;
}

const enum Load {
  None = 0,
  Busy = 1,
  Done = 2,
  Failed = 3,
}

/**
 * Scroll-driven image-sequence renderer. One rAF loop drives Lenis, the damped playhead, the canvas
 * (sub-frame cross-blend) and the overlay; scroll handlers only set the target. React never re-renders.
 */
export class ScrollSequence {
  readonly set: FrameSet;
  readonly stats = {
    fetched: 0,
    decoded: 0,
    evicted: 0,
    resident: 0,
    maxResident: 0,
    exact: 0,
    partial: 0,
    fallback: 0,
    held: 0,
  };

  private readonly n = FRAME_COUNT;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly blobs: (Blob | null)[];
  private readonly fetchState: Uint8Array;
  private readonly attempts: Uint8Array;
  private readonly full: (Frame | null)[];
  private readonly decoding: Uint8Array;
  private readonly proxies: (Frame | null)[];
  private readonly proxyState: Uint8Array;
  private readonly priority: number[];
  private readonly sparse: number[];
  private readonly abort = new AbortController();
  private lenis: Lenis | null = null;

  private target = 0;
  private current = 0;
  private dir = 1;
  private raf = 0;
  private lastNow = 0;
  private dead = false;
  private visible = true;
  private dirty = true;
  private painted = false;
  private ready = false;
  private drawnPos = -1;
  private drawnExact = false;
  private centre = -1;
  private overlayP = -1;
  private posterHidden = false;
  private fetching = 0;
  private decodes = 0;

  // layout cache (refreshed on resize only)
  private top = 0;
  private span = 1;
  private coverW = 1;
  private coverH = 1;
  // per draw: source rect (normalised) and destination rect (canvas px)
  private sx = 0;
  private sy = 0;
  private sw = 1;
  private sh = 1;
  private dx = 0;
  private dy = 0;
  private dw = 1;
  private dh = 1;
  private lastScrollAt = 0;
  private restTimer = 0;

  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private resizeTimer = 0;
  private loadTimer = 0;
  private measuredOnce = false;

  constructor(
    private readonly el: HeroElements,
    private readonly cb: HeroCallbacks = {},
  ) {
    this.set = pickFrameSet();
    const ctx = el.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
    const n = this.n;
    this.blobs = new Array<Blob | null>(n).fill(null);
    this.full = new Array<Frame | null>(n).fill(null);
    this.proxies = new Array<Frame | null>(n).fill(null);
    this.fetchState = new Uint8Array(n);
    this.attempts = new Uint8Array(n);
    this.decoding = new Uint8Array(n);
    this.proxyState = new Uint8Array(n);
    this.sparse = [];
    for (let i = 0; i < n; i += HERO.sparseStride) this.sparse.push(i);
    const seen = new Set<number>([0, ...this.sparse]);
    const proxied: number[] = [];
    for (let i = 0; i < n; i += HERO.proxyStride) if (!seen.has(i)) proxied.push(i);
    if (!seen.has(n - 1)) proxied.push(n - 1);
    this.priority = [0, ...this.sparse.filter((i) => i !== 0), ...proxied];
  }

  /** Starts loading and the loop. Safe to call once. */
  async start(): Promise<void> {
    this.measure();
    this.applyOverlay(true);
    // Frame 1 is already on screen (the SSR poster). Downloading the sequence only after the page's own
    // critical resources keeps 240 requests from competing with fonts/JS on slow connections.
    void afterPageLoad().then(() => this.pumpFetch());

    this.ro = new ResizeObserver(() => {
      if (!this.measuredOnce) return void (this.measuredOnce = true);
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.measure(), HERO.resizeDebounceMs);
    });
    this.ro.observe(this.el.frame);
    this.ro.observe(this.el.section);
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e?.isIntersecting ?? true;
      if (this.visible) {
        this.dirty = true;
        this.wake();
      }
    });
    this.io.observe(this.el.section);
    window.addEventListener('scroll', this.onNativeScroll, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.loadTimer = window.setTimeout(() => this.markReady(), HERO.loadTimeoutMs);

    try {
      const { default: LenisCtor } = await import('lenis');
      if (this.dead) return;
      const lenis = new LenisCtor({
        ...HERO.lenis,
        autoRaf: false,
        allowNestedScroll: true,
        prevent: (node: HTMLElement) => node.closest?.('[role="dialog"]') != null,
      });
      lenis.on('scroll', (l: Lenis) => this.setTargetFromScroll(l.scroll));
      lenis.on('virtual-scroll', this.wake);
      this.lenis = lenis;
      // Hold the page still only while the hero is actually on screen and still loading.
      if (!this.ready && this.target < 1) lenis.stop();
    } catch {
      // Native scrolling still works; the damped playhead keeps it smooth.
    }
    this.wake();
  }

  /** Smooth scroll to an element/selector/offset, through Lenis when it is active. */
  scrollTo(target: string | HTMLElement | number, offset = 0) {
    if (this.lenis) {
      this.lenis.start();
      this.lenis.scrollTo(target, { offset, duration: 1.6 });
      this.wake();
      return;
    }
    const node = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
    const y =
      typeof node === 'number' ? node : node ? node.getBoundingClientRect().top + window.scrollY + offset : 0;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  destroy() {
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.abort.abort();
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.loadTimer);
    window.clearTimeout(this.restTimer);
    this.ro?.disconnect();
    this.io?.disconnect();
    window.removeEventListener('scroll', this.onNativeScroll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.lenis?.destroy();
    this.lenis = null;
    for (let i = 0; i < this.n; i++) {
      release(this.full[i]);
      release(this.proxies[i]);
      this.full[i] = null;
      this.proxies[i] = null;
      this.blobs[i] = null;
    }
  }

  // ---------------------------------------------------------------- loop

  private readonly wake = () => {
    if (!this.raf && !this.dead && !document.hidden) this.raf = requestAnimationFrame(this.tick);
  };

  private readonly tick = (now: number) => {
    this.raf = 0;
    if (this.dead) return;
    const dt = this.lastNow ? Math.min(HERO.maxDt, Math.max(0, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;

    this.lenis?.raf(now); // emits 'scroll' synchronously -> target

    // At rest, aim for the nearest whole frame (the difference is under half a frame of scroll).
    const last = this.n - 1;
    const goal =
      performance.now() - this.lastScrollAt > HERO.restSnapMs
        ? Math.round(this.target * last) / last
        : this.target;
    const prev = this.current;
    const diff = goal - this.current;
    if (Math.abs(diff) <= HERO.settle) this.current = goal;
    else this.current += diff * (1 - Math.exp(-dt * HERO.damping));
    if (this.current !== prev) this.dir = this.current > prev ? 1 : -1;

    if (this.visible) {
      const centre = Math.round(this.current * (this.n - 1));
      if (centre !== this.centre) {
        this.centre = centre;
        this.pumpDecode();
        this.pumpFetch();
      }
      this.render(false);
      this.applyOverlay(false);
    } else {
      this.dirty = false;
    }

    if (this.current !== goal || this.dirty || (this.lenis?.isScrolling ?? false)) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.lastNow = 0; // sleep; the next wake starts with a nominal dt
    }
  };

  private readonly onNativeScroll = () => {
    if (!this.lenis) this.setTargetFromScroll(window.scrollY);
    this.wake();
  };

  private readonly onVisibility = () => {
    if (document.hidden) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.lastNow = 0;
      this.dirty = true;
      this.wake();
    }
  };

  private setTargetFromScroll(y: number) {
    const t = clamp01((y - this.top) / this.span);
    if (t === this.target) return;
    this.target = t;
    this.lastScrollAt = performance.now();
    // make sure the loop is awake when the rest-snap kicks in
    window.clearTimeout(this.restTimer);
    this.restTimer = window.setTimeout(this.wake, HERO.restSnapMs + 20);
  }

  // ---------------------------------------------------------------- layout

  /** The only place that reads layout. Runs at start and (debounced) on resize. */
  private measure() {
    const { section, stage, frame, canvas } = this.el;
    this.top = section.getBoundingClientRect().top + window.scrollY;
    this.span = Math.max(1, section.offsetHeight - stage.offsetHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, HERO.dprCap);
    const w = Math.max(1, Math.round(frame.clientWidth * dpr));
    const h = Math.max(1, Math.round(frame.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    // Resizing resets context state.
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    const src = manifest.sets[this.set];
    const canvasAspect = w / h;
    const srcAspect = src.width / src.height;
    this.coverW = canvasAspect > srcAspect ? 1 : canvasAspect / srcAspect;
    this.coverH = canvasAspect > srcAspect ? srcAspect / canvasAspect : 1;
    this.setTargetFromScroll(this.lenis ? this.lenis.scroll : window.scrollY);
    if (!this.painted) this.current = this.target; // a reload mid-page starts where the page is
    this.render(true); // a resized canvas is cleared: repaint in the same task
    this.wake();
  }

  // ---------------------------------------------------------------- rendering

  private render(force: boolean) {
    const pos = this.current * (this.n - 1);
    if (!force && !this.dirty && Math.abs(pos - this.drawnPos) < HERO.redrawFrames) return;
    this.dirty = false;
    this.crop(pos);
    if (!this.draw(pos)) return;
    this.drawnPos = pos;
    if (!this.painted) {
      this.painted = true;
      this.el.canvas.style.opacity = '1';
      this.checkReady();
    }
  }

  /** Cover-crop around the subject, optionally zoomed out (letterboxed) by the zoom track. */
  private crop(pos: number) {
    const z = zoomAt(this.set, pos);
    const cw = this.coverW / z;
    const ch = this.coverH / z;
    this.sw = Math.min(1, cw);
    this.sh = Math.min(1, ch);
    this.sx = Math.min(Math.max(focalAt(this.set, pos) - this.sw / 2, 0), 1 - this.sw);
    this.sy = (1 - this.sh) / 2;
    const { width, height } = this.el.canvas;
    this.dw = (width * this.sw) / cw;
    this.dh = (height * this.sh) / ch;
    this.dx = (width - this.dw) / 2;
    this.dy = (height - this.dh) / 2;
  }

  /** Draws frame floor(pos) and cross-blends floor(pos)+1 at the fractional part. Never clears. */
  private draw(pos: number): boolean {
    if (this.dw < this.el.canvas.width - 0.5 || this.dh < this.el.canvas.height - 0.5) {
      // letterboxed (zoomed out): those frames have black edges, so the bars are invisible
      this.ctx.fillStyle = manifest.edge.last;
      this.ctx.fillRect(0, 0, this.el.canvas.width, this.el.canvas.height);
    }
    const i = Math.min(this.n - 1, Math.floor(pos));
    const t = pos - i;
    const a = this.full[i];
    const b = i + 1 < this.n ? this.full[i + 1] : null;
    if (a && (t < 0.002 || b)) {
      this.blit(a, 1);
      if (b && t >= 0.002) this.blit(b, t);
      this.stats.exact++;
      this.drawnExact = true;
      return true;
    }
    if (b && t > 0.998) {
      this.blit(b, 1);
      this.stats.exact++;
      this.drawnExact = true;
      return true;
    }
    const near = a ?? b ?? this.nearest(pos);
    this.drawnExact = false;
    if (!near) {
      this.stats.held++; // keep whatever is on the canvas: the last good frame stays visible
      return false;
    }
    this.blit(near, 1);
    if (a || b) this.stats.partial++;
    else this.stats.fallback++;
    return true;
  }

  /** Best stand-in for an undecoded frame: a full frame within 2, else the nearest proxy, else anything. */
  private nearest(pos: number): Frame | null {
    const c = Math.round(pos);
    for (let d = 1; d <= 2; d++) {
      const f = this.full[c + d * this.dir] ?? this.full[c - d * this.dir];
      if (f) return f;
    }
    let best: Frame | null = null;
    let bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const f = this.proxies[i];
      if (f && Math.abs(i - pos) < bestD) {
        best = f;
        bestD = Math.abs(i - pos);
      }
    }
    if (best && bestD <= HERO.proxyStride * 2) return best;
    for (let i = 0; i < this.n; i++) {
      const f = this.full[i];
      if (f && Math.abs(i - pos) < bestD) {
        best = f;
        bestD = Math.abs(i - pos);
      }
    }
    return best;
  }

  private blit(f: Frame, alpha: number) {
    const w = frameWidth(f);
    const h = frameHeight(f);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(
      f,
      this.sx * w,
      this.sy * h,
      this.sw * w,
      this.sh * h,
      this.dx,
      this.dy,
      this.dw,
      this.dh,
    );
    this.ctx.globalAlpha = 1;
  }

  private applyOverlay(force: boolean) {
    const p = this.current;
    if (!force && Math.abs(p - this.overlayP) < 0.0002) return;
    this.overlayP = p;
    for (const id of Object.keys(HERO.beats) as BeatId[]) {
      const node = this.el.beats[id];
      if (!node) continue;
      const range = HERO.beats[id];
      const o = beatOpacity(range, p);
      const y = (p < range[1] ? 1 : -1) * (1 - o) * HERO.beatShiftPx;
      node.style.opacity = o.toFixed(3);
      node.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      node.style.visibility = o < 0.01 ? 'hidden' : 'visible';
      node.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
    }
    if (this.el.hint) {
      const [h0, h1] = HERO.hint;
      this.el.hint.style.opacity = (1 - smooth(clamp01((p - h0) / (h1 - h0)))).toFixed(3);
    }
    const [f0, f1] = HERO.fadeOut;
    const fade = 1 - smooth(clamp01((p - f0) / (f1 - f0)));
    this.el.frame.style.opacity = fade.toFixed(3);
    // The poster (frame 1, the LCP image) stays painted under the opaque canvas; it only has to go
    // once the canvas starts fading, or it would show through.
    const posterHidden = fade < 1 && this.painted;
    if (this.el.poster && posterHidden !== this.posterHidden) {
      this.posterHidden = posterHidden;
      this.el.poster.style.visibility = posterHidden ? 'hidden' : 'visible';
    }
  }

  // ---------------------------------------------------------------- loading

  private nextFetch(): number {
    for (const i of this.priority) if (this.fetchState[i] === Load.None) return i;
    const c = Math.round(this.current * (this.n - 1));
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.fetchState[i] !== Load.None) continue;
      const ahead = (i - c) * this.dir;
      const cost = ahead >= 0 ? ahead : -ahead * 2;
      if (cost < bestCost) {
        best = i;
        bestCost = cost;
      }
    }
    return best;
  }

  private pumpFetch() {
    while (!this.dead && this.fetching < HERO.fetchConcurrency) {
      const i = this.nextFetch();
      if (i < 0) return;
      this.fetchState[i] = Load.Busy;
      this.fetching++;
      void this.fetchFrame(i);
    }
  }

  private async fetchFrame(i: number) {
    try {
      const init: RequestInit & { priority?: 'high' | 'low' | 'auto' } = {
        signal: this.abort.signal,
        priority: i === 0 ? 'high' : 'auto',
      };
      const res = await fetch(frameUrl(this.set, i), init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (this.dead) return;
      this.blobs[i] = blob;
      this.fetchState[i] = Load.Done;
      this.stats.fetched++;
    } catch {
      if (this.dead) return;
      this.attempts[i]++;
      this.fetchState[i] = this.attempts[i] >= 3 ? Load.Failed : Load.None;
    } finally {
      this.fetching--;
    }
    if (this.dead) return;
    this.pumpDecode();
    this.pumpFetch();
    this.checkReady();
  }

  /** Window of frames that should be decoded at full resolution, biased in the direction of travel. */
  private window(): [number, number] {
    const c = Math.round(this.current * (this.n - 1));
    return this.dir >= 0
      ? [c - HERO.cacheBehind, c + HERO.cacheAhead]
      : [c - HERO.cacheAhead, c + HERO.cacheBehind];
  }

  private pumpDecode() {
    if (this.dead) return;
    const [lo, hi] = this.window();
    for (let i = 0; i < this.n; i++) {
      if (this.full[i] && (i < lo - 2 || i > hi + 2)) {
        release(this.full[i]);
        this.full[i] = null;
        this.stats.evicted++;
        this.stats.resident--;
      }
    }
    const c = Math.round(this.current * (this.n - 1));
    while (this.decodes < HERO.maxDecodes) {
      let best = -1;
      let bestCost = Infinity;
      for (let i = Math.max(0, lo); i <= Math.min(this.n - 1, hi); i++) {
        if (!this.blobs[i] || this.full[i] || this.decoding[i]) continue;
        const ahead = (i - c) * this.dir;
        const cost = ahead >= 0 ? ahead : -ahead * 2;
        if (cost < bestCost) {
          best = i;
          bestCost = cost;
        }
      }
      if (best >= 0) {
        void this.decodeFull(best);
        continue;
      }
      // `priority` is exactly the proxied set: frame 1, the sparse pass, every proxyStride-th frame, the last.
      const p = this.priority.find((i) => this.blobs[i] && this.proxyState[i] === Load.None);
      if (p === undefined) return;
      void this.decodeProxy(p);
    }
  }

  private async decodeFull(i: number) {
    this.decoding[i] = 1;
    this.decodes++;
    try {
      const f = await decodeBlob(this.blobs[i]!);
      const [lo, hi] = this.window();
      if (this.dead || i < lo - 2 || i > hi + 2) {
        release(f);
      } else {
        this.full[i] = f;
        this.stats.decoded++;
        this.stats.resident++;
        this.stats.maxResident = Math.max(this.stats.maxResident, this.stats.resident);
        if (!this.drawnExact || !this.painted) {
          this.dirty = true;
          this.wake();
        }
      }
    } catch {
      this.blobs[i] = null; // undecodable: never retry, nearest() covers the gap
    } finally {
      this.decoding[i] = 0;
      this.decodes--;
    }
    if (!this.dead) this.pumpDecode();
  }

  private async decodeProxy(i: number) {
    this.proxyState[i] = Load.Busy;
    this.decodes++;
    try {
      const width = Math.round(manifest.sets[this.set].width * HERO.proxyScale);
      let f = await decodeBlob(this.blobs[i]!, width);
      if (frameWidth(f) > width * 1.5) {
        // resizeWidth unsupported: downscale once so proxies stay small
        const c = document.createElement('canvas');
        c.width = width;
        c.height = Math.round((frameHeight(f) * width) / frameWidth(f));
        c.getContext('2d')?.drawImage(f, 0, 0, c.width, c.height);
        release(f);
        f = c;
      }
      if (this.dead) release(f);
      else {
        this.proxies[i] = f;
        this.proxyState[i] = Load.Done;
        if (!this.drawnExact) {
          this.dirty = true;
          this.wake();
        }
      }
    } catch {
      this.proxyState[i] = Load.Failed;
    } finally {
      this.decodes--;
    }
    if (!this.dead) {
      this.checkReady();
      this.pumpDecode();
    }
  }

  private checkReady() {
    if (this.ready) return;
    let done = this.painted ? 1 : 0;
    for (const i of this.sparse)
      if (this.proxyState[i] >= Load.Done || this.fetchState[i] === Load.Failed) done++;
    const total = this.sparse.length + 1;
    this.cb.onLoadProgress?.(done / total);
    if (done === total) this.markReady();
  }

  private markReady() {
    if (this.ready || this.dead) return;
    this.ready = true;
    window.clearTimeout(this.loadTimer);
    this.lenis?.start();
    this.cb.onLoadProgress?.(1);
    this.cb.onReady?.();
  }
}
