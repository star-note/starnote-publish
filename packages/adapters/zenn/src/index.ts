/**
 * @starnote/publish-zenn — Zenn: schema, binding, rendering / preview, the relay body (`zennRelayBody`) and the
 * request descriptions the API follows (`ZENN_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `zennAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/zenn`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createZennAdapter } from './zenn';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './zenn';

export const zennAdapter = createZennAdapter();

/** The registry entry. */
export const zennMeta = platformMeta('zenn') as PlatformMeta;
