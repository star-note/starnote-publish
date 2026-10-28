/**
 * @starnote/publish-telegraph — Telegraph: schema, binding, rendering / preview, the relay body (`telegraphRelayBody`) and the
 * request descriptions the API follows (`TELEGRAPH_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `telegraphAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/telegraph`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createTelegraphAdapter } from './telegraph';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './telegraph';

export const telegraphAdapter = createTelegraphAdapter();

/** The registry entry. */
export const telegraphMeta = platformMeta('telegraph') as PlatformMeta;
