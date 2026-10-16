'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { GENRES, LIMITS, type Movie } from '@willio/shared';
import { Avatar, Chip } from '@/components/ui/Bits';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { searchCatalog, useCatalog } from '@/lib/catalog';
import { computeTaste, loadProfile, randomName, randomSeed, saveProfile, type Profile } from '@/lib/profile';

export interface ProfileResult {
  profile: Profile;
  password?: string;
}

/**
 * First-action modal: display name + pixel avatar (shuffle) + optional "pick movies you love"
 * (powers Group Taste Fusion). Also collects the room password when needed.
 */
export function ProfileModal({
  open,
  onClose,
  onDone,
  title = 'Who are you?',
  submitLabel = 'Continue',
  askPassword = false,
  passwordError,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (r: ProfileResult) => void;
  title?: string;
  submitLabel?: string;
  askPassword?: boolean;
  passwordError?: string | null;
  busy?: boolean;
}) {
  const { catalog } = useCatalog();
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('seed');
  const [liked, setLiked] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [runtimeMax, setRuntimeMax] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const p = loadProfile();
    setName(p?.name ?? randomName());
    setSeed(p?.avatarSeed ?? randomSeed());
    setLiked(p?.likedIds ?? []);
    setGenres(p?.genres ?? []);
    setRuntimeMax(p?.runtimeMax ?? null);
    setError(null);
  }, [open]);

  const results = useMemo(() => {
    if (!catalog || q.trim().length < 2) return [];
    return searchCatalog(catalog, q.trim(), 6).map((h) => h.movie);
  }, [catalog, q]);

  const likedMovies = useMemo(
    () => (catalog ? liked.map((id) => catalog.byId.get(id)).filter((m): m is Movie => !!m) : []),
    [catalog, liked],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) return setError('Pick a display name');
    if (clean.length > LIMITS.nameMaxLen) return setError(`Max ${LIMITS.nameMaxLen} characters`);
    const profile: Profile = {
      name: clean,
      avatarSeed: seed,
      likedIds: liked,
      genres,
      runtimeMax,
      taste: computeTaste(likedMovies, genres, runtimeMax),
    };
    saveProfile(profile);
    onDone({ profile, password: askPassword ? password : undefined });
  };

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <form onSubmit={submit} className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <Avatar seed={seed} size={112} name={name} />
          <GlassButton size="sm" icon="dice" onClick={() => setSeed(randomSeed())}>
            Shuffle avatar
          </GlassButton>
          <p className="text-center text-xs text-lo">8x8 pixel face, generated from your seed. No signup, no email.</p>
        </div>
        <div className="flex flex-col gap-4">
          <Input
            label="Display name"
            value={name}
            maxLength={LIMITS.nameMaxLen}
            onChange={(e) => setName(e.target.value)}
            error={error}
            autoComplete="nickname"
            data-autofocus
          />
          {askPassword ? (
            <Input
              label="Room password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={passwordError}
              icon="lock"
              autoComplete="off"
            />
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="font-label mb-1 text-[10px] text-mid">Pick 3 movies you love (optional - powers Taste Fusion)</legend>
            <Input icon="search" placeholder="Search... try 'intersteller'" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Search results">
                {results.map((m) => (
                  <li key={m.id}>
                    <Chip
                      active={liked.includes(m.id)}
                      onClick={() =>
                        setLiked((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id].slice(-8)))
                      }
                    >
                      {liked.includes(m.id) ? '✓ ' : '+ '}
                      {m.title} ({m.year})
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : null}
            {likedMovies.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Your picks">
                {likedMovies.map((m) => (
                  <li key={m.id} className="pixel-corners-sm flex items-center gap-1 bg-lantern/20 py-0.5 pl-2 pr-0.5 text-xs text-lantern">
                    {m.title}
                    <IconButton
                      icon="close"
                      size="sm"
                      label={`Remove ${m.title}`}
                      className="!h-6 !w-6 !bg-transparent"
                      onClick={() => setLiked((l) => l.filter((x) => x !== m.id))}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>
          <fieldset>
            <legend className="font-label mb-2 text-[10px] text-mid">Favourite genres</legend>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map((g) => (
                <Chip key={g} active={genres.includes(g)} onClick={() => setGenres((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))}>
                  {g}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Select
            label="Longest movie you'll sit through"
            value={runtimeMax ?? ''}
            onChange={(e) => setRuntimeMax(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">No limit</option>
            <option value="100">~1h40</option>
            <option value="120">2 hours</option>
            <option value="150">2h30</option>
          </Select>
          <div className="flex justify-end gap-2 pt-1">
            <GlassButton variant="ghost" onClick={onClose}>
              Cancel
            </GlassButton>
            <GlassButton type="submit" variant="primary" loading={busy}>
              {submitLabel}
            </GlassButton>
          </div>
        </div>
      </form>
    </Modal>
  );
}
