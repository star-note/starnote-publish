/**
 * Types only (SPEC-r8 §7.4, §10.4): post-publish stats and engagement. Nothing implements them yet;
 * adapters may declare `fetchStats` / `engage` so hosts can plan for them.
 */
import type { AccountRef } from './binding';
import type { PublishContext } from './types';

export interface PostRef {
  platform: string;
  externalId: string;
  url?: string;
  account?: AccountRef;
  publishedAt?: string;
}

/** `starnote`: our own aggregated counts (e.g. GitHub Pages beacons committed to the repo). */
export type StatsSource = 'official-api' | 'public' | 'console' | 'starnote';

export interface PlatformStats {
  fetchedAt: string;
  source: StatsSource;
  views?: number;
  reads?: number;
  likes?: number;
  comments?: number;
  favorites?: number;
  shares?: number;
  followersGained?: number;
  revenue?: { amountMicros: number; currency: string };
  extra?: Record<string, number | string>;
}

export type StatsContext = Pick<PublishContext, 'fetch' | 'signal' | 'runtime' | 'page'> & {
  account?: AccountRef;
  url?: string;
  /** API root, for adapters that fetch credentials from the 辰记 API. */
  apiBase?: string;
};

export interface StatsDriver {
  /** `null`: the post is gone or hidden. */
  fetchStats(externalId: string, ctx: StatsContext): Promise<PlatformStats | null>;
  fetchStatsBatch?(
    externalIds: string[],
    ctx: StatsContext
  ): Promise<Map<string, PlatformStats | null>>;
  /** What the call needs; the host schedules it on a runtime that has it. */
  requires: 'none' | 'token' | 'session';
}

export type EngageAction = 'reply' | 'hide' | 'delete' | 'like' | 'follow' | 'comment' | 'bookmark';
export type EngageRisk = 'readonly' | 'low' | 'high';

export interface CommentRef {
  platform: string;
  externalId: string;
  postExternalId: string;
}

export interface EngageTarget {
  platform: string;
  url?: string;
  externalId?: string;
}

export interface PlatformComment {
  externalId: string;
  postExternalId: string;
  author: { id: string; name: string; avatar?: string };
  text: string;
  createdAt: string;
  parentId?: string;
  likeCount?: number;
  /** Filled by the host (AI intent classification and draft reply). */
  intent?: 'purchase_intent' | 'question' | 'complaint' | 'praise' | 'spam' | 'other';
  draft?: string;
}

export interface EngagePolicy {
  platform: string;
  accountId: string;
  level: 'off' | 'readonly' | 'draft' | 'auto-reply' | 'proactive';
  autoReplyIntents: Array<'question' | 'praise'>;
  limits: { perHour: number; perDay: number; minIntervalSec: number };
  quietHours?: { from: string; to: string; tz: string };
  killSwitch: boolean;
  proactiveConsentAt?: string;
}

export interface EngageContext extends Pick<
  PublishContext,
  'fetch' | 'signal' | 'runtime' | 'page' | 'emit'
> {
  account: AccountRef;
  /** Host rate limiter; throws when over the limit. Adapters never count themselves. */
  guard(action: EngageAction): Promise<void>;
}

export interface EngageDriver {
  supports: Partial<Record<EngageAction, EngageRisk>>;
  listComments(
    ref: PostRef,
    opts: { cursor?: string; since?: string },
    ctx: EngageContext
  ): Promise<{ items: PlatformComment[]; cursor?: string }>;
  reply?(comment: CommentRef, text: string, ctx: EngageContext): Promise<{ externalId: string }>;
  hide?(comment: CommentRef, ctx: EngageContext): Promise<void>;
  /** L2, only after the user opted in explicitly. */
  act?(
    action: 'like' | 'follow' | 'comment' | 'bookmark',
    target: EngageTarget,
    ctx: EngageContext
  ): Promise<void>;
}
