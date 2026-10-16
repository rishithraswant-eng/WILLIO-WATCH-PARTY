import type { ControlMode, ErrorCode, Movie, Recommendation, RoomInfo, TasteVector } from '@willio/shared';
import { serverUrl } from './config';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('NETWORK', "Can't reach the Willio server - is it running on port 4000?", 0);
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as { error?: { code?: ErrorCode; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? 'INTERNAL', err?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export interface CreateRoomResponse {
  code: string;
  token: string;
  userId: string;
  room: RoomInfo;
}

export interface JoinRoomResponse {
  token: string;
  userId: string;
  room: RoomInfo;
}

export interface RoomPreview {
  room: RoomInfo;
  connected: number;
  nowPlaying: { title: string; status: string } | null;
}

export const api = {
  createRoom: (body: {
    name: string;
    avatarSeed: string;
    roomName?: string;
    password?: string;
    controlMode?: ControlMode;
    token?: string;
  }) => request<CreateRoomResponse>('/api/rooms', { method: 'POST', body: JSON.stringify(body) }),
  getRoom: (code: string) => request<RoomPreview>(`/api/rooms/${encodeURIComponent(code)}`),
  joinRoom: (code: string, body: { name: string; avatarSeed: string; password?: string; token?: string }) =>
    request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify(body) }),
  catalog: () => request<{ version: number; movies: Movie[] }>('/api/catalog', { timeoutMs: 20_000 }),
  recommend: (code: string, limit = 12) =>
    request<{ recommendations: Recommendation[] }>(`/api/recommend/${encodeURIComponent(code)}?limit=${limit}`),
  stats: () =>
    request<{ rooms: number; users: number; p50: number | null; p95: number | null; benchP95: number | null }>('/api/stats'),
  benchLatest: () => request<unknown>('/api/bench/latest'),
};

export type { TasteVector };
