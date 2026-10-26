/**
 * @starnote/publish-discord — Discord (channel webhook): the content + embed card renderer, schema, webhook binding and the relay body; the copy-paste hand-off when no webhook is bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createDiscordAdapter } from './discord';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './discord';

export const discordAdapter = createDiscordAdapter();

/** The registry entry. */
export const discordMeta = platformMeta('discord') as PlatformMeta;
