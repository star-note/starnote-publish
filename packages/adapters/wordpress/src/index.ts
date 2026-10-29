/**
 * @starnote/publish-wordpress — schema, bindings (self-hosted application password; WordPress.com OAuth declared only), rendering / preview, the relay body and the REST requests the API sends.
 *
 * Browser-safe only. `wordpressAdapter` renders the request body in the browser / desktop and publishes through
 * 辰记's API (`POST /notes/{id}/publish/wordpress`), which adds the stored credential and calls the platform
 * (服务器代发, Python). There is no Node entry: server-side publishing exists only in the Python API.
 */
import { platformMeta } from '@starnote/publish-core';

import { createWordpressAdapter } from './wordpress';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './wordpress';
export { msg as wordpressMessages } from './i18n';

export const wordpressAdapter = createWordpressAdapter();

export const wordpressMeta = platformMeta('wordpress') as PlatformMeta;
