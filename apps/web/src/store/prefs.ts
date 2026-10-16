import { create } from 'zustand';
import { readJSON, writeJSON } from '@/lib/storage';
import { setSoundsEnabled } from '@/lib/sound';

export interface Prefs {
  /** null = not chosen yet (late joiners get it ON automatically) */
  spoilerSafe: boolean | null;
  profanityFilter: boolean;
  sounds: boolean;
  reducedTransparency: boolean;
  volume: number;
  muted: boolean;
  captions: boolean;
}

const DEFAULTS: Prefs = {
  spoilerSafe: null,
  profanityFilter: false,
  sounds: false,
  reducedTransparency: false,
  volume: 0.8,
  muted: false,
  captions: false,
};

const KEY = 'bp:prefs';

interface PrefsStore extends Prefs {
  hydrated: boolean;
  hydrate(): void;
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
}

export const usePrefs = create<PrefsStore>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const saved = readJSON<Partial<Prefs>>(KEY) ?? {};
    const next = { ...DEFAULTS, ...saved };
    setSoundsEnabled(next.sounds);
    applyTransparency(next.reducedTransparency);
    set({ ...next, hydrated: true });
  },
  set: (key, value) => {
    set({ [key]: value } as Partial<PrefsStore>);
    const { hydrated: _h, hydrate: _hy, set: _s, ...rest } = get();
    writeJSON(KEY, rest);
    if (key === 'sounds') setSoundsEnabled(value as boolean);
    if (key === 'reducedTransparency') applyTransparency(value as boolean);
  },
}));

function applyTransparency(reduced: boolean): void {
  if (typeof document === 'undefined') return;
  if (reduced) document.documentElement.dataset.transparency = 'reduced';
  else delete document.documentElement.dataset.transparency;
}
