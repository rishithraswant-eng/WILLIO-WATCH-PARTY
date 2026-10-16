/**
 * Where the browser reaches the realtime/API server. NEXT_PUBLIC_WS_URL wins; otherwise
 * use the page's own host on port 4000 so LAN devices (http://192.168.x.y:3000) just work.
 */
export function serverUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env && env.trim()) return env.trim().replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://localhost:4000';
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

export function roomLink(code: string): string {
  if (typeof window === 'undefined') return `/r/${code}`;
  return `${window.location.origin}/r/${code}`;
}
