import { LIMITS } from '@willio/shared';
import type { DurableStore } from '../db/durable';
import type { KvStore } from '../db/kv';

const KEY = 'heat:global';
const MAX_BINS = 2400; // 200 minutes at 5s bins

/**
 * Cross-room reaction heat per media ("crowd favourite moments").
 * Hydrated from Postgres (authoritative) or the KV store, persisted to KV (debounced).
 */
export class HeatStore {
  private heat = new Map<string, number[]>();
  private dirty = false;
  private timer: NodeJS.Timeout;

  constructor(private readonly kv: KvStore) {
    this.timer = setInterval(() => void this.persist(), 10_000);
    this.timer.unref();
  }

  async hydrate(durable: DurableStore): Promise<void> {
    const rows = durable.enabled ? await durable.heatAggregates() : [];
    if (rows.length > 0) {
      for (const r of rows) this.addBin(r.mediaId, r.bin, r.count);
      return;
    }
    const saved = await this.kv.getJSON<Record<string, number[]>>(KEY);
    if (saved) for (const [id, bins] of Object.entries(saved)) this.heat.set(id, bins.slice(0, MAX_BINS));
  }

  private addBin(mediaId: string, bin: number, count: number): void {
    if (!Number.isFinite(bin) || bin < 0 || bin >= MAX_BINS) return;
    let bins = this.heat.get(mediaId);
    if (!bins) {
      bins = [];
      this.heat.set(mediaId, bins);
    }
    while (bins.length <= bin) bins.push(0);
    bins[bin] = (bins[bin] ?? 0) + count;
    this.dirty = true;
  }

  add(mediaId: string, videoTs: number, count: number): void {
    this.addBin(mediaId, Math.floor(videoTs / LIMITS.heatBinSec), count);
  }

  get(mediaId: string): number[] {
    return this.heat.get(mediaId)?.slice() ?? [];
  }

  async persist(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.kv.setJSON(KEY, Object.fromEntries(this.heat));
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.persist();
  }
}
