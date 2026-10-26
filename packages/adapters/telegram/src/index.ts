/**
 * @starnote/publish-telegram — Telegram (Bot API): the link-card renderer, schema, token binding, the relay body and
 * the official requests; the `t.me/share/url` hand-off when no bot is bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createTelegramAdapter } from './telegram';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './telegram';

export const telegramAdapter = createTelegramAdapter();

/** The registry entry. */
export const telegramMeta = platformMeta('telegram') as PlatformMeta;
