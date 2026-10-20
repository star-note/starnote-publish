/**
 * @starnote/publish-instagram — Instagram hand-off: images + caption to the phone's share sheet (Web Share), or
 * download + copy on a computer. No binding, no Meta app. Browser-safe.
 */
import { platformMeta } from '@starnote/publish-core';

import { createInstagramAdapter } from './instagram';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './instagram';

export const instagramAdapter = createInstagramAdapter();

/** The registry entry. */
export const instagramMeta = platformMeta('instagram') as PlatformMeta;
