'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ROOM_CODE_REGEX } from '@willio/shared';
import { GlassButton, GlassPanel } from '@/components/ui/Glass';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { ProfileModal } from '@/features/landing/ProfileModal';
import { SyncHealthDrawer } from '@/features/sync/SyncHealthDrawer';
import { api, ApiError, type JoinRoomResponse, type RoomPreview } from '@/lib/api';
import { loadProfile, saveProfile, type Profile } from '@/lib/profile';
import { RoomClient, type FatalKind } from '@/lib/roomClient';
import { sessions } from '@/lib/storage';
import { isTypingTarget } from '@/lib/util';
import { usePrefs } from '@/store/prefs';
import { useRoom } from '@/store/room';
import { toast } from '@/store/toasts';
import { RoomClientContext } from './context';
import { PlayerWindow } from './PlayerWindow';
import { ReactionHotbar } from './Reactions';
import { ConnectionBanner, RoomTopBar, Sidebar } from './RoomChrome';
import { InviteModal, RecapModal, SettingsModal } from './RoomModals';

/**
 * Concurrent joins for the same room share one REST call (React StrictMode runs effects twice in dev;
 * two parallel joins from a fresh tab would otherwise mint two identities).
 */
const pendingJoins = new Map<string, Promise<JoinRoomResponse>>();

function joinOnce(code: string, body: Parameters<typeof api.joinRoom>[1]): Promise<JoinRoomResponse> {
  const key = `${code}:${body.name}:${body.avatarSeed}`;
  let p = pendingJoins.get(key);
  if (!p) {
    p = api.joinRoom(code, body);
    pendingJoins.set(key, p);
    const clear = () => window.setTimeout(() => pendingJoins.delete(key), 3000);
    p.then(clear, clear);
  }
  return p;
}

type Stage =
  | { kind: 'checking' }
  | { kind: 'profile'; preview: RoomPreview; passwordError?: string | null }
  | { kind: 'joining' }
  | { kind: 'live'; client: RoomClient }
  | { kind: 'not-found' }
  | { kind: 'full' }
  | { kind: 'error'; message: string };

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4">
      <GlassPanel className="flex max-w-md flex-col items-center gap-4 p-8 text-center" blur="lg">
        {children}
      </GlassPanel>
    </main>
  );
}

function RoomLayout({ client, code }: { client: RoomClient; code: string }) {
  const [invite, setInvite] = useState(false);
  const [health, setHealth] = useState(false);
  const [settings, setSettings] = useState(false);
  const [recap, setRecap] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const phase = useRoom((s) => s.phase);
  const amHost = useRoom((s) => !!s.me && s.room?.hostId === s.me.id);
  const playHandled = useRef(false);

  // /r/CODE?play=movieId (from Discover "Watch together"): the host starts it once live.
  useEffect(() => {
    if (phase !== 'live' || !amHost || playHandled.current) return;
    playHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const play = params.get('play');
    if (play) {
      void client.loadMovie(play);
      window.history.replaceState(null, '', `/r/${code}`);
    }
  }, [phase, amHost, client, code]);

  // Keyboard shortcuts (PRD 7): Space, arrows, M, F, R, H.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const s = useRoom.getState();
      const prefs = usePrefs.getState();
      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
        e.preventDefault();
        const playing = (s.optimisticStatus ?? s.state?.status) === 'PLAYING';
        void (playing ? client.pause() : client.play());
      } else if (key === 'arrowright' || key === 'arrowleft') {
        if ((e.target as HTMLElement)?.getAttribute('role') === 'slider') return;
        e.preventDefault();
        void client.seek(Math.max(0, client.position() + (key === 'arrowright' ? 5 : -5)));
      } else if (key === 'arrowup' || key === 'arrowdown') {
        e.preventDefault();
        prefs.set('volume', Math.min(1, Math.max(0, prefs.volume + (key === 'arrowup' ? 0.1 : -0.1))));
      } else if (key === 'm') prefs.set('muted', !prefs.muted);
      else if (key === 'f') {
        const el = fullscreenRef.current;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el?.requestFullscreen?.().catch(() => undefined);
      } else if (key === 'r') void client.resync();
      else if (key === 'h') setHealth((h) => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client]);

  const closeHealth = useCallback(() => setHealth(false), []);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <RoomTopBar code={code} onInvite={() => setInvite(true)} onHealth={() => setHealth(true)} onSettings={() => setSettings(true)} />
      <main id="main" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:scroll-thin [&>*]:shrink-0">
          <ConnectionBanner />
          <PlayerWindow onRecap={() => setRecap(true)} fullscreenRef={fullscreenRef} />
          <ReactionHotbar />
        </section>
        <Sidebar />
      </main>
      <InviteModal open={invite} onClose={() => setInvite(false)} code={code} />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
      <RecapModal open={recap} onClose={() => setRecap(false)} />
      <SyncHealthDrawer open={health} onClose={closeHealth} />
    </div>
  );
}

