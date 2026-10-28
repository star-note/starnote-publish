/**
 * @starnote/publish-hatena — はてなブログ: schema, binding, rendering / preview, the relay body (`hatenaRelayBody`) and the
 * request descriptions the API follows (`HATENA_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `hatenaAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/hatena`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createHatenaAdapter } from './hatena';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './hatena';

export const hatenaAdapter = createHatenaAdapter();

/** The registry entry. */
export const hatenaMeta = platformMeta('hatena') as PlatformMeta;
