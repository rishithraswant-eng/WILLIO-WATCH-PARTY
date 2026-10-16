import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@blockparty/shared'],
  experimental: {
    // monorepo: trace workspace packages into the standalone output
    outputFileTracingRoot: resolve(here, '..', '..'),
  },
};

export default nextConfig;
