'use client';

import { useEffect, useRef, useState } from 'react';
import { PLAYBACK_RATES, canChangeRate, formatTime, type Intermission } from '@willio/shared';
import { GlassButton, GlassPanel, IconButton } from '@/components/ui/Glass';
import { ProgressBar } from '@/components/ui/Bits';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { cx } from '@/lib/util';
import { usePrefs } from '@/store/prefs';
import { selectMyRole, useRoom, type SyncBadge as Badge } from '@/store/room';
import { useControl, useRoomClient } from './context';
import { PlayerSurface } from './PlayerSurface';
import { ReactionLayer } from './Reactions';
import { Seekbar } from './Seekbar';

const BADGE: Record<Badge, { label: string; cls: string }> = {
  IN_SYNC: { label: 'IN SYNC', cls: 'bg-ok text-ink' },
  ADJUSTING: { label: 'ADJUSTING', cls: 'bg-warn text-ink' },
  RESYNCING: { label: 'RESYNCING', cls: 'bg-danger text-white' },
  PAUSED: { label: 'PAUSED', cls: 'bg-white/80 text-ink' },
  LOADING: { label: 'LOADING', cls: 'bg-sky text-ink' },
  OFFLINE: { label: 'OFFLINE', cls: 'bg-danger text-white' },
};

export function SyncBadge() {
  const badge = useRoom((s) => s.sync.badge);
  const drift = useRoom((s) => s.sync.driftMs);
  const b = BADGE[badge];
  return (
    <div
      className="absolute left-3 top-3 z-10 flex items-center gap-2"
      role="status"
      aria-label={`Sync status: ${b.label}${drift != null ? `, drift ${Math.round(drift)} milliseconds` : ''}`}
    >
      <span className={cx('font-pixel flex items-center gap-1.5 px-2 py-1 text-[9px] shadow-lg', b.cls)}>
        <span className="h-2 w-2 bg-current opacity-80" aria-hidden />
        {b.label}
      </span>
      {drift != null && badge !== 'LOADING' && badge !== 'OFFLINE' ? (
        <span className="font-mono bg-black/55 px-1.5 py-0.5 text-[11px] text-hi">
          {drift >= 0 ? '+' : ''}
          {Math.round(drift)}ms
        </span>
      ) : null}
    </div>
  );
}

function useServerCountdown(endsAt: number | null): number {
  const client = useRoomClient();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (endsAt == null) return;
    const tick = () => setLeft(Math.max(0, endsAt - client.clock.serverNow()));
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [endsAt, client]);
  return left;
}

function IntermissionOverlay({ intermission }: { intermission: Intermission }) {
  const client = useRoomClient();
  const role = useRoom(selectMyRole);
  const left = useServerCountdown(intermission.endsAt);
  const total = intermission.minutes * 60_000;
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/65 text-center backdrop-blur-sm">
      <span className="text-5xl" aria-hidden>
        🍿
      </span>
      <p className="font-pixel text-sm text-lantern">SNACK BREAK</p>
      <p className="font-mono text-5xl font-semibold tabular-nums text-hi" aria-live="polite">
        {formatTime(left / 1000)}
      </p>
      <ProgressBar value={total - left} max={total} segments={24} className="w-64" label="Intermission progress" />
      <p className="text-xs text-mid">Started by {intermission.startedBy}. Playback resumes for everyone at the same moment.</p>
      {role !== 'VIEWER' ? (
        <GlassButton size="sm" onClick={() => void client.intermission('cancel')}>
          End break now
        </GlassButton>
      ) : null}
    </div>
  );
}

const STAGES: Record<string, { pct: number; text: string }> = {
  idle: { pct: 5, text: 'Generating terrain...' },
  connecting: { pct: 15, text: 'Connecting to the server...' },
  clock: { pct: 40, text: 'Syncing clocks (NTP burst)...' },
  joining: { pct: 65, text: 'Joining the party...' },
  offline: { pct: 15, text: 'Reconnecting...' },
  error: { pct: 0, text: 'Something went wrong' },
};

