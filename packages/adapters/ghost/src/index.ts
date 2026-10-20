/**
 * @starnote/publish-ghost — schema, binding, rendering / preview, the relay body and the Admin API requests the API sends (`GHOST_REQUESTS`).
 *
 * Browser-safe only. `ghostAdapter` renders the request body in the browser / desktop and publishes through
 * 辰记's API (`POST /notes/{id}/publish/ghost`), which adds the stored credential and calls the platform
 * (服务器代发, Python). There is no Node entry: server-side publishing exists only in the Python API.
 */
import { platformMeta } from '@starnote/publish-core';

import { createGhostAdapter } from './ghost';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './ghost';

export const ghostAdapter = createGhostAdapter();

export const ghostMeta = platformMeta('ghost') as PlatformMeta;
