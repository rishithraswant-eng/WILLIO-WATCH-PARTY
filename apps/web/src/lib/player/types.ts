import type { MediaSource, PlayerLike } from '@willio/shared';

export type PlayerEvent = 'ready' | 'waiting' | 'playing' | 'pause' | 'seeked' | 'ended' | 'duration' | 'error' | 'progress';

/** Common interface for HTML5/HLS and YouTube players (PRD 3.4). */
export interface PlayerAdapter extends PlayerLike {
  readonly kind: 'html5' | 'youtube';
  load(media: MediaSource): Promise<void>;
  getDuration(): number | null;
  getBuffered(): [number, number][];
  setVolume(v: number): void;
  getVolume(): number;
  setMuted(m: boolean): void;
  isMuted(): boolean;
  hasCaptions(): boolean;
  setCaptions(on: boolean): void;
  on(ev: PlayerEvent, cb: (detail?: string) => void): () => void;
  destroy(): void;
}

export class Emitter {
  private map = new Map<PlayerEvent, Set<(d?: string) => void>>();
  on(ev: PlayerEvent, cb: (d?: string) => void): () => void {
    let set = this.map.get(ev);
    if (!set) {
      set = new Set();
      this.map.set(ev, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }
  emit(ev: PlayerEvent, detail?: string): void {
    const set = this.map.get(ev);
    if (set) for (const cb of [...set]) cb(detail);
  }
  clear(): void {
    this.map.clear();
  }
}
