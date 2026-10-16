/** Storage helpers that never throw (private mode, disabled storage, SSR). */

type Area = 'local' | 'session';

function area(kind: Area): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJSON<T>(key: string, kind: Area = 'local'): T | null {
  const s = area(kind);
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown, kind: Area = 'local'): void {
  const s = area(kind);
  if (!s) return;
  try {
    if (value === null || value === undefined) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or disabled - non critical */
  }
}

export interface RoomSession {
  token: string;
  userId: string;
}

/**
 * Session tokens are per tab (sessionStorage): a reload keeps the same identity (reconnect),
 * while a second tab is a different participant - which is what multi-tab demos need.
 * Duplicating a tab copies sessionStorage, and the server then applies "latest tab wins".
 */
export const sessions = {
  get: (code: string) => readJSON<RoomSession>(`bp:session:${code}`, 'session'),
  set: (code: string, s: RoomSession) => {
    writeJSON(`bp:session:${code}`, s, 'session');
    writeJSON('bp:lastToken', s.token, 'session');
  },
  clear: (code: string) => writeJSON(`bp:session:${code}`, null, 'session'),
  lastToken: () => readJSON<string>('bp:lastToken', 'session'),
};
