/**
 * @starnote/publish-devto — schema, binding, rendering / preview, the relay body (`devtoRelayBody`) and the request descriptions the API follows (`DEVTO_REQUESTS`).
 *
 * Browser-safe only. `devtoAdapter` renders the request body in the browser / desktop and publishes through
 * 辰记's API (`POST /notes/{id}/publish/devto`), which adds the stored credential and calls the platform
 * (服务器代发, Python). There is no Node entry: server-side publishing exists only in the Python API.
 */
import { platformMeta } from '@starnote/publish-core';

import { createDevtoAdapter } from './devto';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './devto';

export const devtoAdapter = createDevtoAdapter();

/** The registry entry. */
export const devtoMeta = platformMeta('devto') as PlatformMeta;
