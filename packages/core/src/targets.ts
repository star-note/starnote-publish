/**
 * SPEC-r11 helpers shared by the publisher, the kit and hosts: target keys (multi-account, §5.3), idempotency keys
 * (§3), the canonical placeholder of scheduled batches (§4.1) and failure kinds (§1).
 */
import { ERROR_KINDS } from './types';

import type { ErrorKind, PublishContext, PublishTarget } from './types';

/**
 * Written wherever a link back to 辰记 belongs (canonical, 「本文首发于辰记」, share links) when 辰记 is in the same
 * scheduled batch and not published yet. The server runs 辰记 first (`seq = 0`) and replaces every occurrence in
 * the later tasks' JSON with the real link (SPEC-r11 §4.1). Shorter than a real link: renderers that count the
 * link's length reserve `CANONICAL_PLACEHOLDER_RESERVE` characters for it.
 */
export const CANONICAL_PLACEHOLDER = '__STARNOTE_CANONICAL_URL__';

/** Characters a renderer counts for the placeholder (a real 辰记 link is about 35–45). */
export const CANONICAL_PLACEHOLDER_RESERVE = 64;

/** True when `value` (any JSON) contains the placeholder. */
export function hasCanonicalPlaceholder(value: unknown): boolean {
  if (value === undefined) return false;
  return JSON.stringify(value).includes(CANONICAL_PLACEHOLDER);
}

/**
 * What the server does: every placeholder in a task's JSON becomes `url` (for tests and the desktop's catch-up,
 * which may receive a task the server already filled).
 */
export function fillCanonicalPlaceholder<T>(value: T, url: string): T {
  if (value === undefined) return value;
  const json = JSON.stringify(value);
  if (!json.includes(CANONICAL_PLACEHOLDER)) return value;
  // the URL is inserted inside JSON strings: escape it as a JSON string body
  const safe = JSON.stringify(url).slice(1, -1);
  return JSON.parse(json.split(CANONICAL_PLACEHOLDER).join(safe)) as T;
}

/** The key of a target's result: the platform, or `platform@accountId` when the target names an account. */
export function targetKey(target: Pick<PublishTarget, 'platform' | 'accountId'>): string {
  return target.accountId ? `${target.platform}@${target.accountId}` : target.platform;
}

/** SPEC-r11 §3: at most 200 characters. */
export const IDEMPOTENCY_KEY_MAX = 200;

/**
 * The relay's `Idempotency-Key` for a publish: `ctx.idempotencyKey` when given, else
 * `${jobId}:${platform}:${accountId ?? 'default'}:${attempt}` when the job has an id, else none.
 */
export function idempotencyKeyOf(
  ctx: Pick<PublishContext, 'idempotencyKey' | 'jobId' | 'attempt' | 'accountId' | 'account'>,
  platform: string
): string | undefined {
  const key =
    ctx.idempotencyKey ||
    (ctx.jobId
      ? `${ctx.jobId}:${platform}:${ctx.accountId ?? ctx.account?.id ?? 'default'}:${ctx.attempt ?? 1}`
      : undefined);
  return key ? key.slice(0, IDEMPOTENCY_KEY_MAX) : undefined;
}

/** `finalize`'s key: `finalize:${platform}:${containerId}` — the same container always finalizes once. */
export function finalizeKeyOf(platform: string, containerId: string): string {
  return `finalize:${platform}:${containerId}`.slice(0, IDEMPOTENCY_KEY_MAX);
}

export function isErrorKind(v: unknown): v is ErrorKind {
  return typeof v === 'string' && (ERROR_KINDS as readonly string[]).includes(v);
}

/**
 * The failure kind of a thrown error: its `errorKind` (kit `PlatformError`), else what a session error's kind or a
 * known code means (`relogin` → `disconnect`, `rate_limited` → `retry`). `undefined` when nothing says.
 */
export function errorKindOf(cause: unknown): ErrorKind | undefined {
  const c = cause as { errorKind?: unknown; kind?: unknown; code?: unknown; name?: unknown } | null;
  if (!c || typeof c !== 'object') return undefined;
  if (isErrorKind(c.errorKind)) return c.errorKind;
  if (c.name === 'PlatformSessionError') {
    if (c.kind === 'relogin') return 'disconnect';
    if (c.kind === 'retry') return 'retry';
    if (c.kind === 'help') return 'bad_body';
    return undefined;
  }
  if (c.code === 'relogin') return 'disconnect';
  if (c.code === 'rate_limited') return 'retry';
  return undefined;
}
