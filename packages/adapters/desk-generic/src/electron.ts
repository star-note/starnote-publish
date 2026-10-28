/** Desktop impl (hand-off): every 通用模式 platform's adapter, for the desktop renderer's 发布台 run. */
import { createGenericDeskAdapter } from './adapter';
import { GENERIC_DESK_KEYS } from './sites';

import type { SessionAdapterOptions } from '@starnote/publish-core';

export function createGenericDeskElectronAdapters(opts: SessionAdapterOptions = {}) {
  return GENERIC_DESK_KEYS.map((key) => createGenericDeskAdapter(key, opts));
}
