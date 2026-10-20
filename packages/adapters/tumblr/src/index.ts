/**
 * @starnote/publish-tumblr — Tumblr (OAuth2 + NPF): schema, binding, the Tiptap → NPF converter, preview, the relay
 * body and the official requests. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createTumblrAdapter } from './tumblr';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './npf';
export * from './tumblr';

export const tumblrAdapter = createTumblrAdapter();

/** The registry entry. */
export const tumblrMeta = platformMeta('tumblr') as PlatformMeta;
