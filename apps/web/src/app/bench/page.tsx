import type { Metadata } from 'next';
import { TopBar } from '@/components/TopBar';
import { BenchView } from '@/features/bench/BenchView';

export const metadata: Metadata = { title: 'Sync benchmark' };

export default function BenchPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 sm:px-6">
        <h1 className="font-heading text-gradient mb-1 text-3xl font-semibold sm:text-4xl">Sync benchmark</h1>
        <p className="mb-5 max-w-3xl text-sm text-mid">
          Measured by a swarm of bot clients that run the exact same sync core as the browser. Propagation = time from the server
          broadcasting a state change to each client receiving it. Drift = client position minus the server timeline, sampled after
          correction.
        </p>
        <BenchView />
      </main>
    </div>
  );
}
