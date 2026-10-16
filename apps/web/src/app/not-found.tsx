import Link from 'next/link';
import { GlassPanel } from '@/components/ui/Glass';

/** 404 = "You fell into the void". */
export default function NotFound() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-4">
      <GlassPanel className="flex max-w-md flex-col items-center gap-4 p-8 text-center" blur="lg">
        <div className="font-pixel text-4xl text-danger">404</div>
        <h1 className="font-heading text-gradient text-3xl font-semibold">You fell into the void</h1>
        <p className="text-sm text-mid">This block doesn&apos;t exist. Maybe the link is old, or the chunk never generated.</p>
        <Link
          href="/"
          className="font-label pixel-corners-sm inline-flex h-10 items-center bg-teal-500 px-4 text-xs text-ink hover:bg-teal-400"
        >
          Respawn
        </Link>
      </GlassPanel>
    </main>
  );
}
