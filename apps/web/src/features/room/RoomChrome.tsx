'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Bits';
import { GlassButton, GlassPanel, IconButton } from '@/components/ui/Glass';
import { LogoCube } from '@/components/ui/Logo';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { DiscoverView } from '@/features/discover/DiscoverView';
import { PeoplePanel } from '@/features/people/PeoplePanel';
import { PollsPanel } from '@/features/polls/PollsPanel';
import { QueuePanel } from '@/features/queue/QueuePanel';
import { copyText, cx } from '@/lib/util';
import { useRoom } from '@/store/room';
import { toast } from '@/store/toasts';

export function RoomTopBar({
  code,
  onInvite,
  onHealth,
  onSettings,
}: {
  code: string;
  onInvite: () => void;
  onHealth: () => void;
  onSettings: () => void;
}) {
  const room = useRoom((s) => s.room);
  const hostName = useRoom((s) => (s.room?.hostId ? s.participants[s.room.hostId]?.name : null));
  const amHost = useRoom((s) => !!s.me && s.room?.hostId === s.me.id);
  const online = useRoom((s) => Object.values(s.participants).filter((p) => p.connected).length);
  return (
    <header className="glass glass-sm relative z-20 flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
      <Link href="/" aria-label="Leave room - back to home" className="shrink-0">
        <LogoCube size={26} />
      </Link>
      <div className="min-w-[150px] flex-1">
        <h1 className="font-heading truncate text-lg font-semibold text-hi">{room?.name ?? 'Joining...'}</h1>
        <p className="flex items-center gap-1.5 truncate text-[11px] text-mid">
          <PixelIcon name="crown" size={10} className="text-lantern" />
          {hostName ? (amHost ? 'You are the host' : `Host: ${hostName}`) : 'No host'}
          <span aria-hidden>-</span>
          {online} online
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copyText(code).then((ok) => ok && toast.success('Room code copied', code))}
        className="font-pixel pixel-corners-sm bg-black/30 px-2.5 py-2 text-[11px] tracking-[0.2em] text-teal-400 hover:bg-teal-400/15"
        title="Copy room code"
        aria-label={`Room code ${code.split('').join(' ')} - copy`}
      >
        {code}
      </button>
      <GlassButton size="sm" variant="primary" icon="qr" onClick={onInvite}>
        <span className="hidden sm:inline">Invite</span>
      </GlassButton>
      <GlassButton size="sm" icon="chart" onClick={onHealth} title="Sync Health (H)">
        <span className="hidden md:inline">Sync health</span>
      </GlassButton>
      <IconButton icon="gear" label="Settings" size="sm" onClick={onSettings} />
      <ThemeToggle />
    </header>
  );
}

type TabId = 'chat' | 'queue' | 'polls' | 'people' | 'discover';

export function Sidebar() {
  const [tab, setTab] = useState<TabId>('chat');
  const chatLen = useRoom((s) => s.chat.length);
  const queueLen = useRoom((s) => s.queue.items.length);
  const openPolls = useRoom((s) => Object.values(s.polls).filter((p) => p.status === 'OPEN').length);
  const online = useRoom((s) => Object.values(s.participants).filter((p) => p.connected).length);
  const hostRequests = useRoom((s) => s.hostRequests.length);
  const [seenChat, setSeenChat] = useState(chatLen);

  useEffect(() => {
    if (tab === 'chat') setSeenChat(chatLen);
  }, [tab, chatLen]);

  const tabs: TabDef<TabId>[] = useMemo(
    () => [
      { id: 'chat', label: 'Chat', icon: 'chat', badge: tab === 'chat' ? 0 : Math.max(0, chatLen - seenChat) },
      { id: 'queue', label: 'Queue', icon: 'queue', badge: queueLen },
      { id: 'polls', label: 'Polls', icon: 'poll', badge: openPolls },
      { id: 'people', label: 'People', icon: 'people', badge: hostRequests || online },
      { id: 'discover', label: 'Discover', icon: 'compass' },
    ],
    [tab, chatLen, seenChat, queueLen, openPolls, online, hostRequests],
  );

  return (
    <GlassPanel as="aside" aria-label="Room sidebar" className="flex h-[70vh] min-h-[420px] flex-col overflow-hidden lg:h-full" strong>
      <Tabs tabs={tabs} value={tab} onChange={setTab} idPrefix="room" className="shrink-0 border-b border-white/10 px-1" />
      {(['chat', 'queue', 'polls', 'people', 'discover'] as TabId[]).map((id) => (
        <div
          key={id}
          role="tabpanel"
          id={`room-panel-${id}`}
          aria-labelledby={`room-tab-${id}`}
          hidden={tab !== id}
          className={cx('min-h-0 flex-1', tab === id ? 'flex flex-col' : 'hidden', id === 'discover' && 'scroll-thin overflow-y-auto')}
        >
          {id === 'chat' ? <ChatPanel /> : null}
          {id === 'queue' && tab === id ? <QueuePanel /> : null}
          {id === 'polls' && tab === id ? <PollsPanel /> : null}
          {id === 'people' && tab === id ? <PeoplePanel /> : null}
          {id === 'discover' && tab === id ? <DiscoverView mode="room" /> : null}
        </div>
      ))}
    </GlassPanel>
  );
}

export function ConnectionBanner() {
  const phase = useRoom((s) => s.phase);
  const hasState = useRoom((s) => s.state !== null);
  const outbox = useRoom((s) => s.outbox.length);
  if (!hasState || (phase !== 'offline' && phase !== 'connecting' && phase !== 'clock' && phase !== 'joining')) return null;
  return (
    <div role="status" className="pixel-corners-sm flex items-center justify-center gap-2 bg-warn/90 px-3 py-1.5 text-xs text-ink">
      <PixelIcon name="warning" size={12} />
      {phase === 'offline' ? 'Connection lost - reconnecting with backoff.' : 'Re-syncing with the room...'}
      {outbox > 0 ? <Badge tone="muted">{outbox} message(s) queued</Badge> : null}
    </div>
  );
}
