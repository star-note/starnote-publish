/**
 * Relay publishing (SPEC-r8 决定记录 2026-10-19): the browser / desktop renders the platform's request body with
 * the SDK and posts it to 辰记's API, which checks it against a per-platform whitelist, adds the stored
 * credential (signing Ghost's JWT itself) and forwards it. Conversion lives only in TypeScript; the Python
 * side only authenticates and does HTTP. The desktop's local relay (`localRelayFetch`) answers the same URLs for
 * accounts held on the machine.
 *
 *   POST {apiBase}/notes/{noteId}/publish/{platform}
 *   Idempotency-Key: ${jobId}:${platform}:${accountId ?? 'default'}:${attempt}      (SPEC-r11 §3, when known)
 *   { body, previous?: { external_id, url? }, credential?: { access_token, instance? }, account_id? }
 *   (`credential`: a token the web page holds in memory for an OAuth platform; forwarded once, never stored)
 *   (`account_id`: which of the user's accounts on the platform, SPEC-r11 §5; absent = the default one)
 *   → envelope { code: 0, data: { url, external_id, state?, report?, pending? } }   (`state: 'processing'` + `pending`)
 *   → error envelope { code, message, data: { error_code, error_kind?, retry_after?, status?, replayed? } }
 *      error_code: relogin | rate_limited | bind | forbidden | not_found | invalid | too_large | pro_required |
 *                  in_progress (409, same Idempotency-Key still running) | …
 *
 * Three-stage platforms (SPEC-r11 §2, Threads / Instagram):
 *
 *   POST {…}/publish/{platform}/check     { pending, account_id?, credential? }  → { status, pending?, url?, external_id? }
 *   POST {…}/publish/{platform}/finalize  { pending, account_id?, credential? }  → same
 *                                          (Idempotency-Key: finalize:{platform}:{container id})
 *   (`credential`: as for publish — the web page's in-memory token, forwarded once)
 *
 * The link comment (SPEC-r12 §2.2, LinkedIn / Threads / Bluesky / Mastodon / Facebook):
 *
 *   POST {…}/publish/{platform}/comment   { parent: { external_id, meta? }, text, account_id?, credential? }
 *                                          (Idempotency-Key: comment:{platform}:{parent external_id})
 *   → { platform, external_id, url? }      (`url` may be empty)
 *   (`meta`: what the publish answer gave as `data.meta` — Bluesky `{ uri, cid }`, Mastodon `{ visibility }`;
 *    without it the server reads the post once itself)
 */
import {
  finalizeKeyOf,
  followUpKeyOf,
  idempotencyKeyOf,
  isErrorKind,
} from '@starnote/publish-core';

import {
  helpAction,
  helpError,
  kindError,
  networkError,
  PlatformError,
  rateLimitError,
  retryAction,
} from './errors';

import type {
  ErrorKind,
  FollowUpInput,
  FollowUpParent,
  PendingCheck,
  PostRef,
  PublishContext,
  PublishState,
  RelayRequest,
  ReportItem,
} from '@starnote/publish-core';
import type { PlatformRef } from './errors';
import type { PlatformCredential } from './oauth';

export interface RelayResult {
  url: string;
  externalId: string;
  state?: PublishState;
  /** What the server did on top of the rendering (images uploaded, tags created…). */
  report: ReportItem[];
  /** `state: 'processing'`: what `/check` and `/finalize` take next. */
  pending?: unknown;
  /** The server answered from its idempotency record (the same key was done before). */
  replayed?: boolean;
  /** SPEC-r12 §2.2 `data.meta`: what the link comment needs about the post (Bluesky `{ uri, cid }`…). */
  meta?: unknown;
}

/** What the relay helpers read from the publish context. */
export type RelayContext = Pick<PublishContext, 'fetch' | 'signal' | 'noteId' | 'apiBase'> &
  Partial<
    Pick<
      PublishContext,
      'previous' | 'account' | 'accountId' | 'idempotencyKey' | 'jobId' | 'attempt'
    >
  >;

interface Envelope {
  code: number;
  message?: string;
  data?: any;
}

/** The URL the relay posts to. */
export function relayPath(apiBase: string, noteId: string, platform: string): string {
  return `${apiBase.replace(/\/$/, '')}/notes/${encodeURIComponent(noteId)}/publish/${platform}`;
}

