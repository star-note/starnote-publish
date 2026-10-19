import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // keep the cache inside this project even when a tool is run from a parent directory
  cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
  resolve: {
    // Tests run against sources, so a package does not need a build of its siblings.
    alias: {
      '@starnote/publish-core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url)
      ),
      '@starnote/moderation': fileURLToPath(
        new URL('./packages/moderation/src/index.ts', import.meta.url)
      ),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    environment: 'node',
  },
});
