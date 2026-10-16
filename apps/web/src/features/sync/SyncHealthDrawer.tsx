'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SYNC, type UserSyncMetrics } from '@blockparty/shared';
import { ArcGauge, Badge, Sparkline } from '@/components/ui/Bits';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { Select } from '@/components/ui/Form';
import { useRoomClient } from '@/features/room/context';
import { cx, timeAgo } from '@/lib/util';
import { selectMyRole, useRoom } from '@/store/room';
import { toast } from '@/store/toasts';

const MODE_TONE = { IDLE: 'ok', NUDGING: 'warn', HARD_SEEK: 'danger', BUFFERING: 'info' } as const;

function fmt(v: number | null, unit = 'ms'): string {
  return v == null ? '--' : `${Math.round(v)}${unit}`;
}

function UserRow({ u }: { u: UserSyncMetrics }) {
  const drift = u.drift;
  const tone = drift == null ? 'text-lo' : Math.abs(drift) < 100 ? 'text-ok' : Math.abs(drift) < 500 ? 'text-warn' : 'text-danger';
  return (
    <tr className={cx('border-t border-white/5', !u.connected && 'opacity-40')}>
      <td className="max-w-[110px] truncate py-1.5 pr-2 text-hi">
        {u.name}
        {u.chaos.length ? <span className="ml-1 text-[10px] text-ember">({u.chaos.join(', ')})</span> : null}
      </td>
      <td className="font-mono pr-2 text-right text-mid">{fmt(u.rtt)}</td>
      <td className="font-mono pr-2 text-right text-mid">{fmt(u.offset)}</td>
      <td className={cx('font-mono pr-2 text-right', tone)}>{drift == null ? '--' : `${drift > 0 ? '+' : ''}${Math.round(drift)}ms`}</td>
      <td className="pr-2">{u.mode ? <Badge tone={MODE_TONE[u.mode]}>{u.mode.replace('_', ' ')}</Badge> : <span className="text-lo">--</span>}</td>
      <td className="pr-2 text-[11px] text-lo">{u.lastCorrectionAt ? timeAgo(u.lastCorrectionAt) : '-'}</td>
      <td>
        <Sparkline values={u.history} />
      </td>
    </tr>
  );
}

function ChaosPanel() {
  const client = useRoomClient();
  const participants = useRoom((s) => s.participants);
  const me = useRoom((s) => s.me);
  const [target, setTarget] = useState('');
  const others = Object.values(participants).filter((p) => p.connected);
  const run = async (type: string, params?: Record<string, number>) => {
    const r = await client.chaos(type, target || undefined, params);
    if (r.ok) toast.warn(`Chaos: ${type.toLowerCase().replace('_', ' ')}`, (r as { target?: string | null }).target ? `-> ${(r as { target?: string }).target}` : 'room-wide');
  };
  return (
    <section aria-label="Chaos Mode" className="flex flex-col gap-2 border border-dashed border-ember/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-pixel text-[10px] text-ember">CHAOS MODE</h3>
        <Badge tone="warn">DEMO</Badge>
      </div>
      <p className="text-xs text-mid">Break things on purpose and watch the engine heal. Effects expire after 20s.</p>
      <Select label="Target" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Random participant</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.id === me?.id ? ' (you)' : ''}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-1.5">
        <GlassButton size="sm" onClick={() => void run('LATENCY', { ms: 300 })}>
          +300ms RTT
        </GlassButton>
        <GlassButton size="sm" onClick={() => void run('DROP', { pct: 0.1 })}>
          10% packet drop
        </GlassButton>
        <GlassButton size="sm" onClick={() => void run('DISCONNECT')}>
          Force disconnect
        </GlassButton>
        <GlassButton size="sm" onClick={() => void run('BUFFER', { ms: 3000 })}>
          Buffer 3s
        </GlassButton>
        <GlassButton size="sm" onClick={() => void run('DESYNC', { ms: 3000 })}>
          Desync +3s
        </GlassButton>
        <GlassButton size="sm" onClick={() => void run('SERVER_DELAY', { ms: 200 })}>
          Server delay
        </GlassButton>
      </div>
      <GlassButton size="sm" variant="ghost" onClick={() => void run('CLEAR')}>
        Clear all chaos
      </GlassButton>
    </section>
  );
}