function JoinOverlay() {
  const client = useRoomClient();
  const phase = useRoom((s) => s.phase);
  const hasState = useRoom((s) => s.state !== null);
  const media = useRoom((s) => s.state?.media ?? null);
  const playerReady = useRoom((s) => s.sync.playerReady);
  const needsGesture = useRoom((s) => s.sync.needsGesture);
  const mediaError = useRoom((s) => s.sync.mediaError);
  const error = useRoom((s) => s.error);

  if (mediaError) {
    return (
      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center">
        <PixelIcon name="warning" size={28} className="text-warn" />
        <p className="font-label text-xs text-warn">Video failed to load</p>
        <p className="max-w-sm text-sm text-mid">{mediaError}</p>
        <GlassButton size="sm" icon="refresh" onClick={() => void client.resync()}>
          Retry
        </GlassButton>
      </div>
    );
  }
  if (needsGesture) {
    return (
      <button
        type="button"
        onClick={() => client.unlockPlayback()}
        className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60 text-center backdrop-blur-[2px]"
      >
        <span className="pixel-corners flex h-20 w-20 items-center justify-center bg-teal-500 text-ink shadow-glow">
          <PixelIcon name="play" size={36} />
        </span>
        <span className="font-pixel text-xs text-hi">CLICK TO JOIN PLAYBACK</span>
        <span className="text-xs text-mid">Your browser blocked autoplay - one click and you are in sync.</span>
      </button>
    );
  }
  const loadingMedia = phase === 'live' && !!media && !playerReady;
  if (hasState && !loadingMedia) return null;
  if (phase === 'live' && !media) return null;
  const stage = loadingMedia ? { pct: 85, text: 'Loading media & seeking to the room position...' } : (STAGES[phase] ?? STAGES.idle!);
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-center">
      <p className="font-pixel text-xs text-hi">{phase === 'error' ? 'ERROR' : 'GENERATING TERRAIN'}</p>
      <ProgressBar value={stage.pct} segments={20} className="w-64" label="Loading progress" />
      <p className="text-sm text-mid" aria-live="polite">
        {phase === 'error' ? error : stage.text}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="font-pixel text-xs text-teal-400">NOTHING PLAYING</span>
      <p className="max-w-sm text-sm text-mid">
        Open <strong className="text-hi">Discover</strong> in the sidebar and hit play on an open film, or add a video URL to the{' '}
        <strong className="text-hi">Queue</strong>.
      </p>
    </div>
  );
}

