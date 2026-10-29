import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', i18n: 'src/i18n/index.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  external: ['zod'],
});
