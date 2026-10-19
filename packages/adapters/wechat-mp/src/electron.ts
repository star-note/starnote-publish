/** Desktop impl: runs inside the starnote-desktop renderer; `ctx.sessionFetch` / `ctx.page` come from the main process. */
import { createWechatMpAdapter } from './adapter';

import type { WechatMpAdapterOptions } from './adapter';

export function createWechatMpElectronAdapter(opts: WechatMpAdapterOptions = {}) {
  return createWechatMpAdapter(opts);
}

export const wechatMpElectronAdapter = createWechatMpElectronAdapter();
