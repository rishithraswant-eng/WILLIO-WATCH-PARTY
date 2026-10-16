'use client';

import { useState, type ReactNode } from 'react';
import { REACTION_EMOJIS } from '@willio/shared';
import { TopBar } from '@/components/TopBar';
import { ArcGauge, Avatar, Badge, Chip, Hearts, Kbd, ProgressBar, Skeleton, Sparkline, Tooltip } from '@/components/ui/Bits';
import { GlassButton, GlassPanel, IconButton } from '@/components/ui/Glass';
import { Input, Select, Slider, Switch } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { PixelIcon, type IconName } from '@/components/ui/PixelIcon';
import { Tabs } from '@/components/ui/Tabs';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { PixelPoster } from '@/features/discover/PixelPoster';
import { toast } from '@/store/toasts';

const ICONS: IconName[] = [
  'play', 'pause', 'volume', 'mute', 'fullscreen', 'crown', 'lock', 'copy', 'link', 'qr', 'chat', 'queue', 'poll', 'people',
  'compass', 'heart', 'gear', 'bolt', 'refresh', 'close', 'check', 'plus', 'trash', 'up', 'grip', 'search', 'send', 'chart',
  'user', 'warning', 'captions', 'dice', 'star', 'next', 'shield', 'clock', 'menu',
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <GlassPanel as="section" className="flex flex-col gap-3 p-5" aria-label={title}>
      <h2 className="font-heading text-gradient text-xl font-semibold">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </GlassPanel>
  );
}

export function UiGallery() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
  const [sw, setSw] = useState(true);
  const [slider, setSlider] = useState(40);
  const [modal, setModal] = useState(false);
  return (
    <div className="min-h-screen">
      <TopBar />
      <main id="main" className="mx-auto grid max-w-7xl gap-4 px-4 pb-12 sm:px-6 lg:grid-cols-2">
        <Section title="Buttons">
          <GlassButton variant="primary" icon="play">
            Primary
          </GlassButton>
          <GlassButton>Secondary</GlassButton>
          <GlassButton variant="danger">Danger</GlassButton>
          <GlassButton variant="ghost">Ghost</GlassButton>
          <GlassButton variant="pill">Pill</GlassButton>
          <GlassButton variant="lantern" icon="star">
            Lantern
          </GlassButton>
          <GlassButton loading>Loading</GlassButton>
          <IconButton icon="gear" label="Icon button" />
          <IconButton icon="crown" label="Active" active />
        </Section>
        <Section title="Theme toggle, tabs, chips, badges">
          <ThemeToggle />
          <Tabs
            idPrefix="demo"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'a', label: 'Chat', icon: 'chat', badge: 3 },
              { id: 'b', label: 'Queue', icon: 'queue' },
              { id: 'c', label: 'Polls', icon: 'poll' },
            ]}
          />
          <Chip active>Sci-Fi</Chip>
          <Chip onClick={() => undefined}>Comedy</Chip>
          <Badge tone="ok">in sync</Badge>
          <Badge tone="warn">nudging</Badge>
          <Badge tone="danger">hard seek</Badge>
          <Kbd>Space</Kbd>
          <Tooltip label="Pixel arrow tooltip">
            <GlassButton size="sm">Hover me</GlassButton>
          </Tooltip>
        </Section>
        <Section title="Inputs">
          <Input label="Search" icon="search" placeholder="Pixel caret blinks here" />
          <Select label="Select">
            <option>Host only</option>
            <option>Everyone</option>
          </Select>
          <div className="w-60">
            <Slider label="Slider" min={0} max={100} value={slider} onChange={setSlider} />
          </div>
          <div className="w-60">
            <Switch checked={sw} onChange={setSw} label="Switch" description="With description" />
          </div>
        </Section>
        <Section title="Data display">
          <ArcGauge value={87} label="room in sync" />
          <div className="flex w-64 flex-col gap-3">
            <ProgressBar value={65} label="XP bar" />
            <Sparkline values={[0, 40, -20, 120, 80, 30, -10, 5, 2]} width={200} height={40} />
            <Hearts rating={7.5} />
            <Skeleton className="h-10 w-full" />
          </div>
        </Section>
        <Section title="Avatars & posters">
          {['steve', 'alex', 'priya', 'aman', 'zoe', 'kai'].map((s) => (
            <Avatar key={s} seed={s} size={48} name={s} online={s !== 'zoe'} />
          ))}
          {['open-bbb', 'bp-inception-2010', 'bp-coco-2017'].map((id, i) => (
            <div key={id} className="h-36 w-24">
              <PixelPoster id={id} genres={[['Animation'], ['Sci-Fi'], ['Family']][i]!} title={['Big Buck Bunny', 'Inception', 'Coco'][i]!} posterUrl={null} />
            </div>
          ))}
        </Section>
        <Section title="Feedback">
          <GlassButton onClick={() => toast.achievement('Everyone in sync!', '12 players within 40ms', '✅')}>Achievement toast</GlassButton>
          <GlassButton onClick={() => toast.warn('Waiting for Aman...', 'Their video is buffering')}>Warn toast</GlassButton>
          <GlassButton onClick={() => toast.error('Something broke')}>Error toast</GlassButton>
          <GlassButton onClick={() => setModal(true)}>Open modal</GlassButton>
          <Modal open={modal} onClose={() => setModal(false)} title="Glass modal">
            <p className="text-sm text-mid">28px blur, scale-in, focus trap, Esc closes.</p>
          </Modal>
        </Section>
        <Section title="Hotbar slots">
          {REACTION_EMOJIS.map((e, i) => (
            <span key={e} data-selected={i === 2} className="hotbar-slot flex h-11 w-11 items-center justify-center bg-black/30 text-xl">
              {e}
            </span>
          ))}
        </Section>
        <Section title="Pixel icons">
          {ICONS.map((n) => (
            <span key={n} className="flex w-16 flex-col items-center gap-1 text-[10px] text-mid">
              <PixelIcon name={n} size={20} className="text-hi" />
              {n}
            </span>
          ))}
        </Section>
      </main>
    </div>
  );
}
