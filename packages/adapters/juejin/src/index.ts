/**
 * @starnote/publish-juejin — browser-safe entry: schema, Markdown rendering / preview, binding declaration,
 * the bundled signed site script, the adapter factory and category / tag lookups. Publishing needs the
 * desktop (`ctx.sessionFetch`); the `./electron` entry registers it.
 */
import {
  bundledScript,
  platformMeta,
  sessionPartition,
  verifySession,
} from '@starnote/publish-core';

import { JUEJIN_SITE_SCRIPT } from './adapter';

import type {
  PlatformMeta,
  SessionCheckResult,
  SessionFetch,
  SiteScript,
} from '@starnote/publish-core';

export {
  createJuejinAdapter,
  JUEJIN_SITE_SCRIPT,
  juejinBinding,
  juejinCategories,
  juejinSearchTags,
  type JuejinAdapterOptions,
} from './adapter';
export {
  isJuejinImage,
  juejinBrief,
  renderJuejin,
  withImages,
  type JuejinRendered,
} from './render';
export { juejinSchema, type JuejinForm, type JuejinFormInput } from './schema';

export const juejinMeta = platformMeta('juejin') as PlatformMeta;

/** Read-only: is the account still logged in, and its nickname / avatar (`user_api/v1/user/get`). */
export function verify(
  sessionFetch: SessionFetch,
  accountId: string,
  script: SiteScript = bundledScript(JUEJIN_SITE_SCRIPT)
): Promise<SessionCheckResult> {
  return verifySession(script, sessionFetch, sessionPartition('juejin', accountId));
}
