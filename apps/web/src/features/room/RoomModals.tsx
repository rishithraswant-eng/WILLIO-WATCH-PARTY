'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@blockparty/shared';
import { Kbd } from '@/components/ui/Bits';
import { GlassButton } from '@/components/ui/Glass';
import { Input, Select, Slider, Switch } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { avatarAccent, avatarGrid } from '@/lib/pixelArt';
import { roomLink } from '@/lib/config';
import { copyText } from '@/lib/util';
import { usePrefs } from '@/store/prefs';
import { selectMyRole, useRoom } from '@/store/room';
import { toast } from '@/store/toasts';
import { useRoomClient } from './context';

export function InviteModal({ open, onClose, code }: { open: boolean; onClose: () => void; code: string }) {
  const link = roomLink(code);
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error('Copy failed', text);
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Join my BlockParty', text: `Room code ${code}`, url: link });
    } catch {
      /* cancelled */
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Invite friends">
      <div className="flex flex-col items-center gap-4">
        <div className="bg-white p-3">
          <QRCodeSVG value={link} size={176} level="M" bgColor="#ffffff" fgColor="#04100e" />
        </div>
        <button type="button" onClick={() => void copy(code, 'Room code')} className="font-pixel tracking-[0.3em] text-2xl text-teal-400" title="Copy code">
          {code}
        </button>
        <div className="flex w-full gap-2">
          <Input className="flex-1" value={link} readOnly aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <GlassButton icon="copy" onClick={() => void copy(link, 'Link')}>
            Copy
          </GlassButton>
        </div>
        {typeof navigator !== 'undefined' && 'share' in navigator ? (
          <GlassButton variant="primary" icon="send" onClick={() => void share()}>
            Share
          </GlassButton>
        ) : null}
        <p className="text-center text-xs text-lo">Anyone with the link or code can join. Up to 50 people per room.</p>
      </div>
    </Modal>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useRoomClient();
  const role = useRoom(selectMyRole);
  const room = useRoom((s) => s.room);
  const prefs = usePrefs();
  const [name, setName] = useState(room?.name ?? '');
  const [minutes, setMinutes] = useState(5);
  useEffect(() => setName(room?.name ?? ''), [room?.name, open]);
  const isHost = role === 'HOST';
  const staff = role === 'HOST' || role === 'MOD';
  if (!room) return null;
  const update = (patch: Record<string, unknown>) => void client.updateSettings(patch);
  return (
    <Modal open={open} onClose={onClose} title="Settings" wide>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3" aria-label="Room settings">
          <h3 className="font-label text-[10px] text-mid">Room {isHost ? '' : '(host only)'}</h3>
          <div className="flex gap-2">
            <Input className="flex-1" label="Room name" value={name} disabled={!isHost} onChange={(e) => setName(e.target.value)} />
            <GlassButton className="self-end" disabled={!isHost || !name.trim() || name === room.name} onClick={() => update({ name })}>
              Save
            </GlassButton>
          </div>
          <Select label="Who controls playback" value={room.settings.controlMode} disabled={!isHost} onChange={(e) => update({ controlMode: e.target.value })}>
            <option value="HOST_ONLY">Host & mods only</option>
            <option value="EVERYONE">Everyone</option>
            <option value="VOTE">Vote to play/pause/seek</option>
          </Select>
          <Select label="Buffering policy" value={room.settings.waitPolicy} disabled={!isHost} onChange={(e) => update({ waitPolicy: e.target.value })}>
            <option value="WAIT_FOR_ALL">Wait for the slowest (max 4s)</option>
            <option value="NEVER_WAIT">Never wait</option>
          </Select>
          <Select label="Queue editing" value={room.settings.queueMode} disabled={!isHost} onChange={(e) => update({ queueMode: e.target.value })}>
            <option value="HOST_ONLY">Host & mods reorder</option>
            <option value="EVERYONE">Everyone reorders</option>
          </Select>
          <Select label="Poll tie-break" value={room.settings.tieBreak} disabled={!isHost} onChange={(e) => update({ tieBreak: e.target.value })}>
            <option value="HOST_VOTE">Host&apos;s vote decides</option>
            <option value="RANDOM">Random</option>
          </Select>
          {staff ? (
            <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
              <Slider label="Intermission length" min={1} max={15} value={minutes} onChange={setMinutes} format={(v) => `${v} min`} />
              <GlassButton
                variant="lantern"
                onClick={() => {
                  void client.intermission('start', minutes);
                  onClose();
                }}
              >
                Start snack break
              </GlassButton>
            </div>
          ) : null}
        </section>
        <section className="flex flex-col gap-3" aria-label="Personal preferences">
          <h3 className="font-label text-[10px] text-mid">You</h3>
          <Switch checked={prefs.spoilerSafe ?? false} onChange={(v) => prefs.set('spoilerSafe', v)} label="Spoiler-safe chat" description="Blur messages from later in the movie" />
          <Switch checked={prefs.profanityFilter} onChange={(v) => prefs.set('profanityFilter', v)} label="Soft profanity filter" />
          <Switch checked={prefs.sounds} onChange={(v) => prefs.set('sounds', v)} label="UI sounds" description="Block click, level-up chime, reaction pop" />
          <Switch
            checked={prefs.reducedTransparency}
            onChange={(v) => prefs.set('reducedTransparency', v)}
            label="Reduce transparency"
            description="Solid panels instead of frosted glass"
          />
          <div className="border-t border-white/10 pt-3">
            <h3 className="font-label mb-2 text-[10px] text-mid">Keyboard</h3>
            <ul className="grid grid-cols-2 gap-1.5 text-xs text-mid">
              <li>
                <Kbd>Space</Kbd> play / pause
              </li>
              <li>
                <Kbd>&larr;</Kbd> <Kbd>&rarr;</Kbd> seek 5s
              </li>
              <li>
                <Kbd>&uarr;</Kbd> <Kbd>&darr;</Kbd> volume
              </li>
              <li>
                <Kbd>M</Kbd> mute
              </li>
              <li>
                <Kbd>F</Kbd> fullscreen
              </li>
              <li>
                <Kbd>R</Kbd> resync me
              </li>
              <li>
                <Kbd>1</Kbd>-<Kbd>9</Kbd> reactions
              </li>
              <li>
                <Kbd>H</Kbd> sync health
              </li>
            </ul>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/** Shareable end-of-session card rendered on a canvas (PNG download / Web Share). */
export function RecapModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const s = useRoom.getState();
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const W = 1200;
      const H = 630;
      c.width = W;
      c.height = H;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#04100e');
      g.addColorStop(0.6, '#0c3a33');
      g.addColorStop(1, '#082019');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // pixel fireflies
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = i % 3 ? 'rgba(255,207,92,0.5)' : 'rgba(46,230,197,0.5)';
        ctx.fillRect((i * 173) % W, (i * 97) % H, 4, 4);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(60, 60, W - 120, H - 120);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.strokeRect(60, 60, W - 120, H - 120);
      const pixelFont = getComputedStyle(document.documentElement).getPropertyValue('--font-press') || 'monospace';
      const plex = getComputedStyle(document.documentElement).getPropertyValue('--font-plex') || 'sans-serif';
      ctx.fillStyle = '#2ee6c5';
      ctx.font = `20px ${pixelFont}`;
      ctx.fillText('BLOCKPARTY RECAP', 100, 120);
      ctx.fillStyle = '#eafff9';
      ctx.font = `600 52px ${plex}`;
      const title = s.state?.media?.title ?? 'Watch party';
      ctx.fillText(title.length > 34 ? `${title.slice(0, 33)}...` : title, 100, 190);
      ctx.font = `24px ${plex}`;
      ctx.fillStyle = '#a8cfc6';
      ctx.fillText(`${s.room?.name ?? ''} - room ${s.code ?? ''}`, 100, 230);
      const syncScore = s.inSyncSamples.total ? Math.round((s.inSyncSamples.good / s.inSyncSamples.total) * 100) : null;
      const topReactions = Object.entries(s.reactionTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const talker = Object.entries(s.chatCounts).sort((a, b) => b[1] - a[1])[0];
      const stats: [string, string][] = [
        ['WATCHED', formatTime(s.watchSeconds)],
        ['SYNC SCORE', syncScore == null ? '--' : `${syncScore}%`],
        ['TOP REACTIONS', topReactions.length ? topReactions.map(([e, n]) => `${e}${n}`).join('  ') : '-'],
        ['CHATTIEST', talker ? `${talker[0]} (${talker[1]})` : '-'],
      ];
      stats.forEach(([label, value], i) => {
        const x = 100 + (i % 2) * 520;
        const y = 300 + Math.floor(i / 2) * 110;
        ctx.fillStyle = '#ffcf5c';
        ctx.font = `14px ${pixelFont}`;
        ctx.fillText(label, x, y);
        ctx.fillStyle = '#eafff9';
        ctx.font = `600 40px ${plex}`;
        ctx.fillText(value, x, y + 50);
      });
      // participant avatars
      const people = Object.values(s.participants).slice(0, 14);
      people.forEach((p, i) => {
        const grid = avatarGrid(p.avatarSeed);
        const ox = 100 + i * 70;
        const oy = 500;
        for (const px of grid.pixels) {
          ctx.fillStyle = px.c;
          ctx.fillRect(ox + px.x * 7, oy + px.y * 7, 7, 7);
        }
        ctx.strokeStyle = avatarAccent(p.avatarSeed);
        ctx.lineWidth = 3;
        ctx.strokeRect(ox, oy, 56, 56);
      });
      setUrl(c.toDataURL('image/png'));
    }, 50);
    return () => window.clearTimeout(t);
  }, [open]);

  const share = async () => {
    if (!url) return;
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'blockparty-recap.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'BlockParty recap' });
      else toast.info('Sharing files is not supported here - use Download');
    } catch {
      /* cancelled */
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Room recap" wide>
      <div className="flex flex-col gap-3">
        <canvas ref={canvas} className="aspect-[1200/630] w-full bg-black" aria-label="Recap card preview" role="img" />
        <div className="flex justify-end gap-2">
          {url ? (
            <a href={url} download="blockparty-recap.png" className="font-label pixel-corners-sm inline-flex h-10 items-center bg-teal-500 px-4 text-xs text-ink hover:bg-teal-400">
              Download PNG
            </a>
          ) : null}
          <GlassButton icon="send" onClick={() => void share()} disabled={!url}>
            Share
          </GlassButton>
        </div>
      </div>
    </Modal>
  );
}
