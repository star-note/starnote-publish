/**
 * @starnote/publish-github-pages — browser-safe entry: schema, binding declaration, repository layout,
 * rendering / preview, site settings (site.json, custom domain, AdSense), the Git Data API commit, token verification
 * and Pages setup. Server-side publishing (the default: the token stays encrypted on the server) is done by 辰记's
 * Python API (`POST /notes/{id}/publish/github-pages`, `app/services/github_publish.py`, same rendering — see the
 * byte-for-byte parity test there); `./web` / `./electron` are a temporary direct path.
 */
import { platformMeta } from '@starnote/publish-core';

import type { PlatformMeta } from '@starnote/publish-core';

export { createGithubPagesAdapter, type GithubPagesAdapterOptions } from './shared/adapter';
export {
  commitFiles,
  gitBlobSha,
  sha256Hex,
  toBase64,
  type CommitFilesOptions,
  type CommitFilesResult,
  type GitFile,
} from './shared/git';
export {
  github,
  GITHUB_API,
  GitHubApiError,
  type GitHubClientOptions,
  type GitHubResponse,
} from './shared/github';
export {
  GENERATOR,
  GITHUB_PAGES_LANGUAGES,
  GITHUB_PAGES_LAYOUT,
  postFileName,
  postUrl,
  resolveLayout,
  siteBaseUrl,
  type GithubPagesLanguage,
  type GithubPagesLayout,
} from './shared/layout';
export {
  defaultPostId,
  frontMatter,
  renderPost,
  rewriteImageSources,
  type RenderedFile,
  type RenderedPost,
  type RenderPostInput,
} from './shared/render';
export {
  githubPagesSchema,
  type GithubPagesForm,
  type GithubPagesFormInput,
} from './shared/schema';
export {
  connect,
  detectRepo,
  ensurePages,
  GITHUB_TEMPLATE,
  GITHUB_TOKEN_CREATE_URL,
  GITHUB_TOKEN_PERMISSIONS,
  githubPagesBinding,
  githubTokenForm,
  MANY_REPOS_WARNING,
  parseTokenExpiration,
  templateRepoUrl,
  tokenCreateUrl,
  verify,
  verifyGithubToken,
  type ConnectOptions,
  type ConnectResult,
  type ConnectStep,
  type ConnectStepId,
  type DetectRepoResult,
  type EnsurePagesOptions,
  type EnsurePagesResult,
  type GithubTokenForm,
  type VerifyTokenResult,
} from './shared/binding';
export {
  AD_SLOT_KEYS,
  ADSENSE_CLIENT_RE,
  ADSENSE_SLOT_RE,
  apexOf,
  applySiteSettings,
  dnsRecords,
  enforceHttps,
  GITHUB_PAGES_A_RECORDS,
  GITHUB_PAGES_AAAA_RECORDS,
  isApexDomain,
  normalizeDomain,
  normalizeMonetize,
  readRepoText,
  setPagesDomain,
  siteConfigText,
  type AdSlotKey,
  type DnsRecord,
  type GithubAdsense,
  type GithubMonetize,
  type GithubSiteSettings,
  type HttpsState,
  type StarnoteSiteInfo,
} from './shared/site';
export { GithubPagesError, type TokenContext } from './shared/token';

/** The registry entry (key, name, colour, runtimes, binding…). */
export const githubPagesMeta = platformMeta('github-pages') as PlatformMeta;