function accountIdOf(ctx: RelayContext): string | undefined {
  return ctx.accountId ?? ctx.account?.id;
}

/**
 * The error envelope → a `PlatformError` with its kind. The server's `error_kind` wins; without it (a proxy's
 * 502 / 504 page, a catch-all 500, no envelope at all) a **write** may still have reached the platform, so a 5xx is
 * `unknown` for a write and `retry` only for a read. 429 / `rate_limited` is `retry`; `retry_after` is passed on
 * whenever the server gave it.
 */
function envelopeError(
  p: PlatformRef,
  res: Response,
  env: Envelope | null,
  fallback: string,
  write: boolean
): PlatformError {
  const message = env?.message || `${fallback}（HTTP ${res.status}）`;
  const data = env?.data ?? {};
  const code: string =
    data.error_code ??
    (res.status === 429 ? 'rate_limited' : res.status === 409 ? 'in_progress' : '');
  const wait = Number(data.retry_after);
  const retryAfterSec = wait > 0 ? wait : undefined;
  const status = data.status ? Number(data.status) : undefined;
  const given: ErrorKind | undefined = isErrorKind(data.error_kind) ? data.error_kind : undefined;
  let kind: ErrorKind =
    given ??
    (code === 'relogin'
      ? 'disconnect'
      : code === 'rate_limited' || res.status === 429
        ? 'retry'
        : code === 'in_progress'
          ? 'unknown'
          : res.status >= 500
            ? write
              ? 'unknown'
              : 'retry'
            : 'bad_body');
  // the server already refreshed and retried once: what is left for the user is a plain retry
  if (kind === 'refresh') kind = 'retry';
  if (kind === 'retry' && (code === 'rate_limited' || res.status === 429)) {
    const e = rateLimitError(p, retryAfterSec);
    return code && code !== e.code
      ? new PlatformError(e.message, {
          platform: p.key,
          code,
          status: 429,
          ...(retryAfterSec ? { retryAfterSec } : {}),
          actions: e.actions,
          kind,
        })
      : e;
  }
  const extra = {
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterSec ? { retryAfterSec } : {}),
  };
  if (kind === 'disconnect')
    return kindError(p, kind, message, { code: code || 'relogin', ...extra });
  if (kind === 'unknown')
    return kindError(
      p,
      kind,
      code === 'in_progress'
        ? `${p.label} 的上一次发布请求还在进行中，结果未知：请稍后到平台确认`
        : !given && res.status >= 500
          ? `${p.label} 的发布请求结果未知（HTTP ${res.status}）：可能已经发出，请先到平台确认，没有再重发`
          : message,
      { code: code || (res.status >= 500 ? `http_${res.status}` : 'unknown'), ...extra }
    );
  const e = helpError(p, message, {
    code: code || (env?.code === 40101 ? 'session' : `http_${res.status}`),
    ...(status !== undefined ? { status } : {}),
    retryable: kind === 'retry',
    kind,
  });
  if (!retryAfterSec) return e;
  return new PlatformError(e.message, {
    platform: p.key,
    code: e.code,
    ...(e.status !== undefined ? { status: e.status } : {}),
    retryAfterSec,
    actions: kind === 'retry' ? [helpAction(p), retryAction(retryAfterSec)] : e.actions,
    kind,
  });
}

/** The body as an envelope; `null` when it cannot be read or parsed (cut off, HTML, empty). */
async function readEnvelope(res: Response): Promise<Envelope | null> {
  try {
    const env = (await res.json()) as Envelope;
    return env && typeof env === 'object' ? env : null;
  } catch {
    return null;
  }
}

/** A 2xx write whose answer cannot be read: it may well have gone through. */
function unreadableWrite(p: PlatformRef, res: Response): PlatformError {
  return kindError(
    p,
    'unknown',
    `${p.label} 的发布请求已被受理，但返回内容无法读取（HTTP ${res.status}）：请先到平台确认，没有再重发`,
    { code: 'bad_response', status: res.status }
  );
}

