/**
 * @starnote/publish-kit — shared, browser-safe building blocks for the API and share adapters
 * (DEV, Hashnode, Ghost, WordPress, share-intent). Candidates to move into `@starnote/publish-core`
 * (SPEC-r8 §12.5 render steps, §12.4 report) once the core refactor settles.
 */
export {
  actionsFor,
  checkAction,
  errorFromStatus,
  formatWait,
  guard,
  helpAction,
  helpError,
  isOffline,
  isPlatformError,
  kindError,
  kindOfCode,
  networkError,
  parseRetryAfter,
  PlatformError,
  rateLimitError,
  reloginAction,
  reloginError,
  resendAction,
  retryAction,
  type ErrorLinks,
  type FailureCode,
  type PlatformRef,
} from './errors';
export {
  degradeArticle,
  degradeJson,
  degradeReport,
  youtubeId,
  type DegradeCounts,
  type DegradedArticle,
  type DegradeProfile,
  type DegradeTarget,
} from './degrade';
export {
  appendLink,
  codePoints,
  fitPost,
  fitSummary,
  fitTags,
  fitTitle,
  hashtagWord,
  linkCost,
  threadsLength,
  truncate,
  weiboLength,
  xWeightedLength,
  type FitPostInput,
  type FitPostResult,
  type FitTagsOptions,
} from './text';
export {
  containerIdOf,
  relayCheck,
  relayFinalize,
  relayPath,
  relayPublish,
  relayRequestOf,
  type RelayContext,
  type RelayResult,
} from './relay';
export { num, readJson, stats, type ReadOptions } from './stats';
export {
  absoluteUrl,
  articleOf,
  canonicalOf,
  cardOf,
  CLIENT_RELAY,
  linkedImagesReport,
  missingLinkReport,
  newPostReport,
  originNoteHtml,
  type CardSource,
} from './article';
export {
  base64url,
  completeWebAuthorization,
  credentialOf,
  MemoryCredentialStore,
  OAUTH_CALLBACK_MESSAGE,
  OAUTH_PLATFORMS,
  OAuthApiError,
  oauthState,
  parseOAuthCallback,
  pkcePair,
  randomToken,
  refreshPlatformToken,
  startWebAuthorization,
  STATE_RE,
  type CredentialSource,
  type OAuthAccount,
  type OAuthApi,
  type OAuthCallback,
  type OAuthPlatform,
  type OAuthTarget,
  type PlatformCredential,
  type TokenResult,
  type TokenSet,
  type WebAuthorization,
} from './oauth';

/**
 * A request 辰记's Python API makes on the platform (documentation the Python side follows; the browser never
 * sends these itself, it only renders the body).
 */
export interface RequestDescription {
  method: string;
  url: string;
  /** How the stored credential is attached, e.g. `api-key: <api_key>`. */
  auth: string;
  accept?: string;
  body?: string;
}

/** What the API's verify step reports: the account to show and store as `AccountRef`. */
export interface VerifiedAccount {
  externalUid: string;
  displayName: string;
  avatarUrl?: string;
  /** Profile / site URL. */
  url?: string;
  meta?: Record<string, unknown>;
}
