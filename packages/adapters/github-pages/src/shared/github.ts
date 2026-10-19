/** Minimal GitHub REST client over an injected `fetch` (browser, desktop and server alike). */

export const GITHUB_API = 'https://api.github.com';

export class GitHubApiError extends Error {
  status: number;
  /** `relogin` (401), `forbidden` (403), `not_found` (404), `conflict` (409 / 422), `http_<status>` otherwise. */
  code: string;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.code =
      status === 401
        ? 'relogin'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'not_found'
            : status === 409 || status === 422
              ? 'conflict'
              : `http_${status}`;
  }
}

export interface GitHubClientOptions {
  fetch: typeof fetch;
  /** Omit for anonymous calls (public data, 60 requests / hour / IP). */
  token?: string | undefined;
  apiUrl?: string;
  signal?: AbortSignal;
}

export interface GitHubResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

/** One call; non-2xx throws `GitHubApiError` unless the status is listed in `allow`. */
export async function github<T>(
  opts: GitHubClientOptions,
  method: string,
  path: string,
  body?: unknown,
  allow: number[] = []
): Promise<GitHubResponse<T>> {
  const res = await opts.fetch(`${(opts.apiUrl ?? GITHUB_API).replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok && !allow.includes(res.status)) {
    const detail = typeof data?.message === 'string' ? data.message : `HTTP ${res.status}`;
    const hint =
      res.status === 401
        ? 'GitHub 令牌无效或已过期，请重新填写'
        : res.status === 403
          ? 'GitHub 拒绝了请求（权限不足或触发限流）'
          : res.status === 404
            ? '找不到仓库、分支或没有访问权限'
            : 'GitHub 请求失败';
    throw new GitHubApiError(`${hint}：${detail}`, res.status);
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

/** `owner/name` → `/repos/owner/name`. */
export function repoPath(repo: string): string {
  const [owner = '', name = ''] = repo.split('/');
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** Branch names may contain `/`; keep them, encode the rest. */
export function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}
