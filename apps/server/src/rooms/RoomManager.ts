import { DEMO_ROOM_CODE, SYNC, percentile, recommendForGroup, type ControlMode, type GroupMember } from '@willio/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Catalog } from '../catalog/catalog';
import type { DurableStore } from '../db/durable';
import type { KvStore } from '../db/kv';
import type { HeatStore } from '../services/heat';
import { generateRoomCode } from '../util/text';
import { Room, mediaFromMovie, type PersistedRoom } from './Room';
import type { RoomDeps, RoomIO } from './types';

export interface ManagerOptions {
  log: FastifyBaseLogger;
  kv: KvStore;
  durable: DurableStore;
  heat: HeatStore;
  catalog: Catalog;
  bootId: string;
  chaosEnabled: boolean;
  roomMaxUsers: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private dirty = new Set<string>();
  private sweepTimer: NodeJS.Timeout;
  private flushTimer: NodeJS.Timeout;
  private io: RoomIO | null = null;

  constructor(private readonly opts: ManagerOptions) {
    this.sweepTimer = setInterval(() => void this.sweep(), 60_000);
    this.sweepTimer.unref();
    // Belt and braces: persist anything dirty every 2s even if debounces keep sliding.
    this.flushTimer = setInterval(() => {
      for (const code of [...this.dirty]) void this.save(code);
    }, 2000);
    this.flushTimer.unref();
  }

  attachIO(io: RoomIO): void {
    this.io = io;
  }

  private deps(): RoomDeps {
    if (!this.io) throw new Error('RoomManager: IO not attached');
    const { log, durable, heat, catalog, bootId, chaosEnabled, kv } = this.opts;
    return {
      io: this.io,
      durable,
      heat,
      catalog,
      log,
      bootId,
      chaosEnabled,
      onChange: (code) => this.scheduleSave(code),
      kvPresence: (code, userId, value) => kv.setPresence(code, userId, value),
      recommend: (members: GroupMember[], limit: number) => recommendForGroup(catalog.all(), members, limit),
    };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  create(input: { name: string; passwordHash: string | null; hostId: string; controlMode?: ControlMode }): Room {
    let code = generateRoomCode();
    for (let i = 0; this.rooms.has(code) || code === DEMO_ROOM_CODE; i++) {
      if (i > 50) throw new Error('could not allocate a room code');
      code = generateRoomCode();
    }
    const room = new Room(this.deps(), {
      code,
      name: input.name,
      passwordHash: input.passwordHash,
      hostId: input.hostId,
      maxUsers: this.opts.roomMaxUsers,
      controlMode: input.controlMode,
    });
    this.rooms.set(code, room);
    room.persistRoomRecord();
    this.scheduleSave(code);
    return room;
  }

  /** Seeded demo room "DEMO42" with Big Buck Bunny loaded; never expires. */
  ensureDemoRoom(): void {
    if (this.rooms.has(DEMO_ROOM_CODE)) return;
    const bbb = this.opts.catalog.all().find((m) => m.isFree && m.streamType !== 'YOUTUBE');
    const room = new Room(this.deps(), {
      code: DEMO_ROOM_CODE,
      name: 'Demo Swamp',
      passwordHash: null,
      hostId: null,
      maxUsers: this.opts.roomMaxUsers,
      controlMode: 'EVERYONE',
      isDemo: true,
      initialMedia: bbb ? mediaFromMovie(bbb) : null,
    });
    room.settings.queueMode = 'EVERYONE';
    this.rooms.set(DEMO_ROOM_CODE, room);
    room.persistRoomRecord();
  }

  async restore(): Promise<number> {
    const snapshots = await this.opts.kv.loadRooms();
    let n = 0;
    for (const json of snapshots) {
      try {
        const data = JSON.parse(json) as PersistedRoom;
        if (data.v !== 1 || this.rooms.has(data.code)) continue;
        this.rooms.set(data.code, Room.fromPersisted(this.deps(), data));
        n++;
      } catch (err) {
        this.opts.log.warn({ err }, 'could not restore room snapshot');
      }
    }
    return n;
  }

  scheduleSave(code: string): void {
    this.dirty.add(code);
    const existing = this.saveTimers.get(code);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => void this.save(code), 200);
    t.unref();
    this.saveTimers.set(code, t);
  }

  private async save(code: string): Promise<void> {
    const t = this.saveTimers.get(code);
    if (t) clearTimeout(t);
    this.saveTimers.delete(code);
    if (!this.dirty.delete(code)) return;
    const room = this.rooms.get(code);
    if (!room) return;
    try {
      await this.opts.kv.saveRoom(code, JSON.stringify(room.toPersisted()), SYNC.roomTtlMs);
    } catch (err) {
      this.opts.log.warn({ err, code }, 'snapshot save failed');
    }
  }

  /** Close rooms that have been empty longer than the TTL (6h). */
  private async sweep(now = Date.now()): Promise<void> {
    for (const room of this.rooms.values()) {
      if (room.isDemo || room.connectedCount() > 0) continue;
      if (room.emptySince != null && now - room.emptySince > SYNC.roomTtlMs) {
        this.rooms.delete(room.code);
        room.dispose();
        await this.opts.kv.deleteRoom(room.code);
        this.opts.durable.room({ ...room.roomRecord(), closedAt: new Date() });
        this.opts.log.info({ code: room.code }, 'room expired');
      }
    }
  }

  stats(now = Date.now()) {
    const all: number[] = [];
    let users = 0;
    for (const r of this.rooms.values()) {
      users += r.connectedCount();
      all.push(...r.metrics.rawValues(now));
    }
    return {
      rooms: this.rooms.size,
      users,
      propagationSamples: all.length,
      p50: percentile(all, 50),
      p95: percentile(all, 95),
      p99: percentile(all, 99),
    };
  }

  async shutdown(): Promise<void> {
    clearInterval(this.sweepTimer);
    clearInterval(this.flushTimer);
    for (const code of this.rooms.keys()) this.dirty.add(code);
    await Promise.all([...this.rooms.keys()].map((c) => this.save(c)));
    for (const r of this.rooms.values()) r.dispose();
  }
}
