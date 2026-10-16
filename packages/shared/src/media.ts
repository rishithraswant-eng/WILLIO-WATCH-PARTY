import type { StreamType } from './types';

/** Extracts a YouTube video id from the common URL shapes. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
        id = m?.[1] ?? null;
      }
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function detectStreamType(url: string): StreamType {
  if (youtubeId(url)) return 'YOUTUBE';
  try {
    if (new URL(url).pathname.toLowerCase().includes('.m3u8')) return 'HLS';
  } catch {
    /* not a URL: treat as progressive */
  }
  return 'MP4';
}

/** Short stable hash (FNV-1a) used for ids derived from URLs and avatar seeds. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mediaIdForUrl(url: string): string {
  return `url-${hashString(url).toString(36)}`;
}

export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (youtubeId(url)) return 'YouTube video';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? u.hostname);
    return last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').slice(0, 80) || u.hostname;
  } catch {
    return 'Custom video';
  }
}

/** Seeded PRNG (mulberry32) - deterministic visuals from ids. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
