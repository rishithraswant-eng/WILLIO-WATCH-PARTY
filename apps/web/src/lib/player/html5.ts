import type { MediaSource } from '@willio/shared';
import { Emitter, type PlayerAdapter, type PlayerEvent } from './types';

type HlsInstance = import('hls.js').default;

/** HTML5 <video> adapter; HLS via hls.js (lazy-loaded) unless the browser plays HLS natively. */
export class Html5Adapter implements PlayerAdapter {
  readonly kind = 'html5' as const;
  readonly fineRate = true;
  private em = new Emitter();
  private hls: HlsInstance | null = null;
  private errored = false;
  private destroyed = false;
  private detach: (() => void)[] = [];

  constructor(private readonly video: HTMLVideoElement) {
    video.preload = 'auto';
    video.playsInline = true;
    video.controls = false;
    (video as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = true;
    const map: [string, PlayerEvent][] = [
      ['canplay', 'ready'],
      ['waiting', 'waiting'],
      ['playing', 'playing'],
      ['pause', 'pause'],
      ['seeked', 'seeked'],
      ['ended', 'ended'],
      ['loadedmetadata', 'duration'],
      ['durationchange', 'duration'],
      ['progress', 'progress'],
    ];
    for (const [native, ev] of map) {
      const h = () => this.em.emit(ev);
      video.addEventListener(native, h);
      this.detach.push(() => video.removeEventListener(native, h));
    }
    const onError = () => {
      this.errored = true;
      this.em.emit('error', video.error?.message || 'This video could not be played');
    };
    video.addEventListener('error', onError);
    this.detach.push(() => video.removeEventListener('error', onError));
  }

  async load(media: MediaSource): Promise<void> {
    this.errored = false;
    this.teardownHls();
    const v = this.video;
    const nativeHls = v.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (media.type === 'HLS' && !nativeHls) {
      const { default: Hls } = await import('hls.js');
      if (this.destroyed) return;
      if (!Hls.isSupported()) {
        this.em.emit('error', 'HLS is not supported in this browser');
        return;
      }
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      this.hls = hls;
      let recoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (recoveries++ < 3) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else this.em.emit('error', `HLS error: ${data.details}`);
        } else {
          this.errored = true;
          this.em.emit('error', `HLS error: ${data.details}`);
        }
      });
      hls.loadSource(media.url);
      hls.attachMedia(v);
    } else {
      v.src = media.url;
      v.load();
    }
  }

  private teardownHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  isReady(): boolean {
    return !this.errored && this.video.readyState >= HTMLMediaElement.HAVE_METADATA;
  }
  getTime(): number {
    return this.video.currentTime;
  }
  isPaused(): boolean {
    return this.video.paused;
  }
  isStalled(): boolean {
    const v = this.video;
    return v.seeking || (!v.ended && v.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
  }
  play(): Promise<void> {
    return this.video.play();
  }
  pause(): void {
    if (!this.video.paused) this.video.pause();
  }
  seek(sec: number): void {
    const d = this.getDuration();
    this.video.currentTime = d ? Math.min(Math.max(0, sec), Math.max(0, d - 0.05)) : Math.max(0, sec);
  }
  setRate(rate: number): void {
    this.video.playbackRate = rate;
  }
  getRate(): number {
    return this.video.playbackRate;
  }
  getDuration(): number | null {
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d : null;
  }
  getBuffered(): [number, number][] {
    const b = this.video.buffered;
    const out: [number, number][] = [];
    for (let i = 0; i < b.length; i++) out.push([b.start(i), b.end(i)]);
    return out;
  }
  setVolume(v: number): void {
    this.video.volume = Math.min(1, Math.max(0, v));
  }
  getVolume(): number {
    return this.video.volume;
  }
  setMuted(m: boolean): void {
    this.video.muted = m;
  }
  isMuted(): boolean {
    return this.video.muted;
  }
  hasCaptions(): boolean {
    return this.video.textTracks.length > 0;
  }
  setCaptions(on: boolean): void {
    const tracks = this.video.textTracks;
    for (let i = 0; i < tracks.length; i++) tracks[i]!.mode = on && i === 0 ? 'showing' : 'disabled';
  }
  on(ev: PlayerEvent, cb: (d?: string) => void): () => void {
    return this.em.on(ev, cb);
  }
  destroy(): void {
    this.destroyed = true;
    this.teardownHls();
    for (const d of this.detach) d();
    this.em.clear();
    try {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    } catch {
      /* element may already be detached */
    }
  }
}
