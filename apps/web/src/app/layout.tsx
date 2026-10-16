import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono, Pixelify_Sans, Press_Start_2P, Silkscreen } from 'next/font/google';
import { Toaster } from '@/components/ui/Toaster';
import { THEME_SCRIPT } from '@/components/ui/ThemeToggle';
import { WorldBackground } from '@/components/world/WorldBackground';
import { Providers } from './providers';
import './globals.css';

const press = Press_Start_2P({ weight: '400', subsets: ['latin'], variable: '--font-press', display: 'swap' });
const silk = Silkscreen({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-silk', display: 'swap' });
const pixelify = Pixelify_Sans({ subsets: ['latin'], variable: '--font-pixelify', display: 'swap' });
const plex = IBM_Plex_Sans({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-plex', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'BlockParty - Same world. Same frame.', template: '%s - BlockParty' },
  description:
    'Real-time synchronized watch parties: frame-accurate sync, live chat, reactions, polls, shared queue and a Group Taste Fusion recommender.',
  applicationName: 'BlockParty',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#04100e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${press.variable} ${silk.variable} ${pixelify.variable} ${plex.variable} ${mono.variable}`}
    >
      <head>
        {/* Static constant: sets the theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only-focusable glass font-label fixed left-3 top-3 z-[100] px-3 py-2 text-xs"
        >
          Skip to content
        </a>
        <WorldBackground />
        <Providers />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
