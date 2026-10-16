'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState, type FormEvent } from 'react';
import { LIMITS, canManageQueue, canRemoveQueueItem, playbackPermission, type QueueItem } from '@willio/shared';
import { Badge } from '@/components/ui/Bits';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { Input } from '@/components/ui/Form';
import { PixelIcon } from '@/components/ui/PixelIcon';
import { PixelPoster } from '@/features/discover/PixelPoster';
import { useRoomClient } from '@/features/room/context';
import { cx } from '@/lib/util';
import { selectMyRole, useRoom } from '@/store/room';

function Slot({
  item,
  index,
  canDrag,
  canRemove,
  canPlay,
  voted,
  isNext,
}: {
  item: QueueItem;
  index: number;
  canDrag: boolean;
  canRemove: boolean;
  canPlay: boolean;
  voted: boolean;
  isNext: boolean;
}) {
  const client = useRoomClient();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !canDrag });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        'hotbar-slot group flex items-center gap-2 bg-black/30 p-2',
        isDragging && 'z-10 bg-teal-400/15 opacity-90 shadow-glow',
        isNext && 'ring-1 ring-lantern',
      )}
    >
      {canDrag ? (
        <button
          type="button"
          className="cursor-grab touch-none p-1 text-lo hover:text-hi active:cursor-grabbing"
          aria-label={`Reorder ${item.title} (space to pick up, arrows to move)`}
          {...attributes}
          {...listeners}
        >
          <PixelIcon name="grip" size={12} />
        </button>
      ) : (
        <span className="font-mono w-6 text-center text-xs text-lo">{index + 1}</span>
      )}
      <div className="h-12 w-8 shrink-0 overflow-hidden">
        <PixelPoster id={item.movieId ?? item.id} genres={[]} title={item.title} posterUrl={item.posterUrl} compact />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-hi">{item.title}</p>
        <p className="truncate text-[11px] text-lo">
          {item.streamType} - added by {item.addedByName}
          {isNext ? <span className="ml-1 text-lantern">- next up</span> : null}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void client.queueVote(item.id)}
        aria-pressed={voted}
        aria-label={`${voted ? 'Remove upvote from' : 'Upvote'} ${item.title} (${item.votes.length} votes)`}
        className={cx('flex flex-col items-center px-1.5 py-0.5 text-[10px]', voted ? 'text-lantern' : 'text-mid hover:text-hi')}
      >
        <PixelIcon name="up" size={12} />
        <span className="font-mono">{item.votes.length}</span>
      </button>
      {canPlay ? <IconButton icon="play" label={`Play ${item.title} now`} size="sm" tone="teal" onClick={() => void client.queuePlayNow(item.id)} /> : null}
      {canRemove ? <IconButton icon="trash" label={`Remove ${item.title}`} size="sm" onClick={() => void client.queueRemove(item.id)} /> : null}
    </li>
  );
}

/** Shared playlist as an inventory of slots: drag reorder (fractional keys), upvote to bubble, auto-advance. */
export function QueuePanel() {
  const client = useRoomClient();
  const queue = useRoom((s) => s.queue);
  const me = useRoom((s) => s.me);
  const role = useRoom(selectMyRole);
  const settings = useRoom((s) => s.room?.settings);
  const nextUp = useRoom((s) => s.nextUp);
  const [items, setItems] = useState(queue.items);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setItems(queue.items), [queue]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const manage = !!settings && canManageQueue(role, settings.queueMode);
  const canPlay = !!settings && manage && playbackPermission(role, settings.controlMode) === 'ALLOW';

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to);
    setItems(next); // optimistic
    const after = next[to - 1]?.id ?? null;
    const before = next[to + 1]?.id ?? null;
    void client.queueReorder(String(active.id), after, before).then((r) => {
      if (!r.ok) setItems(useRoom.getState().queue.items);
    });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    const r = await client.queueAdd({ url: url.trim(), title: title.trim() || undefined });
    setBusy(false);
    if (r.ok) {
      setUrl('');
      setTitle('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="font-label text-[10px] text-mid">
          Inventory {items.length}/{LIMITS.queueMax}
        </p>
        <Badge tone={settings?.queueMode === 'EVERYONE' ? 'ok' : 'muted'}>{settings?.queueMode === 'EVERYONE' ? 'Everyone edits' : 'Host orders'}</Badge>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-lo">
            <PixelIcon name="queue" size={24} />
            The chest is empty. Add films from Discover or paste a link below.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-1.5 pb-2" aria-label="Queue">
                {items.map((item, i) => (
                  <Slot
                    key={item.id}
                    item={item}
                    index={i}
                    canDrag={manage}
                    canRemove={!!settings && canRemoveQueueItem(role, settings.queueMode, item.addedBy === me?.id)}
                    canPlay={canPlay}
                    voted={!!me && item.votes.includes(me.id)}
                    isNext={nextUp?.itemId === item.id}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <form onSubmit={add} className="flex flex-col gap-2 border-t border-white/10 p-3">
        <Input icon="link" placeholder="Paste a video URL (mp4, m3u8, YouTube)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Video URL" />
        <div className="flex gap-2">
          <Input className="flex-1" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <GlassButton type="submit" variant="primary" icon="plus" loading={busy} disabled={!url.trim()}>
            Add
          </GlassButton>
        </div>
        <p className="text-[11px] text-lo">Only add media you have the rights to stream. Open films are in Discover.</p>
      </form>
    </div>
  );
}
