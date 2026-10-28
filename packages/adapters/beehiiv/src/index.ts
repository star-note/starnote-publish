/**
 * @starnote/publish-beehiiv — beehiiv: schema, binding, rendering / preview, the relay body (`beehiivRelayBody`) and the
 * request descriptions the API follows (`BEEHIIV_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `beehiivAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/beehiiv`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createBeehiivAdapter } from './beehiiv';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './beehiiv';

export const beehiivAdapter = createBeehiivAdapter();

/** The registry entry. */
export const beehiivMeta = platformMeta('beehiiv') as PlatformMeta;
