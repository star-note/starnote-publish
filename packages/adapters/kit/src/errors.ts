/**
 * Failure mapping shared by the API adapters: 401 → `relogin`, 429 → `retry` with the wait time, anything
 * else → `help` (plus `retry` for 5xx / network errors, which usually pass).
 *
 * Adapters just throw a `PlatformError`: the publisher (core) reads its `code`, `actions` and
 * `retryAfterSec` into the `failed` event.
 */
import { DEFAULT_GUIDE_LINKS } from '@starnote/publish-core';

import type { PublishContext, PublishEventAction } from '@starnote/publish-core';

/** Where the actions point; the host knows the guide URLs (they are notes with ids). */
export interface ErrorLinks {
  /** The platform's publishing guide. Absent: the action has no `href` and the host resolves `help:<key>`. */
  help?: (platform: string) => string | undefined;
  /** Where to (re)bind the account. Default `DEFAULT_GUIDE_LINKS.bind`. */
  bind?: (platform: string) => string;
}

export interface PlatformRef {
  /** Registry key, e.g. `devto`. */
  key: string;
  /** Display name, e.g. `DEV`. */
  label: string;
  links?: ErrorLinks;
}

/**
 * `relogin`: the credential is wrong or revoked. `rate_limited`: wait `retryAfterSec` and retry.
 * `network`: no answer. Anything else is `http_<status>` or a platform-specific word (`forbidden`,
 * `invalid`, `not_found`, `too_large`, `no_link` …) and comes with a `help` action.
 */
export type FailureCode =
  | 'relogin'
  | 'rate_limited'
  | 'network'
  | 'bind'
  | 'forbidden'
  | 'invalid'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'no_link'
  | `http_${number}`
  | (string & {});

export class PlatformError extends Error {
  readonly platform: string;
  readonly code: FailureCode;
  readonly status?: number;
  /** `rate_limited`: seconds to wait (from `Retry-After` / reset headers). */
  readonly retryAfterSec?: number;
  readonly actions: PublishEventAction[];
  readonly detail?: unknown;

  constructor(
    message: string,
    init: {
      platform: string;
      code: FailureCode;
      status?: number;
      retryAfterSec?: number;
      actions: PublishEventAction[];
      detail?: unknown;
    }
  ) {
    super(message);
    this.name = 'PlatformError';
    this.platform = init.platform;
    this.code = init.code;
    if (init.status !== undefined) this.status = init.status;
    if (init.retryAfterSec !== undefined) this.retryAfterSec = init.retryAfterSec;
    this.actions = init.actions;
    if (init.detail !== undefined) this.detail = init.detail;
  }
}

export function isPlatformError(e: unknown): e is PlatformError {
  return e instanceof PlatformError || (e as { name?: string } | null)?.name === 'PlatformError';
}

/* ---------------- actions ---------------- */

export function reloginAction(p: PlatformRef): PublishEventAction {
  const bind = p.links?.bind ?? DEFAULT_GUIDE_LINKS.bind;
  return { id: 'relogin', label: `重新绑定${p.label}`, kind: 'relogin', href: bind(p.key) };
}

export function retryAction(afterSec?: number): PublishEventAction {
  return {
    id: 'retry',
    label: afterSec ? `${formatWait(afterSec)}后重试` : '重试',
    kind: 'retry',
  };
}

export function helpAction(p: PlatformRef): PublishEventAction {
  const href = p.links?.help?.(p.key);
  return { id: `help:${p.key}`, label: '查看发布指南', kind: 'help', ...(href ? { href } : {}) };
}

/** 「30 秒」「2 分钟」「1 小时」 */
export function formatWait(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  return `${Math.round(sec / 3600)} 小时`;
}

/* ---------------- constructors ---------------- */

