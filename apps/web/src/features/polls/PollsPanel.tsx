'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LIMITS, canClosePoll, formatTime, type Poll, type PollType, type Recommendation } from '@willio/shared';
import { Badge } from '@/components/ui/Bits';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { Input, Select, Slider, Switch } from '@/components/ui/Form';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { useRoomClient } from '@/features/room/context';
import { cx, plural } from '@/lib/util';
import { selectMyRole, useRoom } from '@/store/room';
import { toast } from '@/store/toasts';

function useNow(intervalMs = 500): number {
  const client = useRoomClient();
  const [now, setNow] = useState(() => client.clock.serverNow());
  useEffect(() => {
    const t = window.setInterval(() => setNow(client.clock.serverNow()), intervalMs);
    return () => window.clearInterval(t);
  }, [client, intervalMs]);
  return now;
}

function PollCard({ poll, now }: { poll: Poll; now: number }) {
  const client = useRoomClient();
  const me = useRoom((s) => s.me);
  const role = useRoom(selectMyRole);
  const myVote = useRoom((s) => s.myVotes[poll.id] ?? (me && poll.voters ? Object.entries(poll.voters).find(([, ids]) => ids.includes(me.id))?.[0] : undefined));
  const participants = useRoom((s) => s.participants);
  const open = poll.status === 'OPEN';
  const left = Math.max(0, poll.endsAt - now);
  const total = Math.max(1, poll.totalVotes);
  const winner = poll.result?.winnerId;
  return (
    <li className="glass glass-sm pixel-corners-sm flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-hi">{poll.question}</p>
          <p className="text-[11px] text-lo">
            by {poll.creatorName} - {plural(poll.totalVotes, 'vote')}
            {poll.anonymous ? ' - anonymous' : ''}
          </p>
        </div>
        {open ? (
          <Badge tone={left < 10_000 ? 'warn' : 'info'}>
            <span className="font-mono">{formatTime(left / 1000)}</span>
          </Badge>
        ) : (
          <Badge tone="muted">closed</Badge>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {poll.options.map((o) => {
          const count = poll.counts[o.id] ?? 0;
          const pct = Math.round((count / total) * 100);
          const mine = myVote === o.id;
          const isWinner = !open && winner === o.id;
          const voters = poll.voters?.[o.id]?.map((id) => participants[id]?.name).filter(Boolean) ?? [];
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={!open}
                onClick={() => void client.pollVote(poll.id, o.id)}
                aria-pressed={mine}
                title={voters.length ? voters.join(', ') : undefined}
                className={cx(
                  'relative flex w-full items-center justify-between gap-2 overflow-hidden px-2.5 py-2 text-left text-sm transition-colors duration-150',
                  mine ? 'bg-teal-400/20 text-hi ring-1 ring-teal-400' : 'bg-black/30 text-hi hover:bg-white/10',
                  isWinner && 'ring-2 ring-lantern',
                  !open && 'cursor-default',
                )}
              >
                <span
                  className={cx('absolute inset-y-0 left-0 transition-[width] duration-300 ease-out', isWinner ? 'bg-lantern/30' : 'bg-teal-400/20')}
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <span className="relative flex items-center gap-1.5">
                  {isWinner ? <PixelIcon name="crown" size={12} className="text-lantern" /> : null}
                  {o.label}
                </span>
                <span className="font-mono relative text-xs text-mid">
                  {count} - {pct}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!open && poll.result ? (
        <p className="text-[11px] text-mid">
          {poll.result.winnerId ? (poll.result.tie ? 'Tie broken. ' : '') : 'No votes. '}
          {poll.result.applied ? `Result: ${poll.result.applied}` : ''}
        </p>
      ) : null}
      {open && me && canClosePoll(role, poll.creatorId === me.id) ? (
        <GlassButton size="sm" variant="ghost" className="self-end" onClick={() => void client.pollClose(poll.id)}>
          Close now
        </GlassButton>
      ) : null}
    </li>
  );
}

function CreatePoll({ onDone }: { onDone: () => void }) {
  const client = useRoomClient();
  const position = useRoom((s) => s.sync.position);
  const [type, setType] = useState<PollType>('GENERIC');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [duration, setDuration] = useState(45);
  const [anonymous, setAnonymous] = useState(false);
  const [skipTo, setSkipTo] = useState(Math.round(position + 90));
  const [minutes, setMinutes] = useState(5);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (type !== 'NEXT_MOVIE') return;
    void client.recommend().then((r) => r.ok && setRecs(r.recommendations.filter((x) => x.movie.isFree).slice(0, 4)));
  }, [type, client]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let payload: Record<string, unknown>;
    if (type === 'SKIP_TO')
      payload = { question: question || `Skip to ${formatTime(skipTo)}?`, options: [{ label: 'Skip' }, { label: 'Stay' }], payload: { pos: skipTo } };
    else if (type === 'PAUSE_BREAK')
      payload = { question: question || `Pause ${minutes} min for snacks?`, options: [{ label: 'Snack time' }, { label: 'Keep going' }], payload: { minutes } };
    else if (type === 'NEXT_MOVIE')
      payload = {
        question: question || 'What should we watch next?',
        options: recs.map((r) => ({ label: r.movie.title, payload: { movieId: r.movie.id } })),
      };
    else payload = { question, options: options.map((o) => ({ label: o })).filter((o) => o.label.trim()) };
    const res = await client.pollCreate({ ...payload, durationSec: duration, anonymous, type });
    setBusy(false);
    if (res.ok) onDone();
  };

  const validGeneric = question.trim() && options.filter((o) => o.trim()).length >= 2;
  const valid = type === 'GENERIC' ? validGeneric : type === 'NEXT_MOVIE' ? recs.length >= 2 : true;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-3">
      <Select label="Poll type" value={type} onChange={(e) => setType(e.target.value as PollType)}>
        <option value="GENERIC">Question</option>
        <option value="SKIP_TO">Skip to time (auto-seeks)</option>
        <option value="PAUSE_BREAK">Snack break (auto-intermission)</option>
        <option value="NEXT_MOVIE">Next movie (Taste Fusion picks)</option>
      </Select>
      <Input
        label="Question"
        value={question}
        maxLength={LIMITS.pollQuestionMaxLen}
        placeholder={type === 'GENERIC' ? 'Pizza or tacos?' : 'Leave empty for a smart default'}
        onChange={(e) => setQuestion(e.target.value)}
      />
      {type === 'GENERIC' ? (
        <div className="flex flex-col gap-1.5">
          {options.map((o, i) => (
            <div key={i} className="flex gap-1.5">
              <Input
                className="flex-1"
                value={o}
                maxLength={LIMITS.pollOptionMaxLen}
                placeholder={`Option ${i + 1}`}
                aria-label={`Option ${i + 1}`}
                onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 ? (
                <IconButton icon="close" label={`Remove option ${i + 1}`} size="sm" className="mt-1" onClick={() => setOptions((l) => l.filter((_, j) => j !== i))} />
              ) : null}
            </div>
          ))}
          {options.length < LIMITS.pollOptionsMax ? (
            <GlassButton size="sm" variant="ghost" icon="plus" className="self-start" onClick={() => setOptions((l) => [...l, ''])}>
              Add option
            </GlassButton>
          ) : null}
        </div>
      ) : null}
      {type === 'SKIP_TO' ? <Slider label="Skip to" min={0} max={Math.max(600, Math.round(position + 600))} step={5} value={skipTo} onChange={setSkipTo} format={formatTime} /> : null}
      {type === 'PAUSE_BREAK' ? <Slider label="Break length" min={1} max={15} value={minutes} onChange={setMinutes} format={(v) => `${v} min`} /> : null}
      {type === 'NEXT_MOVIE' ? (
        <p className="text-xs text-mid">{recs.length >= 2 ? `Options: ${recs.map((r) => r.movie.title).join(', ')}` : 'Finding watchable picks for this room...'}</p>
      ) : null}
      <Slider label="Duration" min={LIMITS.pollDurationMinSec} max={LIMITS.pollDurationMaxSec} step={5} value={duration} onChange={setDuration} format={(v) => `${v}s`} />
      <Switch checked={anonymous} onChange={setAnonymous} label="Anonymous votes" />
      <div className="flex justify-end gap-2">
        <GlassButton variant="ghost" onClick={onDone}>
          Cancel
        </GlassButton>
        <GlassButton type="submit" variant="primary" loading={busy} disabled={!valid}>
          Start poll
        </GlassButton>
      </div>
    </form>
  );
}

