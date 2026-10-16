'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEMO_ROOM_CODE, SYNC } from '@willio/shared';
import { TopBar } from '@/components/TopBar';
import { ArcGauge, Kbd } from '@/components/ui/Bits';
import { GlassButton, GlassPanel } from '@/components/ui/Glass';
import { Modal } from '@/components/ui/Modal';
import { PixelIcon, type IconName } from '@/components/ui/PixelIcon';
import { api, ApiError } from '@/lib/api';
import { loadProfile } from '@/lib/profile';
import { sessions } from '@/lib/storage';
import { toast } from '@/store/toasts';
import { JoinCodeInput } from './JoinCodeInput';
import { ProfileModal } from './ProfileModal';

function LiveGauge() {
  const [p95, setP95] = useState<number | null>(null);
  const [source, setSource] = useState<'live' | 'bench' | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .stats()
        .then((s) => {
          if (!alive) return;
          if (s.p95 != null) {
            setP95(s.p95);
            setSource('live');
          } else if (s.benchP95 != null) {
            setP95(s.benchP95);
            setSource('bench');
          }
        })
        .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  const target = 250;
  const score = p95 == null ? null : Math.max(0, Math.min(100, 100 - (p95 / target) * 100));
  return (
    <GlassPanel className="flex flex-col items-center gap-1 p-5" spotlight>
      <ArcGauge value={score} label="sync headroom" size={168} caption={undefined} />
      <p className="font-mono text-center text-sm text-hi">
        p95 {p95 == null ? '--' : `${Math.round(p95)} ms`}
      </p>
      <p className="text-center text-xs text-mid">
        {source === 'live'
          ? 'live control propagation, rolling 5 min'
          : source === 'bench'
            ? 'from the latest bench run'
            : 'run a room or `npm run bench`'}
        <br />
        target &le; {target} ms (LAN)
      </p>
    </GlassPanel>
  );
}

const ACTIONS: { icon: IconName; title: string; text: string; cta: string; key: string }[] = [
  {
    icon: 'plus',
    title: 'Create',
    text: 'Spin up a room, get a 6-char code + QR. You are the host.',
    cta: 'New room',
    key: 'create',
  },
  {
    icon: 'link',
    title: 'Join',
    text: 'Got a code or link? Hop in - late joiners land in sync in < 3s.',
    cta: 'Demo room',
    key: 'demo',
  },
  {
    icon: 'compass',
    title: 'Discover',
    text: 'Fuzzy search 400+ films, filters, moods, Group Taste Fusion.',
    cta: 'Browse',
    key: 'discover',
  },
  {
    icon: 'chart',
    title: 'How sync works',
    text: 'Server anchors, clock sync, scheduled starts, drift control.',
    cta: 'Learn',
    key: 'how',
  },
];

