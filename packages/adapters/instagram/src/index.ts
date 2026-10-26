/**
 * @starnote/publish-instagram — Instagram, two modes:
 * - hand-off (`instagramAdapter`): images + caption to the phone's share sheet (Web Share), or download + copy on a
 *   computer. No binding, no Meta app;
 * - API (`instagramApiAdapter`, SPEC-r11 §10): a bound professional account, single image or carousel published in
 *   three stages through 辰记's relay; its `renderHandoff` is the hand-off mode, used while nothing is bound.
 * Browser-safe.
 */
import { platformMeta } from '@starnote/publish-core';

import { createInstagramAdapter } from './instagram';
import { createInstagramApiAdapter } from './instagram-api';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './instagram';
export * from './instagram-api';

export const instagramAdapter = createInstagramAdapter();
export const instagramApiAdapter = createInstagramApiAdapter();

/** The registry entry. */
export const instagramMeta = platformMeta('instagram') as PlatformMeta;
