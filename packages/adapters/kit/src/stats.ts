/**
 * Reads for `fetchStats` (SPEC-r11 §7): GET JSON with the standard error mapping, retried on `retry` failures
 * (reads may be retried; writes never are). A 404 / 410 means the post is gone: `data: null`.
 */
import { errorFromStatus, networkError } from './errors';

import type { PlatformStats, StatsContext } from '@starnote/publish-core';
import type { PlatformError, PlatformRef } from './errors';

export interface ReadOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** JSON body (GraphQL reads). */
  body?: unknown;
  /** Extra tries on `retry` failures. Default 2. */
  retries?: number;
  backoffMs?: number;
}

const wait = (ms: number, signal: AbortSignal) =>
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

/** A read with retries. `null` when the resource is gone (404 / 410). */
export async function readJson<T = any>(
  ctx: Pick<StatsContext, 'fetch' | 'signal'>,
  p: PlatformRef,
  url: string,
  opts: ReadOptions = {}
): Promise<T | null> {
  const retries = Math.max(0, opts.retries ?? 2);
  for (let attempt = 0; ; attempt++) {
    try {
      let res: Response;
      try {
        res = await ctx.fetch(url, {
          method: opts.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...opts.headers,
          },
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          signal: ctx.signal,
        });
      } catch (cause) {
        if (ctx.signal.aborted) throw cause;
        throw networkError(p, cause);
      }
      if (res.status === 404 || res.status === 410) return null;
      if (!res.ok) {
        let message: string | undefined;
        try {
          const body = (await res.json()) as { message?: string; error?: { message?: string } };
          message = body?.error?.message ?? body?.message;
        } catch {
          /* no JSON body */
        }
        throw errorFromStatus(p, res.status, res.headers, message);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      if (attempt >= retries || (e as PlatformError).errorKind !== 'retry') throw e;
      await wait((opts.backoffMs ?? 500) * (attempt + 1), ctx.signal);
    }
  }
}

/** A finite number, else `undefined`. */
export function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** `PlatformStats` without the undefined fields. */
export function stats(
  source: PlatformStats['source'],
  fields: Omit<PlatformStats, 'fetchedAt' | 'source'>
): PlatformStats {
  const out: PlatformStats = { fetchedAt: new Date().toISOString(), source };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) (out as any)[k] = v;
  return out;
}
