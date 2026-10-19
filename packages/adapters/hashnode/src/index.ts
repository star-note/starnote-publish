/**
 * @starnote/publish-hashnode — schema, binding, rendering / preview, the relay body and the GraphQL documents the API sends (`HASHNODE_QUERIES`).
 *
 * Browser-safe only. `hashnodeAdapter` renders the request body in the browser / desktop and publishes through
 * 辰记's API (`POST /notes/{id}/publish/hashnode`), which adds the stored credential and calls the platform
 * (服务器代发, Python). There is no Node entry: server-side publishing exists only in the Python API.
 */
import { platformMeta } from '@starnote/publish-core';

import { createHashnodeAdapter } from './hashnode';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './hashnode';

export const hashnodeAdapter = createHashnodeAdapter();

export const hashnodeMeta = platformMeta('hashnode') as PlatformMeta;