export function reloginError(p: PlatformRef, message?: string, status?: number): PlatformError {
  return new PlatformError(
    message ?? `${p.label} 拒绝了授权：凭据无效、已过期或已撤销，请重新绑定`,
    {
      platform: p.key,
      code: 'relogin',
      ...(status !== undefined ? { status } : {}),
      actions: [reloginAction(p), helpAction(p)],
    }
  );
}

export function rateLimitError(
  p: PlatformRef,
  retryAfterSec: number | undefined,
  detail?: string
): PlatformError {
  const wait = retryAfterSec ? `，请约 ${formatWait(retryAfterSec)}后重试` : '，请稍后重试';
  return new PlatformError(`${p.label} 请求太频繁（429）${wait}${detail ? `：${detail}` : ''}`, {
    platform: p.key,
    code: 'rate_limited',
    status: 429,
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    actions: [retryAction(retryAfterSec)],
  });
}

export function helpError(
  p: PlatformRef,
  message: string,
  init: { code?: FailureCode; status?: number; retryable?: boolean; detail?: unknown } = {}
): PlatformError {
  return new PlatformError(message, {
    platform: p.key,
    code: init.code ?? (init.status ? `http_${init.status}` : 'invalid'),
    ...(init.status !== undefined ? { status: init.status } : {}),
    actions: init.retryable ? [helpAction(p), retryAction()] : [helpAction(p)],
    ...(init.detail !== undefined ? { detail: init.detail } : {}),
  });
}

/**
 * Seconds to wait from `Retry-After` (seconds or HTTP-date), else `RateLimit-Reset` / `X-RateLimit-Reset`
 * (delta seconds, or an epoch timestamp when larger than a day).
 */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | undefined {
  const ra = headers.get('retry-after');
  if (ra) {
    const n = Number(ra.trim());
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(1, Math.ceil((at - now) / 1000));
  }
  const reset = headers.get('ratelimit-reset') ?? headers.get('x-ratelimit-reset');
  if (reset) {
    const n = Number(reset.trim());
    if (Number.isFinite(n) && n >= 0) {
      return n > 86_400 ? Math.max(1, Math.ceil(n - now / 1000)) : Math.ceil(n);
    }
  }
  return undefined;
}

/** The standard mapping for a non-2xx answer. `message` is the platform's own explanation, if any. */
export function errorFromStatus(
  p: PlatformRef,
  status: number,
  headers: Headers,
  message?: string
): PlatformError {
  if (status === 401) return reloginError(p, undefined, status);
  if (status === 429) return rateLimitError(p, parseRetryAfter(headers), message);
  const hint =
    status === 403
      ? '没有权限'
      : status === 404
        ? '找不到资源'
        : status === 413
          ? '内容太大'
          : status >= 500
            ? '平台服务出错'
            : '请求被拒绝';
  return helpError(p, `${p.label} ${hint}（HTTP ${status}）${message ? `：${message}` : ''}`, {
    status,
    code:
      status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 409
            ? 'conflict'
            : status === 413
              ? 'too_large'
              : `http_${status}`,
    retryable: status >= 500,
  });
}

/** A fetch that threw (DNS, TLS, CORS, offline). */
export function networkError(p: PlatformRef, cause: unknown): PlatformError {
  const why = cause instanceof Error ? cause.message : String(cause);
  return new PlatformError(`连不上 ${p.label}：${why}`, {
    platform: p.key,
    code: 'network',
    actions: [retryAction(), helpAction(p)],
  });
}

/**
 * Runs an adapter step and makes sure what escapes is a `PlatformError` (anything else is mapped to
 * `help`), so the publisher's `failed` event carries the right actions. Cancellation passes through.
 */
export async function guard<T>(
  ctx: Pick<PublishContext, 'signal'>,
  p: PlatformRef,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    if (ctx.signal?.aborted) throw cause;
    throw isPlatformError(cause)
      ? cause
      : helpError(p, cause instanceof Error ? cause.message : String(cause), { code: 'error' });
  }
}