function EndedOverlay({ onRecap }: { onRecap: () => void }) {
  const heatmap = useRoom((s) => s.heatmap);
  const client = useRoomClient();
  const control = useControl();
  const highlights = (heatmap?.bins.length ? heatmap.bins : (heatmap?.crowd ?? []))
    .map((v, i) => ({ v, t: i * (heatmap?.binSec ?? 5) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .sort((a, b) => a.t - b.t);
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 p-6 text-center">
      <p className="font-pixel text-xs text-lantern">THE END</p>
      {highlights.length > 0 ? (
        <>
          <p className="text-sm text-mid">Highlights reel - the moments your group reacted most:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {highlights.map((h) => (
              <GlassButton key={h.t} size="sm" disabled={control === 'DENY'} onClick={() => void client.seek(h.t)}>
                {formatTime(h.t)} - {h.v} reactions
              </GlassButton>
            ))}
          </div>
        </>
      ) : null}
      <GlassButton variant="lantern" icon="star" onClick={onRecap}>
        Room recap card
      </GlassButton>
    </div>
  );
}

function ControlsBar({ onFullscreen }: { onFullscreen: () => void }) {
  const client = useRoomClient();
  const control = useControl();
  const role = useRoom(selectMyRole);
  const status = useRoom((s) => s.state?.status ?? 'PAUSED');
  const optimistic = useRoom((s) => s.optimisticStatus);
  const rate = useRoom((s) => s.state?.rate ?? 1);
  const hasMedia = useRoom((s) => !!s.state?.media);
  const suggestResync = useRoom((s) => s.sync.suggestResync);
  const volume = usePrefs((s) => s.volume);
  const muted = usePrefs((s) => s.muted);
  const captions = usePrefs((s) => s.captions);
  const setPref = usePrefs((s) => s.set);
  const playerReady = useRoom((s) => s.sync.playerReady);
  const mediaId = useRoom((s) => s.state?.media?.id ?? null);
  const [hasCaptions, setHasCaptions] = useState(false);

  const playing = (optimistic ?? status) === 'PLAYING';
  const locked = control === 'DENY';

  // Apply local audio/caption prefs whenever they change or a new player becomes ready.
  useEffect(() => {
    const p = client.player;
    if (!p || !playerReady) {
      setHasCaptions(false);
      return;
    }
    p.setVolume(volume);
    p.setMuted(muted);
    p.setCaptions(captions);
    setHasCaptions(p.hasCaptions());
  }, [client, playerReady, mediaId, volume, muted, captions]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <IconButton
        icon={playing ? 'pause' : 'play'}
        label={locked ? 'Only the host controls playback' : playing ? 'Pause (Space)' : 'Play (Space)'}
        tone="teal"
        disabled={!hasMedia || locked}
        onClick={() => void (playing ? client.pause() : client.play())}
      />
      {locked ? (
        <span className="text-lo" title="The host controls playback in this room">
          <PixelIcon name="lock" size={14} title="Host controls playback" />
        </span>
      ) : control === 'VOTE' ? (
        <span className="font-label text-[9px] text-lantern" title="Your actions start a quick vote">
          VOTE MODE
        </span>
      ) : null}
      {/* full-width row on phones, inline on larger screens */}
      <div className="order-first flex w-full sm:order-none sm:w-auto sm:flex-1">
        <Seekbar disabled={!hasMedia || locked} />
      </div>
      <div className="ml-auto flex items-center gap-1 sm:ml-0">
        <IconButton icon={muted ? 'mute' : 'volume'} label={muted ? 'Unmute (M)' : 'Mute (M)'} size="sm" onClick={() => setPref('muted', !muted)} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(e) => {
            setPref('volume', Number(e.target.value));
            if (muted) setPref('muted', false);
          }}
          className="hidden w-20 accent-teal-400 sm:block"
        />
      </div>
      {canChangeRate(role) ? (
        <select
          aria-label="Playback speed (host)"
          value={rate}
          disabled={!hasMedia}
          onChange={(e) => void client.setRate(Number(e.target.value))}
          className="glass glass-sm pixel-corners-sm font-mono h-8 bg-transparent px-1.5 text-xs text-hi [&>option]:bg-bg-1"
        >
          {PLAYBACK_RATES.map((r) => (
            <option key={r} value={r}>
              {r}x
            </option>
          ))}
        </select>
      ) : rate !== 1 ? (
        <span className="font-mono text-xs text-mid">{rate}x</span>
      ) : null}
      {hasCaptions ? (
        <IconButton icon="captions" label="Captions" size="sm" active={captions} onClick={() => setPref('captions', !captions)} />
      ) : null}
      <GlassButton
        size="sm"
        icon="refresh"
        variant={suggestResync ? 'lantern' : 'secondary'}
        onClick={() => void client.resync()}
        title="Resync me (R)"
        disabled={!hasMedia}
      >
        <span className="hidden md:inline">Resync me</span>
      </GlassButton>
      <IconButton icon="fullscreen" label="Fullscreen (F)" size="sm" onClick={onFullscreen} />
    </div>
  );
}

/** The glass "window" around the video: player, overlays, badge, controls. */
export function PlayerWindow({ onRecap, fullscreenRef }: { onRecap: () => void; fullscreenRef: React.RefObject<HTMLDivElement> }) {
  const media = useRoom((s) => s.state?.media ?? null);
  const ended = useRoom((s) => !!s.state?.ended);
  const intermission = useRoom((s) => s.intermission);
  const phase = useRoom((s) => s.phase);
  const frame = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    const el = fullscreenRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <GlassPanel as="section" aria-label="Player" className="flex flex-col overflow-hidden" blur="md" strong>
      {/* The screen is always "cinema dark": scoping dark tokens keeps controls readable in Misty Dawn too. */}
      <div ref={fullscreenRef} data-theme="dark" className="relative flex flex-col bg-black text-hi">
        <div ref={frame} className="relative aspect-video w-full overflow-hidden bg-black">
          {media ? <PlayerSurface key={media.id} media={media} /> : phase === 'live' ? <EmptyState /> : null}
          <ReactionLayer />
          <SyncBadge />
          {media && ended && !intermission ? <EndedOverlay onRecap={onRecap} /> : null}
          {intermission ? <IntermissionOverlay intermission={intermission} /> : null}
          <JoinOverlay />
        </div>
        <ControlsBar onFullscreen={toggleFullscreen} />
      </div>
    </GlassPanel>
  );
}
