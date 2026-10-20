/**
 * Browser impl — a TEMPORARY direct path. The default is the server (辰记's Python API, 服务器代发): the fine-grained token is
 * stored encrypted there and never reaches the browser. This impl needs the server to hand the token out
 * (`POST /platform-accounts/{id}/github-token`, kept in memory for one publish) so the browser can call
 * api.github.com directly (CORS `*`, SPEC-r8 §4.6); only register it where that trade-off is accepted.
 */
import { createGithubPagesAdapter } from './shared/adapter';
import { tokenFromApi } from './shared/token';
import type { TokenContext } from './shared/token';

import type { Adapter, Runtime } from '@starnote/publish-core';
import type { GithubPagesAdapterOptions } from './shared/adapter';
import type { githubPagesSchema } from './shared/schema';

/**
 * GitHub answers CORS with `Access-Control-Allow-Origin: *`, which browsers refuse for credentialed
 * requests — and the host's authed fetch sends cookies. Third-party calls therefore use a plain fetch.
 */
export const plainFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: 'omit' });

export function githubTokenFromServer(ctx: TokenContext): Promise<string> {
  return tokenFromApi(
    ctx,
    (id) => `/platform-accounts/${id}/github-token`,
    (d) => d.token
  );
}

export function createGithubPagesClientAdapter(
  runtime: Extract<Runtime, 'web' | 'electron'>,
  overrides: Partial<GithubPagesAdapterOptions> = {}
): Adapter<typeof githubPagesSchema> {
  return createGithubPagesAdapter({
    runtimes: [{ runtime, mode: 'api', needs: ['token'] }],
    token: githubTokenFromServer,
    githubFetch: plainFetch,
    assetFetch: plainFetch,
    ...overrides,
  });
}

export function createGithubPagesWebAdapter(
  overrides: Partial<GithubPagesAdapterOptions> = {}
): Adapter<typeof githubPagesSchema> {
  return createGithubPagesClientAdapter('web', overrides);
}

export const githubPagesWebAdapter = createGithubPagesWebAdapter();
