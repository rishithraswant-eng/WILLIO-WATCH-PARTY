import { youtubeId, type MediaSource } from '@willio/shared';
import { Emitter, type PlayerAdapter, type PlayerEvent } from './types';

/* Minimal typings for the YouTube IFrame API (avoids an extra @types package). */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(sec: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  getPlaybackRate(): number;
  getVideoLoadedFraction(): number;
  setVolume(v: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        if (window.YT) resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => {
        apiPromise = null;
        reject(new Error('Could not load the YouTube player (blocked or offline?)'));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

/**
 * YouTube adapter. YouTube only supports discrete playback rates, so `fineRate=false`
 * makes the drift controller use hard seeks only (wider tolerance, PRD 8.5).
 */
export class YouTubeAdapter implements PlayerAdapter {
  readonly kind = 'youtube' as const;
  readonly fineRate = false;
  private em = new Emitter();
  private player: YTPlayer | null = null;
  private ready = false;
  private state: number = STATE.UNSTARTED;
  private seeking = false;
  private seekTimer: number | null = null;
  private mountEl: HTMLDivElement;
  private destroyed = false;

  constructor(private readonly container: HTMLElement) {
    this.mountEl = document.createElement('div');
    this.mountEl.style.width = '100%';
    this.mountEl.style.height = '100%';
    container.appendChild(this.mountEl);
  }

  async load(media: MediaSource): Promise<void> {
    const id = youtubeId(media.url);
    if (!id) {
      this.em.emit('error', 'Not a valid YouTube link');
      return;
    }
    const YT = await loadApi();
    if (this.destroyed) return;
    this.player?.destroy();
    this.ready = false;
    await new Promise<void>((resolve) => {
      this.player = new YT.Player(this.mountEl, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            this.ready = true;
            this.em.emit('duration');
            this.em.emit('ready');
            resolve();
          },
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => {
            this.em.emit('error', `YouTube error ${e.data} (video unavailable or embedding disabled)`);
            resolve();
          },
        },
      });
    });
  }

  private onState(s: number): void {
    this.state = s;
    if (this.seeking && (s === STATE.PLAYING || s === STATE.PAUSED || s === STATE.CUED)) {
      this.seeking = false;
      this.em.emit('seeked');
    }
    if (s === STATE.BUFFERING) this.em.emit('waiting');
    else if (s === STATE.PLAYING) this.em.emit('playing');
    else if (s === STATE.PAUSED) this.em.emit('pause');
    else if (s === STATE.ENDED) this.em.emit('ended');
    this.em.emit('progress');
  }

  isReady(): boolean {
    return this.ready && !!this.player;
  }
  getTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }
  isPaused(): boolean {
    return this.state !== STATE.PLAYING && this.state !== STATE.BUFFERING;
  }
  isStalled(): boolean {
    return this.seeking || this.state === STATE.BUFFERING;
  }
  /** Resolves once YouTube actually starts; rejects as NotAllowedError when autoplay is blocked. */
  play(): Promise<void> {
    const p = this.player;
    if (!p) return Promise.resolve();
    p.playVideo();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.destroyed) return resolve();
        if (this.state === STATE.PLAYING || this.state === STATE.BUFFERING) return resolve();
        if (Date.now() - started > 2500) {
          const err = new Error('Autoplay blocked');
          err.name = 'NotAllowedError';
          return reject(err);
        }
        window.setTimeout(check, 150);
      };
      check();
    });
  }
  pause(): void {
    if (this.player && this.state === STATE.PLAYING) this.player.pauseVideo();
  }
  seek(sec: number): void {
    if (!this.player) return;
    this.seeking = true;
    if (this.seekTimer) window.clearTimeout(this.seekTimer);
    this.seekTimer = window.setTimeout(() => {
      if (this.seeking) {
        this.seeking = false;
        this.em.emit('seeked');
      }
    }, 1500);
    this.player.seekTo(Math.max(0, sec), true);
  }
  setRate(rate: number): void {
    this.player?.setPlaybackRate(rate);
  }
  getRate(): number {
    return this.player?.getPlaybackRate() ?? 1;
  }
  getDuration(): number | null {
    const d = this.player?.getDuration() ?? 0;
    return d > 0 ? d : null;
  }
  getBuffered(): [number, number][] {
    const d = this.getDuration();
    const f = this.player?.getVideoLoadedFraction() ?? 0;
    return d ? [[0, d * f]] : [];
  }
  setVolume(v: number): void {
    this.player?.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100));
  }
  getVolume(): number {
    return (this.player?.getVolume() ?? 100) / 100;
  }
  setMuted(m: boolean): void {
    if (m) this.player?.mute();
    else this.player?.unMute();
  }
  isMuted(): boolean {
    return this.player?.isMuted() ?? false;
  }
  hasCaptions(): boolean {
    return false;
  }
  setCaptions(): void {}
  on(ev: PlayerEvent, cb: (d?: string) => void): () => void {
    return this.em.on(ev, cb);
  }
  destroy(): void {
    this.destroyed = true;
    if (this.seekTimer) window.clearTimeout(this.seekTimer);
    try {
      this.player?.destroy();
    } catch {
      /* ignore */
    }
    this.player = null;
    this.em.clear();
    this.mountEl.remove();
    void this.container;
  }
}
