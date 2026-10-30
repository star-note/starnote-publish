/**
 * @starnote/publish-cnblogs — schema, binding, rendering / preview, the relay body (`cnblogsRelayBody`) and the request descriptions the API follows (`CNBLOGS_REQUESTS`).
 *
 * Browser-safe only. `cnblogsAdapter` renders the request body in the browser / desktop and publishes through
 * 辰记's API (`POST /notes/{id}/publish/cnblogs`), which adds the stored token and calls 博客园's MetaWeblog
 * (服务器代发, Python). There is no Node entry: server-side publishing exists only in the Python API.
 */
import { platformMeta } from '@starnote/publish-core';

import { createCnblogsAdapter } from './cnblogs';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './cnblogs';

export const cnblogsAdapter = createCnblogsAdapter();

/** The registry entry. */
export const cnblogsMeta = platformMeta('cnblogs') as PlatformMeta;
