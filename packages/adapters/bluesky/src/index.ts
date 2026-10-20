/**
 * @starnote/publish-bluesky — Bluesky (AT Protocol): the post renderer (text, hashtag facets, link card), the adapter,
 * and the page-side atproto OAuth client (`./oauth`: PKCE + PAR + DPoP, page memory only) that also posts straight
 * to the PDS from the web. Browser-safe (WebCrypto).
 */
import { platformMeta } from '@starnote/publish-core';

import { createBlueskyAdapter } from './bluesky';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './bluesky';
export * from './limits';
export * from './oauth';

export const blueskyAdapter = createBlueskyAdapter();

/** The registry entry. */
export const blueskyMeta = platformMeta('bluesky') as PlatformMeta;