async function post(
  ctx: RelayContext,
  p: PlatformRef,
  url: string,
  payload: unknown,
  opts: { idempotencyKey?: string | undefined; write: boolean }
): Promise<Response> {
  try {
    return await ctx.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: ctx.signal,
    });
  } catch (cause) {
    if (ctx.signal.aborted) throw cause;
    const e = networkError(p, cause, { write: opts.write });
    throw new PlatformError(
      opts.write && e.errorKind === 'unknown'
        ? `连接辰记服务器中断，不确定${p.label}是否已发出：请先到平台确认，没有再重发`
        : `连不上辰记服务器：${cause instanceof Error ? cause.message : String(cause)}`,
      {
        platform: p.key,
        code: 'network',
        actions: e.actions,
        kind: e.errorKind,
      }
    );
  }
}

/**
 * Posts the rendered body to 辰记's API and maps its errors by kind (SPEC-r11 §1). A write: never retried here.
 * `opts.idempotencyKey` overrides the key derived from the context (`idempotencyKeyOf`).
 */
export async function relayPublish(
  ctx: RelayContext,
  p: PlatformRef,
  body: unknown,
  previousId?: string,
  opts: { credential?: PlatformCredential | undefined; idempotencyKey?: string } = {}
): Promise<RelayResult> {
  const prevId = ctx.previous?.externalId ?? previousId;
  const accountId = accountIdOf(ctx);
  const payload = {
    body,
    ...(opts.credential ? { credential: opts.credential } : {}),
    ...(prevId
      ? {
          previous: {
            external_id: prevId,
            ...(ctx.previous?.url ? { url: ctx.previous.url } : {}),
          },
        }
      : {}),
    ...(accountId ? { account_id: accountId } : {}),
  };
  const res = await post(ctx, p, relayPath(ctx.apiBase, ctx.noteId, p.key), payload, {
    idempotencyKey: opts.idempotencyKey ?? idempotencyKeyOf(ctx, p.key),
    write: true,
  });
  const env = await readEnvelope(res);
  if (res.ok && env && env.code === 0 && env.data && typeof env.data === 'object') {
    const d = env.data;
    return {
      url: String(d.url ?? ''),
      externalId: String(d.external_id ?? ''),
      ...(d.state ? { state: d.state as PublishState } : {}),
      report: Array.isArray(d.report) ? (d.report as ReportItem[]) : [],
      ...(d.pending !== undefined && d.pending !== null ? { pending: d.pending } : {}),
      ...(d.replayed ? { replayed: true } : {}),
      ...(d.meta !== undefined && d.meta !== null ? { meta: d.meta } : {}),
    };
  }
  // 2xx but no readable success envelope (cut body, HTML, `code` 0 without data): the post may exist
  if (res.ok && (!env || env.code === 0)) throw unreadableWrite(p, res);
  throw envelopeError(p, res, env, `${p.label} 发布失败`, true);
}

/**
 * SPEC-r12 §2.2 `POST …/publish/{platform}/comment`: the link comment under a live post. A write — never retried
 * here; the key `comment:{platform}:{post externalId}` makes 「补发」 after a failure post again (the server only
 * remembers successes and `unknown`s) and a replay of a success return the first answer.
 */
