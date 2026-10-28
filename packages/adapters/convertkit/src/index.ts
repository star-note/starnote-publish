/**
 * @starnote/publish-convertkit — Kit (ConvertKit): schema, binding, rendering / preview, the relay body (`convertkitRelayBody`) and the
 * request descriptions the API follows (`CONVERTKIT_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `convertkitAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/convertkit`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createConvertkitAdapter } from './convertkit';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './convertkit';

export const convertkitAdapter = createConvertkitAdapter();

/** The registry entry. */
export const convertkitMeta = platformMeta('convertkit') as PlatformMeta;