export function PollsPanel() {
  const client = useRoomClient();
  const polls = useRoom((s) => s.polls);
  const position = useRoom((s) => s.sync.position);
  const hasMedia = useRoom((s) => !!s.state?.media);
  const now = useNow();
  const [creating, setCreating] = useState(false);
  const sorted = useMemo(() => {
    const list = Object.values(polls);
    const open = list.filter((p) => p.status === 'OPEN').sort((a, b) => a.endsAt - b.endsAt);
    const closed = list.filter((p) => p.status === 'CLOSED').sort((a, b) => b.endsAt - a.endsAt);
    return [...open, ...closed];
  }, [polls]);

  const quick = async (kind: 'intro' | 'snacks' | 'next') => {
    if (kind === 'intro') {
      await client.pollCreate({
        type: 'SKIP_TO',
        question: 'Skip the intro?',
        options: [{ label: 'Skip' }, { label: 'Watch it' }],
        payload: { pos: Math.round(position + 90) },
        durationSec: 20,
        anonymous: false,
      });
    } else if (kind === 'snacks') {
      await client.pollCreate({
        type: 'PAUSE_BREAK',
        question: 'Pause for snacks?',
        options: [{ label: 'Snack time' }, { label: 'Keep going' }],
        payload: { minutes: 5 },
        durationSec: 30,
        anonymous: false,
      });
    } else {
      const r = await client.recommend();
      const picks = r.ok ? r.recommendations.filter((x) => x.movie.isFree).slice(0, 3) : [];
      if (picks.length < 2) {
        toast.info('Not enough watchable picks yet');
        return;
      }
      await client.pollCreate({
        type: 'NEXT_MOVIE',
        question: 'What next?',
        options: picks.map((p) => ({ label: p.movie.title, payload: { movieId: p.movie.id } })),
        durationSec: 45,
        anonymous: false,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {creating ? (
        <div className="scroll-thin overflow-y-auto">
          <CreatePoll onDone={() => setCreating(false)} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 p-3">
            <GlassButton size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New poll
            </GlassButton>
            <GlassButton size="sm" disabled={!hasMedia} onClick={() => void quick('intro')}>
              Skip intro?
            </GlassButton>
            <GlassButton size="sm" disabled={!hasMedia} onClick={() => void quick('snacks')}>
              Snacks?
            </GlassButton>
            <GlassButton size="sm" onClick={() => void quick('next')}>
              What next?
            </GlassButton>
          </div>
          <ol className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto p-3" aria-label="Polls">
            {sorted.length === 0 ? (
              <li className="p-4 text-center text-sm text-lo">No polls yet. Actionable polls auto-apply: a winning &quot;Skip&quot; seeks everyone.</li>
            ) : null}
            {sorted.map((p) => (
              <PollCard key={p.id} poll={p} now={now} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
