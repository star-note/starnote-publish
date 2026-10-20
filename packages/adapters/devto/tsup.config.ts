import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` is browser-safe; other entries are per-runtime impls.
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  splitting: true,
  platform: 'neutral',
  external: ['zod', /^@starnote\//, /^node:/],
});
