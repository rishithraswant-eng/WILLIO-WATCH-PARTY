import type { Metadata } from 'next';
import { TopBar } from '@/components/TopBar';
import { DiscoverView } from '@/features/discover/DiscoverView';

export const metadata: Metadata = { title: 'Discover' };

export default function DiscoverPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 sm:px-6">
        <h1 className="font-heading text-gradient mb-1 text-3xl font-semibold sm:text-4xl">Discover</h1>
        <p className="mb-5 text-sm text-mid">400+ films, typo-tolerant search, moods and Taste Fusion. Open films play instantly.</p>
        <DiscoverView mode="page" />
      </main>
    </div>
  );
}
