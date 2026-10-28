/**
 * @starnote/publish-buttondown — Buttondown: schema, binding, rendering / preview, the relay body (`buttondownRelayBody`) and the
 * request descriptions the API follows (`BUTTONDOWN_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `buttondownAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/buttondown`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createButtondownAdapter } from './buttondown';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './buttondown';

export const buttondownAdapter = createButtondownAdapter();

/** The registry entry. */
export const buttondownMeta = platformMeta('buttondown') as PlatformMeta;