export async function relayFollowUp(
  ctx: RelayContext,
  p: PlatformRef,
  parent: FollowUpParent,
  input: FollowUpInput,
  opts: { credential?: PlatformCredential | undefined; idempotencyKey?: string } = {}
): Promise<{ externalId: string; url?: string }> {
  const accountId = accountIdOf(ctx);
  const res = await post(
    ctx,
    p,
    `${relayPath(ctx.apiBase, ctx.noteId, p.key)}/comment`,
    {
      parent: {
        external_id: parent.externalId,
        ...(parent.meta !== undefined && parent.meta !== null ? { meta: parent.meta } : {}),
      },
      text: input.text,
      ...(opts.credential ? { credential: opts.credential } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    },
    {
      write: true,
      idempotencyKey: opts.idempotencyKey ?? followUpKeyOf(p.key, parent.externalId),
    }
  );
  const env = await readEnvelope(res);
  if (res.ok && env && env.code === 0 && env.data && typeof env.data === 'object') {
    const d = env.data;
    const url = typeof d.url === 'string' && d.url ? d.url : undefined;
    return { externalId: String(d.external_id ?? ''), ...(url ? { url } : {}) };
  }
  if (res.ok && (!env || env.code === 0)) throw unreadableWrite(p, res);
  throw envelopeError(p, res, env, `${p.label} 链接评论发送失败`, true);
}

/** The container id inside a three-stage `pending` (`container_id`, `creation_id` or `id`). */
export function containerIdOf(pending: unknown): string | undefined {
  if (!pending || typeof pending !== 'object') return undefined;
  const o = pending as Record<string, unknown>;
  const v = o.container_id ?? o.creation_id ?? o.id;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

function toCheck(p: PlatformRef, d: any): PendingCheck {
  const status = d?.status;
  if (status === 'completed')
    return { status, url: String(d.url ?? ''), externalId: String(d.external_id ?? '') };
  if (status === 'pending' || status === 'ready') return { status, pending: d.pending ?? null };
  throw helpError(p, `${p.label} 状态查询返回了无法识别的结果`, {
    code: 'bad_response',
    kind: 'unknown',
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true }
    );
  });

/**
 * `POST …/publish/{platform}/check`: is the container processed yet? A read — retried up to `retries` times
 * (default 2) on `retry` failures (network, 429, 5xx).
 */
export async function relayCheck(
  ctx: RelayContext,
  p: PlatformRef,
  pending: unknown,
  opts: { retries?: number; backoffMs?: number; credential?: PlatformCredential | undefined } = {}
): Promise<PendingCheck> {
  const accountId = accountIdOf(ctx);
  const extra = {
    ...(opts.credential ? { credential: opts.credential } : {}),
    ...(accountId ? { account_id: accountId } : {}),
  };
  const retries = Math.max(0, opts.retries ?? 2);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await post(
        ctx,
        p,
        `${relayPath(ctx.apiBase, ctx.noteId, p.key)}/check`,
        { pending, ...extra },
        { write: false }
      );
      const env = await readEnvelope(res);
      if (res.ok && env && env.code === 0 && env.data) return toCheck(p, env.data);
      // a read: an unreadable answer is just asked again
      if (res.ok && (!env || env.code === 0))
        throw helpError(p, `${p.label} 状态查询返回了无法读取的内容`, {
          code: 'bad_response',
          kind: 'retry',
          retryable: true,
        });
      throw envelopeError(p, res, env, `${p.label} 状态查询失败`, false);
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      if (attempt >= retries || (e as PlatformError).errorKind !== 'retry') throw e;
      await sleep((opts.backoffMs ?? 1000) * (attempt + 1), ctx.signal);
    }
  }
}

/**
 * `POST …/publish/{platform}/finalize`: publish the processed container. A write — never retried here; the key
 * `finalize:{platform}:{containerId}` makes a replay return the first answer (SPEC-r11 §2, §3).
 */
export async function relayFinalize(
  ctx: RelayContext,
  p: PlatformRef,
  pending: unknown,
  opts: { containerId?: string; credential?: PlatformCredential | undefined } = {}
): Promise<PendingCheck> {
  const accountId = accountIdOf(ctx);
  const containerId = opts.containerId ?? containerIdOf(pending);
  const res = await post(
    ctx,
    p,
    `${relayPath(ctx.apiBase, ctx.noteId, p.key)}/finalize`,
    {
      pending,
      ...(opts.credential ? { credential: opts.credential } : {}),
      ...(accountId ? { account_id: accountId } : {}),
    },
    { write: true, idempotencyKey: containerId ? finalizeKeyOf(p.key, containerId) : undefined }
  );
  const env = await readEnvelope(res);
  if (res.ok && env && env.code === 0 && env.data) {
    try {
      return toCheck(p, env.data);
    } catch {
      throw unreadableWrite(p, res);
    }
  }
  if (res.ok && (!env || env.code === 0)) throw unreadableWrite(p, res);
  throw envelopeError(p, res, env, `${p.label} 发布失败`, true);
}

/**
 * The relay request of a scheduled task (`Adapter.renderRequest`, SPEC-r11 §4.1): the body and the earlier post
 * the same way `relayPublish` sends them.
 */
export function relayRequestOf(
  body: unknown,
  previous?: PostRef,
  previousId?: string,
  report?: ReportItem[],
  followUp?: FollowUpInput
): RelayRequest & { report?: ReportItem[] } {
  const prevId = previous?.externalId ?? previousId;
  return {
    body,
    ...(prevId
      ? { previous: { external_id: prevId, ...(previous?.url ? { url: previous.url } : {}) } }
      : {}),
    // SPEC-r12 §2.3: the runner posts the link comment once the post succeeded
    ...(followUp ? { follow_up: { kind: followUp.kind, text: followUp.text } } : {}),
    ...(report?.length ? { report } : {}),
  };
}
