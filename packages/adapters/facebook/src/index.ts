/**
 * @starnote/publish-facebook — Facebook Pages (Graph API, OAuth): the link-post renderer, schema, Page binding and the relay body; sharer.php when not bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createFacebookAdapter } from './facebook';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './facebook';

export const facebookAdapter = createFacebookAdapter();

/** The registry entry. */
export const facebookMeta = platformMeta('facebook') as PlatformMeta;
