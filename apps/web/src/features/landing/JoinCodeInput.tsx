'use client';

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { DEMO_ROOM_CODE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@blockparty/shared';
import { cx } from '@/lib/util';

// 'O' only appears in the reserved demo code; the per-box filter lets it through so DEMO42 can be typed.
const VALID = new Set([...ROOM_CODE_ALPHABET.split(''), 'O']);

/** Normalises user input (and pasted invite links) to code characters. */
export function extractCode(raw: string): string {
  const fromUrl = raw.match(/\/r\/([A-Za-z0-9]{6})/);
  if ((fromUrl?.[1] ?? raw).toUpperCase().includes(DEMO_ROOM_CODE)) return DEMO_ROOM_CODE;
  return [...(fromUrl?.[1] ?? raw).toUpperCase()]
    .filter((c) => VALID.has(c))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
}

/** Six pixel boxes that auto-advance, support backspace/arrow navigation and paste. */
export function JoinCodeInput({ onComplete, autoFocus }: { onComplete: (code: string) => void; autoFocus?: boolean }) {
  const [chars, setChars] = useState<string[]>(() => Array(ROOM_CODE_LENGTH).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const commit = (next: string[]) => {
    setChars(next);
    if (next.every((c) => c)) onComplete(next.join(''));
  };

  const setAt = (i: number, value: string) => {
    const clean = extractCode(value);
    if (!clean) return;
    const next = [...chars];
    let j = i;
    for (const c of clean) {
      if (j >= ROOM_CODE_LENGTH) break;
      next[j++] = c;
    }
    commit(next);
    refs.current[Math.min(j, ROOM_CODE_LENGTH - 1)]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...chars];
      if (next[i]) next[i] = '';
      else if (i > 0) {
        next[i - 1] = '';
        refs.current[i - 1]?.focus();
      }
      setChars(next);
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < ROOM_CODE_LENGTH - 1) refs.current[i + 1]?.focus();
    else if (e.key === 'Enter' && chars.every((c) => c)) onComplete(chars.join(''));
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, i: number) => {
    e.preventDefault();
    setAt(i, e.clipboardData.getData('text'));
  };

  return (
    <div className="flex gap-1.5 sm:gap-2" role="group" aria-label="Room code">
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={c}
          autoFocus={autoFocus && i === 0}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={ROOM_CODE_LENGTH}
          aria-label={`Character ${i + 1} of ${ROOM_CODE_LENGTH}`}
          onChange={(e) => setAt(i, e.target.value.slice(-ROOM_CODE_LENGTH))}
          onKeyDown={(e) => onKey(e, i)}
          onPaste={(e) => onPaste(e, i)}
          onFocus={(e) => e.target.select()}
          className={cx(
            'pixel-corners-sm pixel-caret h-12 w-10 bg-black/35 text-center font-pixel text-sm uppercase text-hi outline-none transition-[background,box-shadow] duration-150 sm:h-14 sm:w-12',
            'focus:bg-teal-400/15 focus:shadow-[inset_0_0_0_2px_rgb(var(--lantern))]',
            c && 'bg-teal-400/10 text-teal-400',
          )}
        />
      ))}
    </div>
  );
}
