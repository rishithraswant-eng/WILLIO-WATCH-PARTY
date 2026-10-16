import type { ControlMode, QueueMode, Role } from './types';

export type ControlDecision = 'ALLOW' | 'VOTE' | 'DENY';

const isStaff = (role: Role): boolean => role === 'HOST' || role === 'MOD';

/** play / pause / seek: host & mods always; viewers depending on the room control mode. */
export function playbackPermission(role: Role, mode: ControlMode): ControlDecision {
  if (isStaff(role) || mode === 'EVERYONE') return 'ALLOW';
  return mode === 'VOTE' ? 'VOTE' : 'DENY';
}

/** Playback speed affects everyone's experience: staff only. */
export const canChangeRate = (role: Role): boolean => isStaff(role);

/** Adding and upvoting is always open; reorder / remove / play-now depends on queueMode. */
export function canManageQueue(role: Role, mode: QueueMode): boolean {
  return isStaff(role) || mode === 'EVERYONE';
}

export const canRemoveQueueItem = (role: Role, mode: QueueMode, isOwner: boolean): boolean =>
  isOwner || canManageQueue(role, mode);

export const canClosePoll = (role: Role, isCreator: boolean): boolean => isCreator || isStaff(role);
export const canEditSettings = (role: Role): boolean => role === 'HOST';
export const canTransferHost = (role: Role): boolean => role === 'HOST';
export const canSetRoles = (role: Role): boolean => role === 'HOST';
export const canIntermission = (role: Role): boolean => isStaff(role);
export const canUseChaos = (role: Role): boolean => role === 'HOST';
