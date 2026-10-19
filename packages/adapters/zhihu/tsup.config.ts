import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` is browser-safe (schema, render, preview, the bundled signed site script, the adapter factory);
  // `electron` registers the desktop runtime. Neither imports electron: the desktop main process implements
  // `ctx.sessionFetch` / `ctx.page`.
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