export function SyncHealthDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useRoomClient();
  const metrics = useRoom((s) => s.metrics);
  const role = useRoom(selectMyRole);
  const chaosEnabled = useRoom((s) => !!s.room?.chaosEnabled);
  const mySync = useRoom((s) => s.sync);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    void client.subscribeMetrics(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      void client.subscribeMetrics(false);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, client, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.aside
          role="dialog"
          aria-modal="false"
          aria-label="Sync Health dashboard"
          initial={reduce ? { opacity: 0 } : { x: '100%' }}
          animate={reduce ? { opacity: 1 } : { x: 0 }}
          exit={reduce ? { opacity: 0 } : { x: '100%' }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="glass glass-lg glass-strong scroll-thin fixed inset-y-0 right-0 z-[70] flex w-full max-w-[560px] flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-gradient text-2xl font-semibold">Sync Health</h2>
            <IconButton icon="close" label="Close Sync Health" size="sm" onClick={onClose} />
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-4">
            <ArcGauge value={metrics?.roomSyncPct ?? null} label="room in sync" caption={`|drift| < ${SYNC.syncedThresholdMs}ms`} size={150} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="font-label text-[9px] text-lo">Propagation p50</dt>
                <dd className="font-mono text-lg text-hi">{fmt(metrics?.p50 ?? null)}</dd>
              </div>
              <div>
                <dt className="font-label text-[9px] text-lo">p95 (target 250)</dt>
                <dd className={cx('font-mono text-lg', (metrics?.p95 ?? 0) > 250 ? 'text-danger' : 'text-ok')}>{fmt(metrics?.p95 ?? null)}</dd>
              </div>
              <div>
                <dt className="font-label text-[9px] text-lo">p99 / max</dt>
                <dd className="font-mono text-hi">
                  {fmt(metrics?.p99 ?? null)} / {fmt(metrics?.max ?? null)}
                </dd>
              </div>
              <div>
                <dt className="font-label text-[9px] text-lo">Samples (5 min)</dt>
                <dd className="font-mono text-hi">{metrics?.samples ?? 0}</dd>
              </div>
              <div>
                <dt className="font-label text-[9px] text-lo">Events / sec</dt>
                <dd className="font-mono text-hi">{metrics?.eventsPerSec ?? 0}</dd>
              </div>
              <div>
                <dt className="font-label text-[9px] text-lo">Seq / lead</dt>
                <dd className="font-mono text-hi">
                  #{metrics?.seq ?? 0} / {metrics?.lead ?? '--'}ms
                </dd>
              </div>
            </dl>
          </div>
          <div className="pixel-corners-sm grid grid-cols-4 gap-2 bg-black/25 p-3 text-xs">
            <div>
              <p className="font-label text-[9px] text-lo">My drift</p>
              <p className="font-mono text-hi">{mySync.driftMs == null ? '--' : `${Math.round(mySync.driftMs)}ms`}</p>
            </div>
            <div>
              <p className="font-label text-[9px] text-lo">My RTT</p>
              <p className="font-mono text-hi">{Math.round(mySync.rttMs)}ms</p>
            </div>
            <div>
              <p className="font-label text-[9px] text-lo">Clock offset</p>
              <p className="font-mono text-hi">{Math.round(mySync.offsetMs)}ms</p>
            </div>
            <div>
              <p className="font-label text-[9px] text-lo">Mode</p>
              <p className="font-mono text-hi">{mySync.mode}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Per-user sync telemetry</caption>
              <thead>
                <tr className="font-label text-left text-[9px] text-lo">
                  <th className="pb-1 pr-2 font-normal">User</th>
                  <th className="pb-1 pr-2 text-right font-normal">RTT</th>
                  <th className="pb-1 pr-2 text-right font-normal">Offset</th>
                  <th className="pb-1 pr-2 text-right font-normal">Drift</th>
                  <th className="pb-1 pr-2 font-normal">State</th>
                  <th className="pb-1 pr-2 font-normal">Fixed</th>
                  <th className="pb-1 font-normal">Drift trend</th>
                </tr>
              </thead>
              <tbody>
                {(metrics?.users ?? []).map((u) => (
                  <UserRow key={u.id} u={u} />
                ))}
              </tbody>
            </table>
            {!metrics ? <p className="p-3 text-center text-xs text-lo">Waiting for telemetry...</p> : null}
          </div>
          {role === 'HOST' && chaosEnabled ? <ChaosPanel /> : null}
          <section aria-label="Sync event log" className="flex flex-col gap-1">
            <h3 className="font-label text-[10px] text-mid">Event log (last 50)</h3>
            <ol className="font-mono scroll-thin max-h-56 overflow-y-auto bg-black/30 p-2 text-[11px]">
              {[...(metrics?.log ?? [])].reverse().map((e, i) => (
                <li key={`${e.ts}-${i}`} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-lo">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
                  <span
                    className={cx(
                      'shrink-0',
                      e.kind === 'chaos' ? 'text-ember' : e.kind === 'hard-seek' ? 'text-danger' : e.kind === 'host' ? 'text-lantern' : 'text-teal-400',
                    )}
                  >
                    {e.kind}
                  </span>
                  <span className="text-hi/90">{e.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </motion.aside>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
