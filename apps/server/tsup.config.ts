import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', seed: 'src/scripts/seed.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // The shared workspace package is TypeScript source: bundle it in.
  noExternal: ['@blockparty/shared'],
});
