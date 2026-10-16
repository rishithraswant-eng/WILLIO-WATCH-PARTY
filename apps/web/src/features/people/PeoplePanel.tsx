'use client';

import { useMemo } from 'react';
import { Avatar, Badge } from '@/components/ui/Bits';
import { GlassButton } from '@/components/ui/Glass';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { useRoomClient } from '@/features/room/context';
import { cx } from '@/lib/util';
import { selectMyRole, useRoom } from '@/store/room';

export function PeoplePanel() {
  const client = useRoomClient();
  const participants = useRoom((s) => s.participants);
  const me = useRoom((s) => s.me);
  const role = useRoom(selectMyRole);
  const hostId = useRoom((s) => s.room?.hostId ?? null);
  const requests = useRoom((s) => s.hostRequests);
  const metrics = useRoom((s) => s.metrics);
  const people = useMemo(
    () =>
      Object.values(participants).sort(
        (a, b) => Number(b.id === hostId) - Number(a.id === hostId) || Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt,
      ),
    [participants, hostId],
  );
  const online = people.filter((p) => p.connected).length;
  const isHost = role === 'HOST';
  const hostOnline = !!hostId && !!participants[hostId]?.connected;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="font-label text-[10px] text-mid">
          {online} online - {people.length} in room
        </p>
        {!isHost ? (
          <GlassButton size="sm" icon="crown" onClick={() => void client.hostRequest()}>
            {hostOnline ? 'Request host' : 'Claim host'}
          </GlassButton>
        ) : null}
      </div>
      {isHost && requests.length > 0 ? (
        <ul className="mx-3 mb-2 flex flex-col gap-1.5" aria-label="Host requests">
          {requests.map((r) => (
            <li key={r.userId} className="pixel-corners-sm flex items-center justify-between gap-2 bg-lantern/15 px-2 py-1.5 text-sm">
              <span className="truncate">
                <strong>{r.name}</strong> wants the crown
              </span>
              <span className="flex gap-1">
                <GlassButton size="sm" variant="lantern" onClick={() => void client.hostRespond(r.userId, true)}>
                  Give
                </GlassButton>
                <GlassButton size="sm" variant="ghost" onClick={() => void client.hostRespond(r.userId, false)}>
                  Deny
                </GlassButton>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="scroll-thin flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2" aria-label="Participants">
        {people.map((p) => {
          const m = metrics?.users.find((u) => u.id === p.id);
          const isMe = p.id === me?.id;
          return (
            <li key={p.id} className={cx('flex items-center gap-2.5 px-2 py-1.5', !p.connected && 'opacity-50')}>
              <Avatar seed={p.avatarSeed} size={32} name={p.name} online={p.connected} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm text-hi">
                  {p.name}
                  {isMe ? <span className="text-[10px] text-lo">(you)</span> : null}
                  {p.id === hostId ? <PixelIcon name="crown" size={12} className="text-lantern" title="Host" /> : null}
                  {p.role === 'MOD' ? <PixelIcon name="shield" size={12} className="text-sky" title="Moderator" /> : null}
                </p>
                <p className="text-[11px] text-lo">
                  {p.connected ? (p.hasTaste ? 'shared taste picks' : 'watching') : 'reconnecting...'}
                  {m?.drift != null ? <span className="font-mono"> - {Math.round(m.drift)}ms</span> : null}
                </p>
              </div>
              {p.id === hostId ? <Badge tone="lantern">host</Badge> : null}
              {isHost && !isMe && p.connected ? (
                <div className="flex gap-1">
                  <GlassButton size="sm" variant="ghost" title={`Make ${p.name} the host`} onClick={() => void client.hostTransfer(p.id)}>
                    Crown
                  </GlassButton>
                  <GlassButton
                    size="sm"
                    variant="ghost"
                    title={p.role === 'MOD' ? 'Remove moderator' : 'Make moderator'}
                    onClick={() => void client.setRole(p.id, p.role === 'MOD' ? 'VIEWER' : 'MOD')}
                  >
                    {p.role === 'MOD' ? 'Unmod' : 'Mod'}
                  </GlassButton>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
