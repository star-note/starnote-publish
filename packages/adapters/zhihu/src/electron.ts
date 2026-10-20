/** Desktop impl: runs inside the starnote-desktop renderer; `ctx.sessionFetch` / `ctx.page` come from the main process. */
import { createZhihuAdapter } from './adapter';

import type { ZhihuAdapterOptions } from './adapter';

export function createZhihuElectronAdapter(opts: ZhihuAdapterOptions = {}) {
  return createZhihuAdapter({
    runtimes: [{ runtime: 'electron', mode: 'automation', needs: ['session'] }],
    ...opts,
  });
}

export const zhihuElectronAdapter = createZhihuElectronAdapter();
