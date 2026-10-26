/**
 * @starnote/publish-linkedin — LinkedIn (Posts API, OAuth): the article-card renderer (little text), schema, binding, the relay body and the official requests; share-offsite when not bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createLinkedinAdapter } from './linkedin';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './linkedin';

export const linkedinAdapter = createLinkedinAdapter();

/** The registry entry. */
export const linkedinMeta = platformMeta('linkedin') as PlatformMeta;
