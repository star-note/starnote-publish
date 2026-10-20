/** Desktop impl: runs inside the starnote-desktop renderer; `ctx.sessionFetch` / `ctx.page` come from the main process. */
import { createJuejinAdapter } from './adapter';

import type { JuejinAdapterOptions } from './adapter';

export function createJuejinElectronAdapter(opts: JuejinAdapterOptions = {}) {
  return createJuejinAdapter({
    runtimes: [{ runtime: 'electron', mode: 'automation', needs: ['session'] }],
    ...opts,
  });
}

export const juejinElectronAdapter = createJuejinElectronAdapter();
