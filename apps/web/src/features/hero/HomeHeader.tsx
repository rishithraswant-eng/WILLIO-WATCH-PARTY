'use client';

import { useEffect, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { cx } from '@/lib/util';

/**
 * The home page's TopBar, fixed over the scroll hero: transparent (always dark-themed for contrast)
 * while the hero is under it, frosted once the regular page content scrolls beneath it.
 */
export function HomeHeader() {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const end = document.getElementById('hero-end');
    if (!end) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e) setSolid(!e.isIntersecting && e.boundingClientRect.top < 68);
      },
      { rootMargin: '-68px 0px 0px 0px' },
    );
    io.observe(end);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={cx('home-header fixed inset-x-0 top-0 z-40', solid && 'home-header-solid')}
      data-theme={solid ? undefined : 'dark'}
    >
      <TopBar />
    </div>
  );
}
