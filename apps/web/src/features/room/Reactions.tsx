'use client';

import { useEffect, useRef, useState } from 'react';
import { REACTION_EMOJIS, type ReactionBurst } from '@willio/shared';
import { cx, isTypingTarget } from '@/lib/util';
import { useRoomClient } from './context';

interface Particle {
  id: number;
  emoji: string;
  x: number;
  drift: number;
  delay: number;
  scale: number;
}

let pid = 1;

/** "Item drop" particles: reactions pop out, bob upward like dropped items, then fade. */
export function ReactionLayer() {
  const client = useRoomClient();
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const onBurst = (bursts: ReactionBurst[]) => {
      const fresh: Particle[] = [];
      for (const b of bursts) {
        const n = Math.min(12, b.count);
        const base = 10 + Math.random() * 80;
        for (let i = 0; i < n; i++) {
          fresh.push({
            id: pid++,
            emoji: b.emoji,
            x: Math.max(4, Math.min(96, base + (Math.random() - 0.5) * 18)),
            drift: (Math.random() - 0.5) * 40,
            delay: i * 60,
            scale: 0.9 + Math.min(1.2, b.count / 10) * 0.5 + Math.random() * 0.2,
          });
        }
      }
      setParticles((p) => [...p, ...fresh].slice(-60));
    };
    client.reactionListeners.add(onBurst);
    return () => {
      client.reactionListeners.delete(onBurst);
    };
  }, [client]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="reaction-drop absolute bottom-6 select-none"
          style={{
            left: `${p.x}%`,
            animationDelay: `${p.delay}ms`,
            ['--drift' as string]: `${p.drift}px`,
            ['--s' as string]: p.scale,
          }}
          onAnimationEnd={() => setParticles((list) => list.filter((x) => x.id !== p.id))}
        >
          <span className="block text-3xl drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)]">{p.emoji}</span>
        </span>
      ))}
    </div>
  );
}

/** Minecraft-style hotbar of 9 reaction slots (keys 1-9). */
export function ReactionHotbar() {
  const client = useRoomClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [bump, setBump] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  const fire = (i: number) => {
    const emoji = REACTION_EMOJIS[i];
    if (!emoji) return;
    setSelected(i);
    setBump(i);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBump(null), 160);
    client.react(emoji);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) fire(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <div role="toolbar" aria-label="Reactions" className="glass glass-sm pixel-corners-sm mx-auto flex w-full max-w-[520px] gap-1 overflow-x-auto p-1.5 scroll-thin">
      {REACTION_EMOJIS.map((e, i) => (
        <button
          key={e}
          type="button"
          data-selected={selected === i}
          onClick={() => fire(i)}
          aria-label={`React ${e} (key ${i + 1})`}
          className={cx(
            'hotbar-slot relative flex h-11 min-w-[44px] flex-1 items-center justify-center bg-black/30 text-xl transition-transform duration-100 hover:bg-white/10',
            bump === i && 'scale-90',
          )}
        >
          <span aria-hidden>{e}</span>
          <span className="font-mono absolute bottom-0.5 right-1 text-[9px] text-white/50" aria-hidden>
            {i + 1}
          </span>
        </button>
      ))}
    </div>
  );
}
