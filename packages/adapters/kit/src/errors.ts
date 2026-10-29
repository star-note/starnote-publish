/**
 * Failure mapping shared by the API adapters: 401 → `relogin`, 429 → `retry` with the wait time, anything
 * else → `help` (plus `retry` for 5xx / network errors, which usually pass).
 *
 * SPEC-r11 §1: every `PlatformError` also has an `errorKind` (`refresh` / `retry` / `bad_body` / `disconnect` /
 * `unknown`); the relay prefers the server's `error_kind`. Actions follow the kind: `disconnect` → relogin,
 * `retry` → retry (with `retryAfterSec`), `unknown` → help 「去平台确认」 + 「仍要重发」 (never automatic: writes are
 * not retried by the SDK, see `ErrorKind`).
 *
 * Adapters just throw a `PlatformError`: the publisher (core) reads its `code`, `actions`, `retryAfterSec` and
 * `errorKind` into the `failed` event.
 */
import { coreMessages, DEFAULT_GUIDE_LINKS } from '@starnote/publish-core';

import { kitMessages, refIn, waitText } from './i18n';

import type {
  ErrorKind,
  PublishContext,
  PublishEventAction,
  SdkLang,
} from '@starnote/publish-core';

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
  /** Display name, e.g. `DEV` (in `lang`: see `refIn`). */
  label: string;
  links?: ErrorLinks;
  /** SPEC-r14 B5: language of the messages and action labels built from this ref. Default `zh-CN`. */
  lang?: SdkLang;
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

/** The kind a code / status means when nobody said (SPEC-r11 §1). */
export function kindOfCode(code: FailureCode, status?: number): ErrorKind {
  if (code === 'relogin' || code === 'disconnect') return 'disconnect';
  if (code === 'rate_limited' || code === 'network') return 'retry';
  if (code === 'in_progress' || code === 'timeout') return 'unknown';
  if (status !== undefined && (status === 429 || status >= 500)) return 'retry';
  return 'bad_body';
}

export class PlatformError extends Error {
  readonly platform: string;
  readonly code: FailureCode;
  readonly status?: number;
  /** `rate_limited`: seconds to wait (from `Retry-After` / reset headers). */
  readonly retryAfterSec?: number;
  readonly actions: PublishEventAction[];
  readonly detail?: unknown;
  /** SPEC-r11 §1 (the publisher's `failed.kind`). */
  readonly errorKind: ErrorKind;

