import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` is browser-safe (render, preview, the bundled signed 通用模式 site scripts, the adapter factory);
  // `electron` builds every platform's desktop adapter. Neither imports electron.
  entry: ['src/index.ts', 'src/electron.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  splitting: true,
  platform: 'neutral',
  external: ['zod', '@starnote/publish-core'],
});
