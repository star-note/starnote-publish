/**
 * @starnote/publish-pinterest — Pinterest (API v5, OAuth): the Pin renderer (cover + link), schema, board binding, the relay body and Pin analytics; the pin/create button when not bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createPinterestAdapter } from './pinterest';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './pinterest';

export const pinterestAdapter = createPinterestAdapter();

/** The registry entry. */
export const pinterestMeta = platformMeta('pinterest') as PlatformMeta;
