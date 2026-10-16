import { buildTasteVector, hasTaste, type Movie, type TasteVector } from '@blockparty/shared';
import { readJSON, writeJSON } from './storage';

export interface Profile {
  name: string;
  avatarSeed: string;
  likedIds: string[];
  genres: string[];
  runtimeMax: number | null;
  taste: TasteVector | null;
}

const KEY = 'bp:profile';

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function loadProfile(): Profile | null {
  const p = readJSON<Partial<Profile>>(KEY);
  if (!p || typeof p.name !== 'string' || !p.name.trim()) return null;
  return {
    name: p.name,
    avatarSeed: typeof p.avatarSeed === 'string' && p.avatarSeed ? p.avatarSeed : randomSeed(),
    likedIds: Array.isArray(p.likedIds) ? p.likedIds : [],
    genres: Array.isArray(p.genres) ? p.genres : [],
    runtimeMax: typeof p.runtimeMax === 'number' ? p.runtimeMax : null,
    taste: p.taste ?? null,
  };
}

export function saveProfile(p: Profile): void {
  writeJSON(KEY, p);
}

export function computeTaste(liked: Movie[], genres: string[], runtimeMax: number | null): TasteVector | null {
  const v = buildTasteVector(liked, genres, runtimeMax);
  return hasTaste(v) ? v : null;
}

const ADJ = ['Mossy', 'Glowing', 'Sneaky', 'Cozy', 'Lucky', 'Pixel', 'Swampy', 'Brave', 'Sleepy', 'Turbo'];
const NOUN = ['Axolotl', 'Firefly', 'Creeper', 'Frog', 'Lantern', 'Otter', 'Golem', 'Fox', 'Bee', 'Llama'];

export function randomName(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a} ${n}`;
}
