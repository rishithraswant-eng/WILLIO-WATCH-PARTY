import { hashString, seededRandom } from '@blockparty/shared';

/** 8x8 blocky ("Steve-like") face generated deterministically from a seed. */
export interface PixelGrid {
  size: number;
  pixels: { x: number; y: number; c: string }[];
}

const SKIN = ['#f2c7a5', '#e0a77e', '#c68863', '#9a6748', '#6e4630', '#f5d6c6'];
const HAIR = ['#3b2a1a', '#6b4423', '#c9a227', '#1d1d1d', '#a33b20', '#5e6b7a', '#2ee6c5', '#e05ab4'];
const EYES = ['#3a6fd8', '#2a8a4a', '#5b3b24', '#7a4fd0', '#1aa6a6', '#333333'];
export const AVATAR_ACCENTS = ['#2ee6c5', '#ffcf5c', '#ff8a3d', '#5ab4ff', '#3ddc84', '#e05ab4'];

export function avatarAccent(seed: string): string {
  return AVATAR_ACCENTS[hashString(`accent:${seed}`) % AVATAR_ACCENTS.length]!;
}

export function avatarGrid(seed: string): PixelGrid {
  const rnd = seededRandom(hashString(seed || 'x'));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const eye = pick(EYES);
  const style = Math.floor(rnd() * 4);
  const beard = rnd() < 0.25;
  const px: { x: number; y: number; c: string }[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let c = skin;
      // hair: top rows + sides, varying by style
      if (y === 0 || (y === 1 && (style !== 3 || x < 2 || x > 5))) c = hair;
      if (style >= 1 && y === 2 && (x === 0 || x === 7)) c = hair;
      if (style === 2 && y <= 3 && (x === 0 || x === 7)) c = hair;
      // eyes
      if (y === 4 && (x === 1 || x === 5)) c = '#ffffff';
      if (y === 4 && (x === 2 || x === 6)) c = eye;
      // nose / mouth
      if (y === 5 && (x === 3 || x === 4)) c = shade(skin, -0.18);
      if (y === 6 && x >= 2 && x <= 5) c = beard ? hair : shade(skin, -0.32);
      if (beard && y === 7 && x >= 1 && x <= 6) c = hair;
      px.push({ x, y, c });
    }
  }
  return { size: 8, pixels: px };
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const GENRE_PALETTES: Record<string, [string, string, string]> = {
  'Sci-Fi': ['#0b2a4a', '#2ee6c5', '#9fe8ff'],
  Action: ['#3a0d0d', '#ff8a3d', '#ffcf5c'],
  Adventure: ['#0f3a24', '#7bbf2f', '#ffcf5c'],
  Animation: ['#2a1650', '#e05ab4', '#ffcf5c'],
  Comedy: ['#4a3a05', '#ffcf5c', '#ffffff'],
  Crime: ['#111418', '#ff5d6c', '#a8cfc6'],
  Documentary: ['#13302a', '#3ddc84', '#eafff9'],
  Drama: ['#1c1f3a', '#5ab4ff', '#eafff9'],
  Family: ['#103a3a', '#3ddc84', '#ffcf5c'],
  Fantasy: ['#25123a', '#b48cff', '#9fe8ff'],
  History: ['#3a2a12', '#c9a227', '#f2e6c8'],
  Horror: ['#0a0a0a', '#ff5d6c', '#6c8f88'],
  Music: ['#2a0f3a', '#e05ab4', '#5ab4ff'],
  Mystery: ['#0f1a2a', '#6c8f88', '#ffcf5c'],
  Romance: ['#3a0f22', '#ff7aa8', '#ffd6e4'],
  Thriller: ['#101d1d', '#19c3a6', '#ff5d6c'],
  War: ['#1f2416', '#7a8a4a', '#ffb84d'],
  Western: ['#3a220f', '#ff8a3d', '#f2c7a5'],
};

/** Deterministic pixel poster art (24x36 grid) for movies without artwork. */
export function posterGrid(id: string, genres: string[]): { bg: [string, string]; accent: string; pixels: { x: number; y: number; c: string }[] } {
  const pal = GENRE_PALETTES[genres[0] ?? ''] ?? ['#082019', '#2ee6c5', '#ffcf5c'];
  const rnd = seededRandom(hashString(id));
  const pixels: { x: number; y: number; c: string }[] = [];
  const W = 24;
  const H = 36;
  // a "sun/moon" disc
  const cx = 4 + Math.floor(rnd() * 16);
  const cy = 4 + Math.floor(rnd() * 8);
  const r = 2 + Math.floor(rnd() * 3);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1 && x >= 0 && x < W && y >= 0) pixels.push({ x, y, c: pal[2] });
  // stepped horizon / skyline
  let h = 18 + Math.floor(rnd() * 6);
  for (let x = 0; x < W; x++) {
    if (rnd() < 0.35) h = Math.max(12, Math.min(28, h + (rnd() < 0.5 ? -2 : 2)));
    for (let y = h; y < H; y++) pixels.push({ x, y, c: y === h ? pal[1] : shade(pal[0], 0.35 - (y - h) * 0.03) });
  }
  // sparkles
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * 14);
    pixels.push({ x, y, c: rnd() < 0.5 ? pal[2] : pal[1] });
  }
  return { bg: [pal[0], shade(pal[0], 0.6)], accent: pal[1], pixels };
}
