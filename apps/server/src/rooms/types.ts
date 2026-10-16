import type { FastifyBaseLogger } from 'fastify';
import type { DriftMode, ErrorCode, GroupMember, Recommendation, Role, TasteVector } from '@willio/shared';
import type { Catalog } from '../catalog/catalog';
import type { DurableStore } from '../db/durable';
import type { HeatStore } from '../services/heat';

/** Transport surface the Room uses; implemented by the Socket.IO layer (and fakes in tests). */
export interface RoomIO {
  toRoom(code: string, event: string, payload: unknown, exceptSocketIds?: string[]): void;
  toSocket(socketId: string, event: string, payload: unknown): void;
  toMetrics(code: string, event: string, payload: unknown): void;
  hasMetricsSubscribers(code: string): boolean;
  disconnect(socketId: string, mode: 'replaced' | 'chaos'): void;
}

export interface RoomDeps {
  io: RoomIO;
  durable: DurableStore;
  heat: HeatStore;
  catalog: Catalog;
  log: FastifyBaseLogger;
  bootId: string;
  chaosEnabled: boolean;
  /** called after every logged mutation so the manager can persist a snapshot */
  onChange(code: string): void;
  /** best-effort presence mirror (Redis hash) */
  kvPresence?(code: string, userId: string, value: object | null): Promise<void>;
  /** Group Taste Fusion over the catalog */
  recommend(members: GroupMember[], limit: number): Recommendation[];
}

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

export interface Telemetry {
  rtt: number;
  offset: number;
  drift: number;
  mode: DriftMode;
  rate: number;
  pos: number;
  hardSeeks: number;
  updatedAt: number;
  lastCorrectionAt: number | null;
  history: number[];
}

export interface ChaosState {
  latencyMs: number;
  dropPct: number;
  until: number;
}

export interface Participant {
  id: string;
  name: string;
  avatarSeed: string;
  role: Role;
  joinedAt: number;
  connected: boolean;
  socketId: string | null;
  lastSeenAt: number;
  taste: TasteVector | null;
  buffering: boolean;
  catchUpUntil: number;
  tele: Telemetry | null;
  lastSampleAt: number;
  chaos: ChaosState | null;
}

export interface SessionUser {
  id: string;
  name: string;
  seed: string;
}
