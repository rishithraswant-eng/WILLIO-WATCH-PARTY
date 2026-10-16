'use client';

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { LIMITS, formatTime, type ChatMessage } from '@blockparty/shared';
import { Avatar } from '@/components/ui/Bits';
import { IconButton } from '@/components/ui/Glass';
import { Switch } from '@/components/ui/Form';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { useRoomClient } from '@/features/room/context';
import { clockTime, cx, softFilter } from '@/lib/util';
import { usePrefs } from '@/store/prefs';
import { useRoom } from '@/store/room';

const EMOJI = ['😂', '🔥', '😮', '😢', '👏', '❤️', '💀', '🍿', '🤯', '👀', '🙌', '😎', '🤔', '😱', '🥲', '✨'];
const SPOILER_MARGIN_SEC = 5;

/** Renders text with @mentions highlighted and http(s) links as safe anchors. Never uses innerHTML. */
function RichText({ text, meName }: { text: string; meName: string | null }) {
  const parts = useMemo(() => {
    const out: { t: string; kind: 'text' | 'link' | 'mention' }[] = [];
    const re = /(https?:\/\/[^\s<>"']{2,300})|(@[\p{L}\p{N}_][\p{L}\p{N}_ ]{0,23})/gu;
    let last = 0;
    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push({ t: text.slice(last, idx), kind: 'text' });
      out.push({ t: m[0], kind: m[1] ? 'link' : 'mention' });
      last = idx + m[0].length;
    }
    if (last < text.length) out.push({ t: text.slice(last), kind: 'text' });
    return out;
  }, [text]);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'link') {
          let safe: string | null = null;
          try {
            const u = new URL(p.t);
            if (u.protocol === 'http:' || u.protocol === 'https:') safe = u.toString();
          } catch {
            safe = null;
          }
          return safe ? (
            <a key={i} href={safe} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-sky underline underline-offset-2">
              {p.t}
            </a>
          ) : (
            <span key={i}>{p.t}</span>
          );
        }
        if (p.kind === 'mention') {
          const isMe = !!meName && p.t.toLowerCase().startsWith(`@${meName.toLowerCase()}`);
          return (
            <span key={i} className={cx('font-medium', isMe ? 'bg-lantern/25 text-lantern' : 'text-teal-400')}>
              {p.t}
            </span>
          );
        }
        return <span key={i}>{p.t}</span>;
      })}
    </>
  );
}

const Message = memo(function Message({
  m,
  seed,
  meId,
  meName,
  hidden,
  filter,
  onReveal,
}: {
  m: ChatMessage;
  seed: string;
  meId: string | null;
  meName: string | null;
  hidden: boolean;
  filter: boolean;
  onReveal: () => void;
}) {
  if (m.system) {
    return (
      <li className="flex items-center gap-2 px-1 py-1 text-xs text-lo">
        <span className="h-px flex-1 bg-white/10" aria-hidden />
        <span className="text-center">{m.text}</span>
        <span className="h-px flex-1 bg-white/10" aria-hidden />
      </li>
    );
  }
  const mine = m.userId === meId;
  const mentioned = !!meId && m.mentions.includes(meId);
  const text = filter ? softFilter(m.text) : m.text;
  return (
    <li className={cx('flex gap-2 px-1 py-1.5', mentioned && 'bg-lantern/[0.07]')}>
      <Avatar seed={seed} size={28} name={m.name} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cx('truncate text-sm font-semibold', mine ? 'text-teal-400' : 'text-hi')}>{m.name}</span>
          <time className="text-[10px] text-lo" dateTime={new Date(m.createdAt).toISOString()}>
            {clockTime(m.createdAt)}
          </time>
          {m.videoTs != null ? (
            <span className="font-mono text-[10px] text-lo" title="Video time when this was sent">
              @{formatTime(m.videoTs)}
            </span>
          ) : null}
        </div>
        {hidden ? (
          <button
            type="button"
            onClick={onReveal}
            className="mt-0.5 w-full select-none bg-white/5 px-2 py-1 text-left text-sm text-transparent blur-[5px] hover:blur-[4px]"
            aria-label={`Spoiler from ${formatTime(m.videoTs ?? 0)} - tap to reveal`}
            title="Spoiler - tap to reveal"
          >
            <span className="text-hi">{text}</span>
          </button>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-hi/90">
            <RichText text={text} meName={meName} />
          </p>
        )}
        {hidden ? <span className="font-label text-[9px] text-lantern">Spoiler - tap to reveal</span> : null}
      </div>
    </li>
  );
});

