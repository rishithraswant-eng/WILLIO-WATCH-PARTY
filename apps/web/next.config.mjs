import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@willio/shared'],
  async headers() {
    return [
      // Hero frames are versioned with ?v=<source hash> (see scripts/extract-frames.sh).
      {
        source: '/hero-frames/:set(desktop|mobile)/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/hero-frames/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
  experimental: {
    // monorepo: trace workspace packages into the standalone output
    outputFileTracingRoot: resolve(here, '..', '..'),
  },
};

export default nextConfig;
