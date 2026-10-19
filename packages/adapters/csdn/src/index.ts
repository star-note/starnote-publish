/**
 * @starnote/publish-csdn — browser-safe entry: schema, Markdown rendering / preview, binding declaration, the
 * bundled signed site script and the adapter factory. CSDN runs as a hand-off on the desktop (its save API
 * is signed by CSDN's front-end): images are uploaded, the editor is opened and filled, the user publishes.
 */
import {
  bundledScript,
  platformMeta,
  sessionPartition,
  verifySession,
} from '@starnote/publish-core';

import { CSDN_SITE_SCRIPT } from './adapter';

import type {
  PlatformMeta,
  SessionCheckResult,
  SessionFetch,
  SiteScript,
} from '@starnote/publish-core';

export {
  createCsdnAdapter,
  CSDN_SITE_SCRIPT,
  csdnBinding,
  type CsdnAdapterOptions,
} from './adapter';
export { isCsdnImage, renderCsdn, withImages, type CsdnRendered } from './render';
export { CSDN_ARTICLE_TYPES, csdnSchema, type CsdnForm, type CsdnFormInput } from './schema';

export const csdnMeta = platformMeta('csdn') as PlatformMeta;

/** Read-only: is the account still logged in, and its nickname / avatar. */
export function verify(
  sessionFetch: SessionFetch,
  accountId: string,
  script: SiteScript = bundledScript(CSDN_SITE_SCRIPT)
): Promise<SessionCheckResult> {
  return verifySession(script, sessionFetch, sessionPartition('csdn', accountId));
}