/** `topBar={false}` when the page renders its own fixed header (the home route, over the scroll hero). */
export function LandingView({ topBar = true }: { topBar?: boolean }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [profileOpen, setProfileOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // /?create=1 (from Discover 'Watch together' without a profile) opens the profile modal.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('create') === '1') setProfileOpen(true);
  }, []);

  const createRoom = async (profileArg?: ReturnType<typeof loadProfile>) => {
    const profile = profileArg ?? loadProfile();
    if (!profile) {
      setProfileOpen(true);
      return;
    }
    setCreating(true);
    try {
      const res = await api.createRoom({
        name: profile.name,
        avatarSeed: profile.avatarSeed,
        token: sessions.lastToken() ?? undefined,
      });
      sessions.set(res.code, { token: res.token, userId: res.userId });
      router.push(`/r/${res.code}`);
    } catch (err) {
      toast.error('Could not create a room', err instanceof ApiError ? err.message : 'Unknown error');
      setCreating(false);
    }
  };

  const onAction = (key: string) => {
    if (key === 'create') void createRoom();
    else if (key === 'demo') router.push(`/r/${DEMO_ROOM_CODE}`);
    else if (key === 'discover') router.push('/discover');
    else setHowOpen(true);
  };

  return (
    <div className="flex min-h-screen flex-col">
      {topBar ? <TopBar /> : <div className="h-[68px] shrink-0" aria-hidden />}
      <main
        id="main"
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-10 pt-4 sm:px-6 lg:pt-10"
      >
        <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_260px]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <GlassPanel className="flex h-full flex-col gap-6 p-6 sm:p-10" blur="lg" spotlight>
              <span className="font-pixel w-fit bg-teal-400/15 px-2 py-1 text-[9px] text-teal-400">
                REAL-TIME WATCH PARTIES
              </span>
              <h1 className="font-heading text-gradient text-4xl font-semibold leading-[1.05] sm:text-6xl">
                Same world.
                <br />
                Same frame.
              </h1>
              <p className="max-w-xl text-base text-mid sm:text-lg">
                Watch together with 25+ friends in frame-accurate sync. Chat, react, vote and build the queue
                - while a server-authoritative sync engine keeps everyone within a few milliseconds.
              </p>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
                <GlassButton
                  variant="primary"
                  size="lg"
                  icon="plus"
                  onClick={() => void createRoom()}
                  loading={creating}
                >
                  Create room
                </GlassButton>
                <div className="flex flex-col gap-2">
                  <span className="font-label text-[10px] text-mid">Join with code</span>
                  <JoinCodeInput onComplete={(code) => router.push(`/r/${code}`)} />
                </div>
              </div>
              <p className="text-xs text-lo">
                Tip: paste an invite link into the boxes. In a room press <Kbd>Space</Kbd> to play/pause and{' '}
                <Kbd>R</Kbd> to resync.
              </p>
            </GlassPanel>
          </motion.div>
          <LiveGauge />
        </div>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ACTIONS.map((a, i) => (
            <motion.li
              key={a.key}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 * i + 0.15, duration: 0.3 }}
            >
              <GlassPanel className="flex h-full flex-col gap-3 p-5" spotlight>
                <span className="pixel-corners-sm flex h-10 w-10 items-center justify-center bg-teal-400/15 text-teal-400">
                  <PixelIcon name={a.icon} size={18} />
                </span>
                <h2 className="font-heading text-xl font-semibold text-hi">{a.title}</h2>
                <p className="flex-1 text-sm text-mid">{a.text}</p>
                <GlassButton variant="pill" size="sm" className="w-fit" onClick={() => onAction(a.key)}>
                  {a.cta}
                </GlassButton>
              </GlassPanel>
            </motion.li>
          ))}
        </ul>
      </main>

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Create your room"
        submitLabel="Create room"
        busy={creating}
        onDone={({ profile }) => {
          setProfileOpen(false);
          void createRoom(profile);
        }}
      />

      <Modal open={howOpen} onClose={() => setHowOpen(false)} title="How sync works" wide>
        <ol className="flex flex-col gap-3 text-sm text-mid">
          {[
            [
              'Clock sync',
              `On join each browser sends ${SYNC.clockBurst} NTP-style pings, keeps the ${SYNC.clockKeep} fastest and takes the median offset - then re-measures every ${SYNC.clockIntervalMs / 1000}s.`,
            ],
            [
              'Server-authoritative anchors',
              'The server owns {status, anchorPos, anchorTime, rate}. Clients never stream positions - they compute pos = anchorPos + (now - anchorTime) x rate.',
            ],
            [
              'Scheduled execution',
              `Every play/pause/seek is scheduled ${SYNC.leadMinMs}-${SYNC.leadMaxMs}ms in the future (adaptive to the worst RTT), so all clients flip on the same wall-clock moment even if packets arrive at different times.`,
            ],
            [
              'Drift control',
              `Every ${SYNC.driftLoopMs}ms: under ${SYNC.driftIdleMs}ms do nothing, up to ${SYNC.driftHardMs}ms nudge playbackRate by up to ${SYNC.nudgeMax * 100}%, beyond that hard-seek with seek-latency compensation.`,
            ],
            [
              'Reliability',
              'Sequence numbers, idempotent event ids, a 300-event replay ring for reconnects, host succession after a 10s grace, snapshots for server restarts.',
            ],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="font-pixel mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center bg-lantern text-[9px] text-ink">
                {i + 1}
              </span>
              <span>
                <strong className="text-hi">{t}.</strong> {d}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex justify-end">
          <GlassButton variant="primary" onClick={() => router.push('/bench')}>
            See the measurements
          </GlassButton>
        </div>
      </Modal>
    </div>
  );
}
