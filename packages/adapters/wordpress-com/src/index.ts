/**
 * @starnote/publish-wordpress-com — WordPress.com (OAuth): schema, binding, rendering / preview, the relay body and
 * the official requests. Browser-safe only. Self-hosted WordPress is `@starnote/publish-wordpress`.
 */
import { platformMeta } from '@starnote/publish-core';

import { createWordpressComAdapter } from './wordpress-com';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './wordpress-com';

export const wordpressComAdapter = createWordpressComAdapter();

/** The registry entry. */
export const wordpressComMeta = platformMeta('wordpress-com') as PlatformMeta;