export function ChatPanel() {
  const client = useRoomClient();
  const chat = useRoom((s) => s.chat);
  const outbox = useRoom((s) => s.outbox);
  const participants = useRoom((s) => s.participants);
  const typing = useRoom((s) => s.typing);
  const me = useRoom((s) => s.me);
  const mediaId = useRoom((s) => s.state?.media?.id ?? null);
  const position = useRoom((s) => s.sync.position);
  const joinedAtPos = useRoom((s) => s.joinedAtPos);
  const spoilerPref = usePrefs((s) => s.spoilerSafe);
  const filter = usePrefs((s) => s.profanityFilter);
  const setPref = usePrefs((s) => s.set);
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  // Default ON for late joiners (joined more than a minute into the movie).
  const spoilerSafe = spoilerPref ?? (joinedAtPos != null && joinedAtPos > 60);
  const meName = me ? (participants[me.id]?.name ?? null) : null;

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.length, outbox.length]);

  useEffect(() => () => client.typing(false), [client]);

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    void client.sendChat(t);
    client.typing(false);
    setText('');
    stick.current = true;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const typingNames = Object.entries(typing)
    .filter(([id]) => id !== me?.id)
    .map(([, v]) => v.name);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <Switch
          checked={spoilerSafe}
          onChange={(v) => setPref('spoilerSafe', v)}
          label="Protect me from spoilers"
          description="Blur messages from later in the movie"
        />
      </div>
      <ol
        ref={list}
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scroll-thin flex-1 overflow-y-auto px-2 py-2"
      >
        {chat.length === 0 ? <li className="p-4 text-center text-sm text-lo">No messages yet - say hi! Try /poll &quot;Snacks?&quot; yes | no</li> : null}
        {chat.map((m) => {
          const hidden =
            spoilerSafe &&
            !revealed.has(m.id) &&
            !m.system &&
            m.userId !== me?.id &&
            m.mediaId != null &&
            m.mediaId === mediaId &&
            m.videoTs != null &&
            m.videoTs > position + SPOILER_MARGIN_SEC;
          return (
            <Message
              key={m.id}
              m={m}
              seed={participants[m.userId ?? '']?.avatarSeed ?? m.name}
              meId={me?.id ?? null}
              meName={meName}
              hidden={hidden}
              filter={filter}
              onReveal={() => setRevealed((r) => new Set(r).add(m.id))}
            />
          );
        })}
        {outbox.map((o) => (
          <li key={o.id} className="flex items-center gap-2 px-1 py-1.5 text-sm text-mid opacity-70">
            <PixelIcon name="clock" size={12} />
            <span className="truncate">{o.text}</span>
            <span className="font-label ml-auto text-[9px]">sending...</span>
          </li>
        ))}
      </ol>
      <div className="h-5 px-3 text-xs text-lo" aria-live="polite">
        {typingNames.length > 0 ? `${typingNames.slice(0, 3).join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing...` : ''}
      </div>
      <form onSubmit={send} className="relative flex items-end gap-2 border-t border-white/10 p-2">
        {emojiOpen ? (
          <div className="glass glass-strong pixel-corners absolute bottom-full left-2 mb-2 grid grid-cols-8 gap-1 p-2" role="dialog" aria-label="Emoji picker">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                className="h-8 w-8 text-lg hover:bg-white/10"
                onClick={() => {
                  setText((t) => t + e);
                  setEmojiOpen(false);
                  input.current?.focus();
                }}
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}
        <IconButton icon="star" label="Emoji" size="sm" active={emojiOpen} onClick={() => setEmojiOpen((o) => !o)} />
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          value={text}
          maxLength={LIMITS.chatMaxLen}
          placeholder="Message... (@name, /poll, /shrug, /skip)"
          onChange={(e) => {
            setText(e.target.value);
            client.typing(e.target.value.length > 0);
          }}
          onKeyDown={onKey}
          className="pixel-caret glass glass-sm pixel-corners-sm max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-hi placeholder:text-lo focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern/80"
        />
        <IconButton icon="send" label="Send message" size="sm" tone="teal" type="submit" disabled={!text.trim()} />
      </form>
    </div>
  );
}
