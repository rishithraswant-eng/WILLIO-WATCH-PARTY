'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LIMITS, formatTime } from '@blockparty/shared';
import { cx } from '@/lib/util';
import { useRoom } from '@/store/room';
import { useRoomClient } from './context';

/**
 * XP-bar style seekbar: segmented progress, buffered ranges, reaction heatmap glowing
 * lantern->ember above it, poll-result markers. Scrubbing previews locally and commits on release.
 */
export function Seekbar({ disabled }: { disabled: boolean }) {
  const client = useRoomClient();
  const duration = useRoom((s) => s.sync.duration);
  const heatmap = useRoom((s) => s.heatmap);
  const mediaId = useRoom((s) => s.state?.media?.id ?? null);
  const polls = useRoom((s) => s.polls);
  const posSec = useRoom((s) => Math.floor(s.sync.position));
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const buffered = useRef<HTMLDivElement>(null);
  const timeLabel = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  // rAF loop: write position straight into the DOM (no React re-render at 60fps).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const d = useRoom.getState().sync.duration;
      const pos = dragRef.current ?? client.position();
      const pct = d ? Math.min(100, (pos / d) * 100) : 0;
      if (fill.current) fill.current.style.width = `${pct}%`;
      if (timeLabel.current) timeLabel.current.textContent = `${formatTime(pos)} / ${d ? formatTime(d) : '--:--'}`;
      if (buffered.current && client.player && d) {
        const ranges = client.player.getBuffered();
        const end = ranges.reduce((m, [a, b]) => (pos >= a - 1 && b > m ? b : m), 0);
        buffered.current.style.width = `${Math.min(100, (end / d) * 100)}%`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [client]);

  const heat = useMemo(() => {
    if (!heatmap || heatmap.mediaId !== mediaId || !duration) return null;
    const bins = heatmap.bins.length ? heatmap.bins : [];
    const crowd = heatmap.crowd;
    const n = Math.max(bins.length, crowd.length);
    if (n === 0) return null;
    const combined = Array.from({ length: n }, (_, i) => (bins[i] ?? 0) * 2 + (crowd[i] ?? 0));
    const max = Math.max(1, ...combined);
    const stops = combined
      .map((v, i) => {
        const t = (i * LIMITS.heatBinSec) / duration;
        if (t > 1) return null;
        const a = v / max;
        const color = a > 0.66 ? `rgba(255,138,61,${0.35 + a * 0.6})` : `rgba(255,207,92,${a * 0.8})`;
        return `${color} ${(t * 100).toFixed(2)}%`;
      })
      .filter(Boolean);
    return stops.length > 1 ? `linear-gradient(90deg, ${stops.join(', ')})` : null;
  }, [heatmap, mediaId, duration]);

  const markers = useMemo(() => {
    if (!duration) return [];
    return Object.values(polls)
      .filter((p) => p.status === 'CLOSED' && p.type === 'SKIP_TO' && p.payload?.pos != null && p.result?.applied)
      .map((p) => ({ id: p.id, pct: (p.payload!.pos! / duration) * 100, label: p.question }));
  }, [polls, duration]);

  const posFromEvent = (e: PointerEvent<HTMLDivElement>) => {
    const r = bar.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return f * (duration ?? 0);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = posFromEvent(e);
    dragRef.current = t;
    setDrag(t);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const t = posFromEvent(e);
    const r = bar.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, t });
    if (dragRef.current != null) {
      dragRef.current = t;
      setDrag(t);
    }
  };
  const onUp = () => {
    if (dragRef.current != null) {
      const t = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      void client.seek(t);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !duration) return;
    const pos = client.position();
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = pos + 5;
    else if (e.key === 'ArrowLeft') next = pos - 5;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = duration - 1;
    if (next != null) {
      e.preventDefault();
      e.stopPropagation();
      void client.seek(Math.max(0, Math.min(duration - 0.5, next)));
    }
  };

  return (
    <div className="flex flex-1 items-center gap-3">
      <div
        ref={bar}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration ?? 0)}
        aria-valuenow={Math.round(drag ?? posSec)}
        aria-valuetext={formatTime(drag ?? posSec)}
        aria-disabled={disabled || !duration}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        className={cx('group relative h-6 flex-1 touch-none', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
      >
        {/* reaction heatmap */}
        {heat ? <div className="absolute inset-x-0 top-0 h-1.5 opacity-90" style={{ background: heat }} aria-hidden /> : null}
        <div className="absolute inset-x-0 top-2 h-3 overflow-hidden bg-black/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div ref={buffered} className="absolute inset-y-0 left-0 bg-white/15" />
          <div ref={fill} className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald to-moss" />
          <div className="xp-track absolute inset-0" />
        </div>
        {markers.map((m) => (
          <span
            key={m.id}
            title={m.label}
            className="absolute top-1 h-5 w-1 -translate-x-1/2 bg-sky"
            style={{ left: `${m.pct}%` }}
            aria-hidden
          />
        ))}
        {hover && duration ? (
          <span
            className="font-mono pointer-events-none absolute -top-7 -translate-x-1/2 bg-bg-0/90 px-1.5 py-0.5 text-[11px] text-hi"
            style={{ left: hover.x }}
          >
            {formatTime(drag ?? hover.t)}
          </span>
        ) : null}
      </div>
      <span ref={timeLabel} className="font-mono w-[104px] shrink-0 text-right text-xs text-mid tabular-nums">
        0:00 / --:--
      </span>
    </div>
  );
}
