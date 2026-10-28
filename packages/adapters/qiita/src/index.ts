/**
 * @starnote/publish-qiita — Qiita: schema, binding, rendering / preview, the relay body (`qiitaRelayBody`) and the
 * request descriptions the API follows (`QIITA_REQUESTS`). SPEC-r14 A1.
 *
 * Browser-safe only. `qiitaAdapter` renders the request body in the browser / desktop and publishes through 辰记's API
 * (`POST /notes/{id}/publish/qiita`), which adds the stored credential and calls the platform (服务器代发, Python).
 */
import { platformMeta } from '@starnote/publish-core';

import { createQiitaAdapter } from './qiita';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './qiita';

export const qiitaAdapter = createQiitaAdapter();

/** The registry entry. */
export const qiitaMeta = platformMeta('qiita') as PlatformMeta;
