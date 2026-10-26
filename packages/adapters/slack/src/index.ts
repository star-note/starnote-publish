/**
 * @starnote/publish-slack — Slack (incoming webhook, Block Kit): the card renderer, schema, webhook binding and the relay body; the copy-paste hand-off when no webhook is bound. Browser-safe only.
 */
import { platformMeta } from '@starnote/publish-core';

import { createSlackAdapter } from './slack';

import type { PlatformMeta } from '@starnote/publish-core';

export * from './slack';

export const slackAdapter = createSlackAdapter();

/** The registry entry. */
export const slackMeta = platformMeta('slack') as PlatformMeta;
