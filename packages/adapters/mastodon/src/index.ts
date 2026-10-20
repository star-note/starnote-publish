/**
 * @starnote/publish-mastodon — Mastodon (any instance, OAuth with per-instance app registration by 辰记's API):
 * schema, binding, text fitting, preview, the relay body and the official requests. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createMastodonAdapter } from './mastodon';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './mastodon';

export const mastodonAdapter = createMastodonAdapter();

/** The registry entry. */
export const mastodonMeta = platformMeta('mastodon') as PlatformMeta;
