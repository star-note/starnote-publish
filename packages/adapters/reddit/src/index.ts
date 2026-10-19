/**
 * @starnote/publish-reddit — Reddit (OAuth API): link / text posts, schema, binding, preview, the relay body and the
 * official requests. Browser-safe only. Without an approved Reddit app use the share-intent in
 * `@starnote/publish-share`.
 */
import { platformMeta } from '@starnote/publish-core';

import { createRedditAdapter } from './reddit';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './reddit';

export const redditAdapter = createRedditAdapter();

/** The registry entry. */
export const redditMeta = platformMeta('reddit') as PlatformMeta;
