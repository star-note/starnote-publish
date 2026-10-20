import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` is browser-safe (schema, layout, render, the fetch-only adapter factory); `web` / `electron` are the
  // client impls. Server-side publishing is the Python API (`app/services/github_publish.py`), not a Node entry.
  entry: ['src/index.ts', 'src/web.ts', 'src/electron.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  splitting: true,
  platform: 'neutral',
  external: ['zod', '@starnote/publish-core', /^node:/],
});