export function RoomView({ code: rawCode }: { code: string }) {
  const code = rawCode.toUpperCase();
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const phase = useRoom((s) => s.phase);
  const clientRef = useRef<RoomClient | null>(null);

  // Dim the world while inside a room.
  useEffect(() => {
    document.documentElement.dataset.world = 'dim';
    return () => {
      delete document.documentElement.dataset.world;
    };
  }, []);

  const start = useCallback(
    (token: string, profile: Profile | null) => {
      clientRef.current?.dispose();
      useRoom.getState().reset(code);
      const client = new RoomClient({
        code,
        token,
        taste: profile?.taste ?? null,
        onFatal: (kind: FatalKind, message: string) => {
          if (kind === 'unauthorized') {
            sessions.clear(code);
            client.dispose();
            void begin();
          } else if (kind === 'not-found') setStage({ kind: 'not-found' });
          else if (kind === 'full') setStage({ kind: 'full' });
          else setStage({ kind: 'error', message });
        },
      });
      clientRef.current = client;
      client.connect();
      setStage({ kind: 'live', client });
    },
    // begin is defined below and stable for the component lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code],
  );

  const join = useCallback(
    async (profile: Profile, password?: string) => {
      setBusy(true);
      try {
        const res = await joinOnce(code, {
          name: profile.name,
          avatarSeed: profile.avatarSeed,
          password,
          token: sessions.lastToken() ?? undefined,
        });
        sessions.set(code, { token: res.token, userId: res.userId });
        start(res.token, profile);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'BAD_PASSWORD') {
          setStage((s) => (s.kind === 'profile' ? { ...s, passwordError: err.message } : s));
        } else if (err instanceof ApiError && err.code === 'NOT_FOUND') setStage({ kind: 'not-found' });
        else if (err instanceof ApiError && err.code === 'ROOM_FULL') setStage({ kind: 'full' });
        else setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Could not join' });
      } finally {
        setBusy(false);
      }
    },
    [code, start],
  );

  const begin = useCallback(async () => {
    if (!ROOM_CODE_REGEX.test(code)) {
      setStage({ kind: 'not-found' });
      return;
    }
    setStage({ kind: 'checking' });
    let preview: RoomPreview;
    try {
      preview = await api.getRoom(code);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.code === 'INVALID')) setStage({ kind: 'not-found' });
      else setStage({ kind: 'error', message: err instanceof Error ? err.message : 'Server unreachable' });
      return;
    }
    const session = sessions.get(code);
    if (session) {
      start(session.token, loadProfile());
      return;
    }
    // ?name=Bob skips the modal (handy for demos and E2E tests).
    const qName = new URLSearchParams(window.location.search).get('name');
    if (qName && !preview.room.hasPassword) {
      const saved = loadProfile();
      const name = qName.slice(0, 24);
      // Stable seed (same name -> same avatar) so duplicate effect runs share one join.
      const p: Profile = {
        ...(saved ?? { likedIds: [], genres: [], runtimeMax: null, taste: null }),
        name,
        avatarSeed: saved?.name === name ? saved.avatarSeed : `${name}-${code}`.toLowerCase(),
      };
      saveProfile(p);
      void join(p);
      return;
    }
    setStage({ kind: 'profile', preview });
  }, [code, start, join]);

  useEffect(() => {
    void begin();
    return () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    };
    // run once per room code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (stage.kind === 'not-found') {
    return (
      <CenterCard>
        <div className="font-pixel text-3xl text-danger">VOID</div>
        <h1 className="font-heading text-gradient text-3xl font-semibold">You fell into the void</h1>
        <p className="text-sm text-mid">
          Room <span className="font-mono text-hi">{code}</span> does not exist or has expired (rooms close 6h after the last person leaves).
        </p>
        <Link href="/" className="font-label pixel-corners-sm inline-flex h-10 items-center gap-2 bg-teal-500 px-4 text-xs text-ink hover:bg-teal-400">
          <PixelIcon name="plus" size={12} /> Create a new room
        </Link>
      </CenterCard>
    );
  }
  if (stage.kind === 'full') {
    return (
      <CenterCard>
        <PixelIcon name="people" size={32} className="text-warn" />
        <h1 className="font-heading text-gradient text-2xl font-semibold">This room is full</h1>
        <p className="text-sm text-mid">Ask the host for a spot, or start your own party.</p>
        <Link href="/" className="font-label text-xs text-teal-400 underline">
          Back home
        </Link>
      </CenterCard>
    );
  }
  if (stage.kind === 'error') {
    return (
      <CenterCard>
        <PixelIcon name="warning" size={32} className="text-warn" />
        <h1 className="font-heading text-gradient text-2xl font-semibold">Couldn&apos;t join</h1>
        <p className="text-sm text-mid">{stage.message}</p>
        <GlassButton variant="primary" icon="refresh" onClick={() => void begin()}>
          Try again
        </GlassButton>
      </CenterCard>
    );
  }
  if (stage.kind === 'live') {
    if (phase === 'replaced') {
      return (
        <CenterCard>
          <PixelIcon name="copy" size={32} className="text-lantern" />
          <h1 className="font-heading text-gradient text-2xl font-semibold">Opened in another tab</h1>
          <p className="text-sm text-mid">This session is now active somewhere else. Only one tab per session can be in the room.</p>
          <GlassButton
            variant="primary"
            onClick={() => {
              stage.client.reclaim();
              toast.info('Taking this tab back...');
            }}
          >
            Use this tab instead
          </GlassButton>
        </CenterCard>
      );
    }
    return (
      <RoomClientContext.Provider value={stage.client}>
        <RoomLayout client={stage.client} code={code} />
      </RoomClientContext.Provider>
    );
  }
  return (
    <>
      <CenterCard>
        <p className="font-pixel text-xs text-hi">GENERATING TERRAIN</p>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-3 w-3 animate-pulse bg-emerald" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
        <p className="text-sm text-mid">{stage.kind === 'profile' ? `Joining ${stage.preview.room.name}` : 'Finding room ' + code + '...'}</p>
      </CenterCard>
      <ProfileModal
        open={stage.kind === 'profile'}
        onClose={() => window.location.assign('/')}
        title={stage.kind === 'profile' ? `Join "${stage.preview.room.name}"` : 'Join'}
        submitLabel="Join the party"
        askPassword={stage.kind === 'profile' && stage.preview.room.hasPassword}
        passwordError={stage.kind === 'profile' ? stage.passwordError : null}
        busy={busy}
        onDone={({ profile, password }) => void join(profile, password)}
      />
    </>
  );
}
