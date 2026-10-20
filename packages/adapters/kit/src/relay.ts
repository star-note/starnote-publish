/**
 * Relay publishing (SPEC-r8 决定记录 2026-10-19): the browser / desktop renders the platform's request body with
 * the SDK and posts it to 辰记's API, which checks it against a per-platform whitelist, adds the stored
 * credential (signing Ghost's JWT itself) and forwards it. Conversion lives only in TypeScript; the Python
 * side only authenticates and does HTTP.
 *
 *   POST {apiBase}/notes/{noteId}/publish/{platform}
 *   { body, previous?: { external_id, url? }, credential?: { access_token, instance? } }
 *   (`credential`: a token the web page holds in memory for an OAuth platform; forwarded once, never stored)
 *   → envelope { code: 0, data: { url, external_id, state?, report? } }
 *   → error envelope { code, message, data: { error_code, retry_after?, status? } }
 *      error_code: relogin | rate_limited | bind | forbidden | not_found | invalid | too_large | pro_required | …
 */
import { helpError, rateLimitError, reloginError } from './errors';

import type { PublishContext, PublishState, ReportItem } from '@starnote/publish-core';
import type { PlatformRef } from './errors';
import type { PlatformCredential } from './oauth';

export interface RelayResult {
  url: string;
  externalId: string;
  state?: PublishState;
  /** What the server did on top of the rendering (images uploaded, tags created…). */
  report: ReportItem[];
}

interface Envelope {
  code: number;
  message?: string;
  data?: any;
}

/** The URL the relay posts to. */
export function relayPath(apiBase: string, noteId: string, platform: string): string {
  return `${apiBase.replace(/\/$/, '')}/notes/${encodeURIComponent(noteId)}/publish/${platform}`;
}

/** Posts the rendered body to 辰记's API and maps its errors to relogin / retry / help. */
export async function relayPublish(
  ctx: Pick<PublishContext, 'fetch' | 'signal' | 'noteId' | 'apiBase' | 'previous'>,
  p: PlatformRef,
  body: unknown,
  previousId?: string,
  opts: { credential?: PlatformCredential | undefined } = {}
): Promise<RelayResult> {
  const prevId = ctx.previous?.externalId ?? previousId;
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
  };
  let res: Response;
  try {
    res = await ctx.fetch(relayPath(ctx.apiBase, ctx.noteId, p.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: ctx.signal,
    });
  } catch (cause) {
    if (ctx.signal.aborted) throw cause;
    throw helpError(
      p,
      `连不上辰记服务器：${cause instanceof Error ? cause.message : String(cause)}`,
      {
        code: 'network',
        retryable: true,
      }
    );
  }
  let env: Envelope | null = null;
  try {
    env = (await res.json()) as Envelope;
  } catch {
    env = null;
  }
  if (res.ok && env && env.code === 0 && env.data) {
    const d = env.data;
    return {
      url: String(d.url ?? ''),
      externalId: String(d.external_id ?? ''),
      ...(d.state ? { state: d.state as PublishState } : {}),
      report: Array.isArray(d.report) ? (d.report as ReportItem[]) : [],
    };
  }
  const message = env?.message || `${p.label} 发布失败（HTTP ${res.status}）`;
  const data = env?.data ?? {};
  const code: string = data.error_code ?? (res.status === 429 ? 'rate_limited' : '');
  if (code === 'relogin') throw reloginError(p, message, data.status);
  if (code === 'rate_limited') {
    const wait = Number(data.retry_after);
    throw rateLimitError(p, wait > 0 ? wait : undefined);
  }
  throw helpError(p, message, {
    code: code || (env?.code === 40101 ? 'session' : `http_${res.status}`),
    ...(data.status ? { status: data.status } : {}),
    retryable: res.status >= 500,
  });
}
