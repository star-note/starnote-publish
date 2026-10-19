/**
 * @starnote/publish-share — share-intent / import-url hand-off for X, LinkedIn, Reddit (fallback), Facebook, 微博,
 * Threads, Telegram, Pinterest and Medium (Import story). Browser-safe, no binding, runs on every runtime.
 */
import { createShareAdapters } from './share';

export * from './share';

/** Default adapters (no AI rewrite, sharer.php for Facebook). */
export const shareAdapters = createShareAdapters();
