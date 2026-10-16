'use client';

import { useEffect } from 'react';
import { usePrefs } from '@/store/prefs';

/** Client-only bootstrapping (persisted preferences). Renders nothing. */
export function Providers() {
  const hydrate = usePrefs((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return null;
}
