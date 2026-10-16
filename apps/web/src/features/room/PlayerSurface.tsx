'use client';

import { useEffect, useRef } from 'react';
import type { MediaSource } from '@blockparty/shared';
import { Html5Adapter } from '@/lib/player/html5';
import type { PlayerAdapter } from '@/lib/player/types';
import { YouTubeAdapter } from '@/lib/player/youtube';
import { useRoom } from '@/store/room';
import { useRoomClient } from './context';

/** Creates the right adapter for the media and hands it to the sync engine. Keyed by media id. */
export function PlayerSurface({ media }: { media: MediaSource }) {
  const client = useRoomClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytRef = useRef<HTMLDivElement>(null);
  const isYouTube = media.type === 'YOUTUBE';

  useEffect(() => {
    let adapter: PlayerAdapter | null = null;
    if (isYouTube && ytRef.current) adapter = new YouTubeAdapter(ytRef.current);
    else if (!isYouTube && videoRef.current) adapter = new Html5Adapter(videoRef.current);
    if (!adapter) return;
    client.attachAdapter(adapter, media.id);
    adapter.load(media).catch((err: unknown) => {
      useRoom.setState((s) => ({ sync: { ...s.sync, mediaError: err instanceof Error ? err.message : 'Could not load this video' } }));
    });
    return () => {
      client.detachAdapter(adapter!);
      adapter!.destroy();
    };
    // media object identity changes with every state update; only reload when the source changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, media.id, media.url, media.type, isYouTube]);

  return isYouTube ? (
    <div ref={ytRef} className="absolute inset-0 [&_iframe]:pointer-events-none" />
  ) : (
    <video
      ref={videoRef}
      className="absolute inset-0 h-full w-full bg-black object-contain"
      playsInline
      preload="auto"
      aria-label={`Video: ${media.title}`}
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
