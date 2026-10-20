/** Desktop impl (hand-off): runs inside the starnote-desktop renderer; `ctx.sessionFetch` / `ctx.page` come from the main process. */
import { createCsdnAdapter } from './adapter';

import type { CsdnAdapterOptions } from './adapter';

export function createCsdnElectronAdapter(opts: CsdnAdapterOptions = {}) {
  return createCsdnAdapter(opts);
}

export const csdnElectronAdapter = createCsdnElectronAdapter();
