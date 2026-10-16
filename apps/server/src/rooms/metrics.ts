import { SYNC, percentile, type PlaybackCause } from '@blockparty/shared';
import { RollingWindow } from '../util/collections';

interface SentInfo {
  serverTs: number;
  action: PlaybackCause;
  users: number;
  samples: number[];
}

export interface PropagationSummary {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  samples: number;
}

/**
 * Control propagation latency (PRD 8.4): per client per state:update,
 *   latency = (client receive time on the server clock) - (server broadcast time).
 */
export class PropagationTracker {
  private sent = new Map<number, SentInfo>();
  private window = new RollingWindow(SYNC.metricsWindowMs);
  private events = new RollingWindow(10_000, 5000);

  constructor(private readonly onFinalized?: (seq: number, info: SentInfo) => void) {}

  onBroadcast(seq: number, serverTs: number, action: PlaybackCause, users: number): void {
    this.sent.set(seq, { serverTs, action, users, samples: [] });
    this.finalizeOld(serverTs);
  }

  countEvent(now = Date.now()): void {
    this.events.add(1, now);
  }

  eventsPerSec(now = Date.now()): number {
    return Math.round((this.events.count(now) / 10) * 10) / 10;
  }

  /** Returns the latency sample (ms) or null when the seq is unknown/implausible. */
  onAck(seq: number, recvServerTs: number): number | null {
    const info = this.sent.get(seq);
    if (!info) return null;
    const latency = recvServerTs - info.serverTs;
    // Clock-offset error can make tiny latencies slightly negative; clamp. Reject garbage.
    if (!Number.isFinite(latency) || latency < -1000 || latency > 30_000) return null;
    const v = Math.max(0, latency);
    info.samples.push(v);
    this.window.add(v);
    return v;
  }

  private finalizeOld(now: number): void {
    for (const [seq, info] of this.sent) {
      if (now - info.serverTs < 3000) continue;
      this.sent.delete(seq);
      if (info.samples.length > 0) this.onFinalized?.(seq, info);
    }
  }

  summary(now = Date.now()): PropagationSummary {
    const v = this.window.values(now);
    return {
      p50: percentile(v, 50),
      p95: percentile(v, 95),
      p99: percentile(v, 99),
      max: v.length ? Math.max(...v) : null,
      samples: v.length,
    };
  }

  rawValues(now = Date.now()): number[] {
    return this.window.values(now);
  }
}
