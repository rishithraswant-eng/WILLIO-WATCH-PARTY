'use client';

import { createContext, useContext } from 'react';
import { playbackPermission, type ControlDecision } from '@blockparty/shared';
import type { RoomClient } from '@/lib/roomClient';
import { selectMyRole, useRoom } from '@/store/room';

export const RoomClientContext = createContext<RoomClient | null>(null);

export function useRoomClient(): RoomClient {
  const c = useContext(RoomClientContext);
  if (!c) throw new Error('useRoomClient outside of a room');
  return c;
}

/** Whether this user may control playback: ALLOW, VOTE (creates a poll) or DENY. */
export function useControl(): ControlDecision {
  const role = useRoom(selectMyRole);
  const mode = useRoom((s) => s.room?.settings.controlMode ?? 'HOST_ONLY');
  return playbackPermission(role, mode);
}
