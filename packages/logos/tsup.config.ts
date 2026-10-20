import { defineConfig } from 'tsup';

export default defineConfig({
  // Browser-safe single entry; logos are inlined data URIs (src/generated.ts), so no asset loader is needed.
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  platform: 'neutral',
  external: ['zod', /^@starnote\//],
});
