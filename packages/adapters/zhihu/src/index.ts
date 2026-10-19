/**
 * @starnote/publish-zhihu — browser-safe entry: schema, rendering / preview, the binding declaration, the
 * bundled signed site script and the adapter factory. Publishing needs the desktop (`ctx.sessionFetch`,
 * implemented by starnote-desktop's main process); the `./electron` entry registers it.
 */
import {
  bundledScript,
  platformMeta,
  sessionPartition,
  verifySession,
} from '@starnote/publish-core';

import { ZHIHU_SITE_SCRIPT } from './adapter';

import type {
  PlatformMeta,
  SessionCheckResult,
  SessionFetch,
  SiteScript,
} from '@starnote/publish-core';

export {
  createZhihuAdapter,
  ZHIHU_SITE_SCRIPT,
  zhihuBinding,
  type ZhihuAdapterOptions,
} from './adapter';
export { isZhihuImage, renderZhihu, toZhihuHtml, withImages, type ZhihuRendered } from './render';
export { zhihuSchema, type ZhihuForm, type ZhihuFormInput } from './schema';

export const zhihuMeta = platformMeta('zhihu') as PlatformMeta;

/** Read-only: is the account still logged in, and its nickname / avatar (via `/api/v4/me`). */
export function verify(
  sessionFetch: SessionFetch,
  accountId: string,
  script: SiteScript = bundledScript(ZHIHU_SITE_SCRIPT)
): Promise<SessionCheckResult> {
  return verifySession(script, sessionFetch, sessionPartition('zhihu', accountId));
}
