import { defineConfig } from 'tsup';

export default defineConfig({
  // Browser-safe single entry, zero runtime dependencies; the lexicon is inlined (src/words.generated.ts).
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  platform: 'neutral',
});
