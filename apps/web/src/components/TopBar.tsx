'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/lib/util';
import { Logo } from './ui/Logo';
import { PixelIcon } from './ui/PixelIcon';
import { ThemeToggle } from './ui/ThemeToggle';

const NAV = [
  { href: '/discover', label: 'Discover', icon: 'compass' as const },
  { href: '/bench', label: 'Sync bench', icon: 'chart' as const },
];

export function TopBar() {
  const path = usePathname();
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <Logo />
      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={path === n.href ? 'page' : undefined}
            className={cx(
              'font-label pixel-corners-sm inline-flex h-9 items-center gap-1.5 px-3 text-[10px] transition-colors duration-150',
              path === n.href ? 'bg-teal-400/20 text-teal-400' : 'text-mid hover:bg-white/5 hover:text-hi',
            )}
          >
            <PixelIcon name={n.icon} size={12} />
            <span className="hidden sm:inline">{n.label}</span>
          </Link>
        ))}
        <ThemeToggle />
      </nav>
    </header>
  );
}
