import type { PublishContext } from '@starnote/publish-core';

/** What a token source needs: a `PublishContext` (with `apiBase`) fits. */
export type TokenContext = Pick<PublishContext, 'fetch' | 'account'> & {
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
  if (!ctx.account) {
    throw new GithubPagesError('请先在「设置 → 平台账号」绑定 GitHub 令牌', 'bind');
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
    throw new GithubPagesError(`获取 GitHub 授权失败（HTTP ${res.status}）`, `http_${res.status}`);
  }
  const token = env.data ? pick(env.data) : undefined;
  if (env.code !== 0 || typeof token !== 'string' || !token) {
    throw new GithubPagesError(env.message || 'GitHub 令牌无效或已过期，请重新填写', 'relogin');
  }
  return token;
}
