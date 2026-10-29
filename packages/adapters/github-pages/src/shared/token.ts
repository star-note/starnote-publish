import { msg } from './i18n';

import type { PublishContext } from '@starnote/publish-core';

/** What a token source needs: a `PublishContext` (with `apiBase`) fits. `lang`: of the error messages. */
export type TokenContext = Pick<PublishContext, 'fetch' | 'account'> &
  Partial<Pick<PublishContext, 'lang'>> & {
    apiBase?: string;
    signal?: AbortSignal;
  };

/** An error the publisher maps to a `failed` event with this `code`. */
export class GithubPagesError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'GithubPagesError';
    this.code = code;
  }
}

interface Envelope<T> {
  code: number;
  data: T | null;
  message: string;
}

/**
 * Reads a token from a 辰记 API endpoint (`{ code, data, message }` envelope) for the bound account
 * (`ctx.account`); `pick` chooses the field.
 */
export async function tokenFromApi(
  ctx: TokenContext,
  path: (accountId: string) => string,
  pick: (data: Record<string, unknown>) => unknown
): Promise<string> {
  const m = msg(ctx.lang).token;
  if (!ctx.account) {
    throw new GithubPagesError(m.bindFirst, 'bind');
  }
  const res = await ctx.fetch(
    `${ctx.apiBase ?? '/api/v1'}${path(encodeURIComponent(ctx.account.id))}`,
    {
      method: 'POST',
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    }
  );
  let env: Envelope<Record<string, unknown>>;
  try {
    env = (await res.json()) as Envelope<Record<string, unknown>>;
  } catch {
    throw new GithubPagesError(m.fetchFailed(res.status), `http_${res.status}`);
  }
  const token = env.data ? pick(env.data) : undefined;
  if (env.code !== 0 || typeof token !== 'string' || !token) {
    throw new GithubPagesError(env.message || m.invalid, 'relogin');
  }
  return token;
}
