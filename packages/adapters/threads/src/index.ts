/**
 * @starnote/publish-threads — Threads (Threads API, OAuth): the post renderer, three-stage publishing through the relay (`/check`, `/finalize`), post insights; the threads intent when not bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createThreadsAdapter } from './threads';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './threads';

export const threadsAdapter = createThreadsAdapter();

/** The registry entry. */
export const threadsMeta = platformMeta('threads') as PlatformMeta;
