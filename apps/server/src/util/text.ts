import { randomInt } from 'node:crypto';
import { LIMITS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@blockparty/shared';

/** Cryptographically random, unambiguous 6-char room code. */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

// Control chars (except newline), zero-width chars and bidi overrides (spoofing). Built from code points so
// the source itself never contains invisible characters.
const UNSAFE_RANGES: [number, number][] = [
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const UNSAFE = new RegExp(
  `[${UNSAFE_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')}]`,
  'gu',
);

/**
 * Normalises chat text. Rendering is always escaped by React (no dangerouslySetInnerHTML),
 * so this is about hygiene: strip invisible/bidi characters, collapse whitespace, cap length.
 */
export function sanitizeChat(text: string): string {
  return text
    .replace(UNSAFE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, LIMITS.chatMaxLen);
}

export function sanitizeLine(text: string, max: number): string {
  return text.replace(UNSAFE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Extract @mentions that match participant names (case-insensitive, spaces allowed via exact name match). */
export function findMentions(text: string, names: { id: string; name: string }[]): string[] {
  const lower = text.toLowerCase();
  const ids = new Set<string>();
  for (const p of names) {
    const handle = `@${p.name.toLowerCase()}`;
    let idx = lower.indexOf(handle);
    while (idx >= 0) {
      const after = lower[idx + handle.length];
      if (after === undefined || !/[\p{L}\p{N}_]/u.test(after)) {
        ids.add(p.id);
        break;
      }
      idx = lower.indexOf(handle, idx + 1);
    }
  }
  return [...ids];
}

export type SlashCommand =
  | { kind: 'shrug'; rest: string }
  | { kind: 'poll'; question: string; options: string[] }
  | { kind: 'skip' }
  | { kind: 'help' }
  | { kind: 'unknown'; name: string };

/** Parses /shrug, /poll "question" a | b | c, /skip, /help. Returns null for normal messages. */
export function parseSlash(text: string): SlashCommand | null {
  if (!text.startsWith('/')) return null;
  const m = text.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const rest = (m[2] ?? '').trim();
  switch (name) {
    case 'shrug':
      return { kind: 'shrug', rest };
    case 'skip':
      return { kind: 'skip' };
    case 'help':
      return { kind: 'help' };
    case 'poll': {
      const q = rest.match(/^"([^"]{1,140})"\s*([\s\S]*)$/) ?? rest.match(/^([^|]{1,140}?)\?\s*([\s\S]*)$/);
      if (!q) return { kind: 'poll', question: '', options: [] };
      const question = q[1]!.trim() + (rest.startsWith('"') ? '' : '?');
      const options = (q[2] ?? '')
        .split('|')
        .map((o) => o.trim())
        .filter(Boolean)
        .slice(0, LIMITS.pollOptionsMax);
      return { kind: 'poll', question, options };
    }
    default:
      return { kind: 'unknown', name };
  }
}