  constructor(
    message: string,
    init: {
      platform: string;
      code: FailureCode;
      status?: number;
      retryAfterSec?: number;
      actions: PublishEventAction[];
      detail?: unknown;
      /** Default: from `code` / `status` (`kindOfCode`). */
      kind?: ErrorKind;
    }
  ) {
    super(message);
    this.name = 'PlatformError';
    this.platform = init.platform;
    this.code = init.code;
    this.errorKind = init.kind ?? kindOfCode(init.code, init.status);
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
  return {
    id: 'relogin',
    label: kitMessages(p.lang).errors.rebind(p.label),
    kind: 'relogin',
    href: bind(p.key),
  };
}

export function retryAction(afterSec?: number, lang?: SdkLang): PublishEventAction {
  const m = coreMessages(lang).common;
  return {
    id: 'retry',
    label: afterSec ? m.retryAfter(formatWait(afterSec, lang)) : m.retry,
    kind: 'retry',
  };
}

export function helpAction(p: PlatformRef): PublishEventAction {
  const href = p.links?.help?.(p.key);
  return {
    id: `help:${p.key}`,
    label: kitMessages(p.lang).errors.viewGuide,
    kind: 'help',
    ...(href ? { href } : {}),
  };
}

/** `unknown`: check on the platform before sending again (`href`: the post, when known). */
export function checkAction(p: PlatformRef, href?: string): PublishEventAction {
  return {
    id: `check:${p.key}`,
    label: coreMessages(p.lang).common.checkOnPlatform,
    kind: 'help',
    ...(href ? { href } : {}),
  };
}

/** `unknown`: the user may still send it again — a new attempt (new `Idempotency-Key`). */
export function resendAction(lang?: SdkLang): PublishEventAction {
  return { id: 'retry', label: coreMessages(lang).common.resendAnyway, kind: 'retry' };
}

/** The actions of a kind (SPEC-r11 §1.2). */
export function actionsFor(
  p: PlatformRef,
  kind: ErrorKind,
  opts: { retryAfterSec?: number; checkHref?: string } = {}
): PublishEventAction[] {
  switch (kind) {
    case 'disconnect':
      return [reloginAction(p), helpAction(p)];
    case 'retry':
    case 'refresh':
      return [retryAction(opts.retryAfterSec, p.lang)];
    case 'unknown':
      return [checkAction(p, opts.checkHref), resendAction(p.lang)];
    default:
      return [helpAction(p)];
  }
}

/** A failure of the given kind with its actions. */
export function kindError(
  p: PlatformRef,
  kind: ErrorKind,
  message: string,
  init: { code?: FailureCode; status?: number; retryAfterSec?: number; detail?: unknown } = {}
): PlatformError {
  return new PlatformError(message, {
    platform: p.key,
    code:
      init.code ??
      (kind === 'disconnect'
        ? 'relogin'
        : kind === 'retry'
          ? 'rate_limited'
          : init.status
            ? `http_${init.status}`
            : kind),
    ...(init.status !== undefined ? { status: init.status } : {}),
    ...(init.retryAfterSec !== undefined ? { retryAfterSec: init.retryAfterSec } : {}),
    actions: actionsFor(p, kind, {
      ...(init.retryAfterSec !== undefined ? { retryAfterSec: init.retryAfterSec } : {}),
    }),
    ...(init.detail !== undefined ? { detail: init.detail } : {}),
    kind,
  });
}

/** 「30 秒」「2 分钟」「1 小时」 (SPEC-r14 B5: in `lang`, default `zh-CN`). */
export function formatWait(sec: number, lang?: SdkLang): string {
  return waitText(sec, lang);
}

/* ---------------- constructors ---------------- */

export function reloginError(p: PlatformRef, message?: string, status?: number): PlatformError {
  return new PlatformError(message ?? kitMessages(p.lang).errors.revoked(p.label), {
    platform: p.key,
    code: 'relogin',
    ...(status !== undefined ? { status } : {}),
    actions: [reloginAction(p), helpAction(p)],
    kind: 'disconnect',
  });
}

export function rateLimitError(
  p: PlatformRef,
  retryAfterSec: number | undefined,
  detail?: string
): PlatformError {
  const m = kitMessages(p.lang).errors;
  const wait = retryAfterSec ? m.waitThenRetry(formatWait(retryAfterSec, p.lang)) : m.retryLater;
  return new PlatformError(m.rateLimited(p.label, wait, detail ?? ''), {
    platform: p.key,
    code: 'rate_limited',
    status: 429,
    ...(retryAfterSec !== undefined ? { retryAfterSec } : {}),
    actions: [retryAction(retryAfterSec, p.lang)],
    kind: 'retry',
  });
}

export function helpError(
  p: PlatformRef,
  message: string,
  init: {
    code?: FailureCode;
    status?: number;
    retryable?: boolean;
    detail?: unknown;
    /** Default: `retry` when `retryable`, else from code / status. */
    kind?: ErrorKind;
  } = {}
): PlatformError {
  const code = init.code ?? (init.status ? `http_${init.status}` : 'invalid');
  return new PlatformError(message, {
    platform: p.key,
    code,
    ...(init.status !== undefined ? { status: init.status } : {}),
    actions: init.retryable ? [helpAction(p), retryAction(undefined, p.lang)] : [helpAction(p)],
    ...(init.detail !== undefined ? { detail: init.detail } : {}),
    kind: init.kind ?? (init.retryable ? 'retry' : kindOfCode(code, init.status)),
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
  const m = kitMessages(p.lang).errors;
  const hint =
    status === 403
      ? m.forbidden
      : status === 404
        ? m.notFound
        : status === 413
          ? m.tooLarge
          : status >= 500
            ? m.serverError
            : m.rejected;
  return helpError(p, m.http(p.label, hint, status, message ?? ''), {
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

/** True when the browser says it is offline (a request then certainly was not sent). */
export function isOffline(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine === false;
}

/**
 * A fetch that threw (DNS, TLS, CORS, offline, timeout, dropped connection). For a **write** (`write: true`) the
 * request may have reached the platform, so the kind is `unknown` (never retried automatically) unless the
 * browser is offline; reads are `retry`.
 */
export function networkError(
  p: PlatformRef,
  cause: unknown,
  opts: { write?: boolean } = {}
): PlatformError {
  const why = cause instanceof Error ? cause.message : String(cause);
  const m = kitMessages(p.lang).errors;
  if (opts.write && !isOffline())
    return new PlatformError(m.writeInterrupted(p.label, why), {
      platform: p.key,
      code: 'network',
      actions: actionsFor(p, 'unknown'),
      kind: 'unknown',
    });
  return new PlatformError(m.unreachable(p.label, why), {
    platform: p.key,
    code: 'network',
    actions: [retryAction(undefined, p.lang), helpAction(p)],
    kind: 'retry',
  });
}

/**
 * Runs an adapter step and makes sure what escapes is a `PlatformError` (anything else is mapped to
 * `help`), so the publisher's `failed` event carries the right actions. Cancellation passes through.
 */
export async function guard<T>(
  ctx: Pick<PublishContext, 'signal'> & { lang?: SdkLang },
  p: PlatformRef,
  fn: () => Promise<T>
): Promise<T> {
  p = refIn(p, ctx.lang);
  try {
    return await fn();
  } catch (cause) {
    if (ctx.signal?.aborted) throw cause;
    throw isPlatformError(cause)
      ? cause
      : helpError(p, cause instanceof Error ? cause.message : String(cause), { code: 'error' });
  }
}
