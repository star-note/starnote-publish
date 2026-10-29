/**
 * @starnote/publish-blogger — schema, binding, rendering / preview, the relay body and the official requests
 * (`BLOGGER_REQUESTS`). Browser-safe only: the desktop main process or 辰记's API sends the request.
 */
import { platformMeta } from '@starnote/publish-core';

import { createBloggerAdapter } from './blogger';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './blogger';
export { msg as bloggerMessages } from './i18n';

export const bloggerAdapter = createBloggerAdapter();

/** The registry entry. */
export const bloggerMeta = platformMeta('blogger') as PlatformMeta;
