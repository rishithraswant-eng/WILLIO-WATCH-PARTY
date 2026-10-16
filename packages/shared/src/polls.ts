import type { PollOption, TieBreak } from './types';

export function tallyVotes(options: readonly PollOption[], votes: Iterable<[string, string]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of options) counts[o.id] = 0;
  for (const [, optionId] of votes) {
    if (optionId in counts) counts[optionId] = (counts[optionId] ?? 0) + 1;
  }
  return counts;
}

export interface WinnerDecision {
  winnerId: string | null;
  tie: boolean;
}

/**
 * Highest count wins. Ties are broken by the host's vote when it is among the tied options
 * (tieBreak HOST_VOTE), otherwise uniformly at random. No votes = no winner.
 */
export function decideWinner(
  counts: Record<string, number>,
  opts: { tieBreak: TieBreak; hostVote: string | null; random: () => number },
): WinnerDecision {
  const entries = Object.entries(counts);
  const max = Math.max(0, ...entries.map(([, c]) => c));
  if (max === 0) return { winnerId: null, tie: false };
  const top = entries.filter(([, c]) => c === max).map(([id]) => id);
  if (top.length === 1) return { winnerId: top[0]!, tie: false };
  if (opts.tieBreak === 'HOST_VOTE' && opts.hostVote && top.includes(opts.hostVote)) {
    return { winnerId: opts.hostVote, tie: true };
  }
  const idx = Math.min(top.length - 1, Math.floor(opts.random() * top.length));
  return { winnerId: top[idx]!, tie: true };
}
