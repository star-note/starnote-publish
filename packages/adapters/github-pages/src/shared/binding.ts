/**
 * Binding (SPEC-r8 §4.3): the user pastes one fine-grained personal access token; everything else is
 * guided or automatic. Pre-filled links cut the GitHub side to one click each (`templateRepoUrl`,
 * `tokenCreateUrl`), `detectRepo` skips the "create repository" step when it already exists, and
 * `connect` runs user → repos → verify → Pages → optional first publish, reporting each step. The token
 * is stored encrypted on the server; publishing runs there by default.
 *
 * The API runs the same steps in Python (`starnote-api/app/services/github_publish.py`: `connect`,
 * `verify_token`, `ensure_pages`) for `POST /me/platform-accounts/github-pages/connect`, because the token
 * must never reach the browser; keep the two in step (step ids, titles, order, error codes).
 */
import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { github, repoPath } from './github';
import { msg } from './i18n';
import { GITHUB_PAGES_LAYOUT } from './layout';

import type { BindingSpec, SdkLang } from '@starnote/publish-core';
import type { GitHubClientOptions } from './github';

/** The template repository blogs are generated from (configurable; the template is not final yet). */
export const GITHUB_TEMPLATE = {
  owner: GITHUB_PAGES_LAYOUT.templateRepo.split('/')[0]!,
  name: GITHUB_PAGES_LAYOUT.templateRepo.split('/')[1]!,
};

export const GITHUB_TOKEN_CREATE_URL = 'https://github.com/settings/personal-access-tokens/new';

/** Repository permissions the token needs (and nothing else). */
export const GITHUB_TOKEN_PERMISSIONS = [
  'Contents: Read and write',
  'Pages: Read and write',
  'Metadata: Read-only',
] as const;

const DESCRIPTION = '我的博客 · 由辰记 StarNote 发布';

/**
 * Pre-filled "create repository from template" page: the user only clicks「Create repository」.
 * `/new` takes template_owner, template_name, owner, name, description and visibility (GitHub docs).
 */
export function templateRepoUrl(
  opts: { login?: string; repoName?: string; template?: { owner: string; name: string } } = {}
): string {
  const template = opts.template ?? GITHUB_TEMPLATE;
  const name = opts.repoName ?? (opts.login ? `${opts.login.toLowerCase()}.github.io` : undefined);
  const q = new URLSearchParams({
    template_owner: template.owner,
    template_name: template.name,
    owner: '@me',
    ...(name ? { name } : {}),
    visibility: 'public',
    description: DESCRIPTION,
  });
  return `https://github.com/new?${q.toString()}`;
}

/**
 * Pre-filled fine-grained token page: the user only picks the repository (cannot be pre-filled) and
 * clicks「Generate token」.
 *
 * ⚠️ 待在真实页面核实: the `name` / `description` / `expires_in` / permission parameters (`contents`,
 * `pages`) come from third-party write-ups, not GitHub's docs; unknown parameters are simply ignored.
 */
export function tokenCreateUrl(opts: { repo?: string; expiresInDays?: number } = {}): string {
  const q = new URLSearchParams({
    name: `StarNote 发布 ${opts.repo ?? 'GitHub Pages'}`.slice(0, 40),
    description: `辰记 StarNote 发布到 GitHub Pages${opts.repo ? `（${opts.repo}）` : ''}`,
    expires_in: String(opts.expiresInDays ?? 365),
    contents: 'write',
    pages: 'write',
  });
  return `${GITHUB_TOKEN_CREATE_URL}?${q.toString()}`;
}

/** What the user pastes when binding: the token; the repository is detected (or picked) afterwards. */
export const githubTokenFormFor = byLang((lang) => {
  const t = msg(lang).key;
  return z.object({
    token: z
      .string()
      .trim()
      .regex(/^github_pat_[A-Za-z0-9_]{20,}$/, t.tokenFormat)
      .describe(t.token),
    repo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, t.repoFormat)
      .optional()
      .describe(t.repo),
  });
});

export const githubTokenForm = githubTokenFormFor('zh-CN');

export type GithubTokenForm = z.infer<typeof githubTokenForm>;

export const githubPagesBinding: BindingSpec & { kind: 'token'; provider: 'github' } = {
  kind: 'token',
  provider: 'github',
  store: 'server',
  fields: ['token'],
  form: githubTokenForm,
  formFor: githubTokenFormFor,
  permissions: [...GITHUB_TOKEN_PERMISSIONS],
  createUrl: GITHUB_TOKEN_CREATE_URL,
  instructions: bindingSteps('zh-CN'),
  instructionsFor: bindingSteps,
  helpUrl:
    'https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
  checkEvery: 24 * 3600,
};

function bindingSteps(lang: SdkLang): string[] {
  const b = msg(lang).binding;
  return b.steps(GITHUB_TOKEN_PERMISSIONS.join(b.listSeparator));
}

export interface DetectRepoResult {
  exists: boolean;
  repo: string;
  htmlUrl?: string;
}

/**
 * Without a token: does `<login>/<login>.github.io` exist (public)? Lets the UI tick off「创建博客仓库」.
 * A private repository looks missing here.
 */
export async function detectRepo(
  login: string,
  opts: Omit<GitHubClientOptions, 'token'> & { repoName?: string }
): Promise<DetectRepoResult> {
  const repo = `${login}/${opts.repoName ?? `${login.toLowerCase()}.github.io`}`;
  const res = await github<{ html_url?: string; full_name?: string }>(
    { ...opts, token: undefined },
    'GET',
    repoPath(repo),
    undefined,
    [404]
  );
  if (res.status === 404) return { exists: false, repo };
  return {
    exists: true,
    repo: res.data.full_name ?? repo,
    ...(res.data.html_url ? { htmlUrl: res.data.html_url } : {}),
  };
}

export interface VerifyTokenResult {
  repo: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
  /** ISO time the token expires (`github-authentication-token-expiration`); absent = no expiry. */
  expiresAt?: string;
  /** Not fatal, shown to the user (e.g. the token reaches more than the blog repository). */
  warnings: string[];
}

/** Repositories the token can reach (a fine-grained token lists only its selected ones ⚠️ 待实测). */
const USER_REPOS = '/user/repos?affiliation=owner,collaborator,organization_member';

/** The `zh-CN` text; `msg(lang).binding.manyRepos` in other languages. */
export const MANY_REPOS_WARNING = msg('zh-CN').binding.manyRepos;

/**
 * `2026-12-01 08:00:00 UTC` / `2026-12-01 08:00:00 -0800` → ISO 8601; `undefined` when absent or
 * unparsable.
 */
export function parseTokenExpiration(value: string | null): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(
    value.trim()
  );
  if (!m) return undefined;
  const zone =
    !m[3] || m[3] === 'UTC' || m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2');
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/**
 * Checks a pasted token against the repository: it can be read and pushed to, how many repositories
 * it reaches (more than one → warning) and when it expires. Throws `GitHubApiError` (401 bad token,
 * 404 repo not visible to the token) or an `Error` when push is not allowed.
 */
export async function verifyGithubToken(
  opts: Omit<GitHubClientOptions, 'token'> & {
    token: string;
    repo: string;
    /** Repositories the token reaches, when already listed (skips the extra call). */
    repoCount?: number;
  }
): Promise<VerifyTokenResult> {
  const repo = await github<{
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
    permissions?: { push?: boolean; admin?: boolean };
  }>(opts, 'GET', repoPath(opts.repo));
  if (!repo.data.permissions?.push) {
    throw Object.assign(new Error(msg(opts.lang).binding.noPush), {
      code: 'forbidden',
    });
  }
  const warnings: string[] = [];
  let count = opts.repoCount;
  let expiry = repo.headers.get('github-authentication-token-expiration');
  if (count === undefined) {
    const repos = await github<unknown[]>(opts, 'GET', `${USER_REPOS}&per_page=2`);
    count = Array.isArray(repos.data) ? repos.data.length : 0;
    expiry ??= repos.headers.get('github-authentication-token-expiration');
  }
  if (count > 1) warnings.push(msg(opts.lang).binding.manyRepos);
  const expiresAt = parseTokenExpiration(expiry);
  return {
    repo: repo.data.full_name,
    defaultBranch: repo.data.default_branch,
    private: repo.data.private,
    htmlUrl: repo.data.html_url,
    ...(expiresAt ? { expiresAt } : {}),
    warnings,
  };
}

/** `verifyGithubToken` named after the binding step. */
export const verify = (
  token: string,
  repo: string,
  opts: Omit<GitHubClientOptions, 'token'> & { repoCount?: number }
) => verifyGithubToken({ ...opts, token, repo });

export interface EnsurePagesOptions extends GitHubClientOptions {
  repo: string;
}

export interface EnsurePagesResult {
  /** Site URL GitHub reports, with a trailing slash. */
  url: string | null;
  /** True when Pages was switched on (or over to the workflow build) by this call. */
  changed: boolean;
}

interface PagesInfo {
  html_url?: string;
  build_type?: 'legacy' | 'workflow';
}

/** Turns Pages on with `build_type: 'workflow'` (Actions), or switches a legacy site over (Pages: write). */
export async function ensurePages(opts: EnsurePagesOptions): Promise<EnsurePagesResult> {
  const path = `${repoPath(opts.repo)}/pages`;
  const current = await github<PagesInfo>(opts, 'GET', path, undefined, [404]);
  if (current.status !== 404) {
    if (current.data.build_type === 'workflow') {
      return { url: current.data.html_url ?? null, changed: false };
    }
    await github(opts, 'PUT', path, { build_type: 'workflow' });
    return { url: current.data.html_url ?? null, changed: true };
  }
  const created = await github<PagesInfo>(opts, 'POST', path, { build_type: 'workflow' }, [409]);
  if (created.status === 409) {
    // Enabled in the meantime.
    await github(opts, 'PUT', path, { build_type: 'workflow' });
    return { url: null, changed: true };
  }
  return { url: created.data.html_url ?? null, changed: true };
}

export type ConnectStepId = 'user' | 'repos' | 'verify' | 'pages' | 'publish';

export interface ConnectStep {
  id: ConnectStepId;
  /** One-line label for the checklist. */
  title: string;
  state: 'done' | 'failed' | 'skipped' | 'waiting';
  detail?: string;
  error?: { message: string; code?: string };
}

export interface ConnectOptions extends Omit<GitHubClientOptions, 'token'> {
  /** The repository to use; otherwise the only one the token reaches, or the user picks. */
  repo?: string;
  /** First publish of the blog's existing posts, run by the host after Pages is on. */
  publishExisting?(ctx: {
    repo: string;
    branch: string;
    token: string;
  }): Promise<{ count: number }>;
}

export interface ConnectResult {
  /** `choose-repo`: call again with `repo`; `no-repo`: create it first (`templateUrl`). */
  status: 'connected' | 'choose-repo' | 'no-repo' | 'failed';
  steps: ConnectStep[];
  login?: string;
  /** Repositories the token reaches (`choose-repo`). */
  repos?: string[];
  repo?: string;
  branch?: string;
  siteUrl?: string | null;
  expiresAt?: string;
  warnings: string[];
  /** Pre-filled create-repository link (`no-repo`). */
  templateUrl?: string;
}

const stepTitles = (lang?: SdkLang): Record<ConnectStepId, string> => {
  const b = msg(lang).binding;
  return {
    user: b.stepUser,
    repos: b.stepRepos,
    verify: b.stepVerify,
    pages: b.stepPages,
    publish: b.stepPublish,
  };
};

/**
 * The whole binding after the user pasted a token: `GET /user` → list the repositories it reaches (one →
 * selected, several → the user picks, none → create from template) → verify → ensurePages → optional
 * first publish. Never throws; every step reports its state for the UI checklist.
 */
export async function connect(token: string, opts: ConnectOptions): Promise<ConnectResult> {
  const titles = stepTitles(opts.lang);
  const b = msg(opts.lang).binding;
  const steps: ConnectStep[] = (Object.keys(titles) as ConnectStepId[]).map((id) => ({
    id,
    title: titles[id],
    state: 'waiting',
  }));
  const step = (id: ConnectStepId) => steps.find((s) => s.id === id)!;
  const client = { ...opts, token };
  const result: ConnectResult = { status: 'failed', steps, warnings: [] };

  const run = async <T>(id: ConnectStepId, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const value = await fn();
      if (step(id).state === 'waiting') step(id).state = 'done';
      return value;
    } catch (e) {
      const err = e as { message?: string; code?: string };
      step(id).state = 'failed';
      step(id).error = {
        message: err.message ?? String(e),
        ...(err.code ? { code: err.code } : {}),
      };
      return undefined;
    }
  };

  const user = await run('user', async () => {
    const me = await github<{ login: string }>(client, 'GET', '/user');
    step('user').detail = me.data.login;
    return me.data;
  });
  if (!user) return result;
  result.login = user.login;

  const repos = await run('repos', async () => {
    const list = await github<Array<{ full_name: string }>>(
      client,
      'GET',
      `${USER_REPOS}&per_page=100`
    );
    return (Array.isArray(list.data) ? list.data : []).map((r) => r.full_name);
  });
  if (!repos) return result;
  result.repos = repos;
  const chosen = opts.repo ?? (repos.length === 1 ? repos[0] : undefined);
  if (!chosen) {
    step('repos').state = 'waiting';
    if (!repos.length) {
      step('repos').detail = b.noRepo;
      result.status = 'no-repo';
      result.templateUrl = templateRepoUrl({ login: user.login });
    } else {
      step('repos').detail = b.chooseRepo(repos.length);
      result.status = 'choose-repo';
    }
    return result;
  }
  step('repos').detail = chosen;
  result.repo = chosen;

  const verified = await run('verify', async () => {
    const v = await verifyGithubToken({ ...client, repo: chosen, repoCount: repos.length });
    step('verify').detail = v.expiresAt ? b.expiresAt(v.expiresAt.slice(0, 10)) : b.noExpiry;
    return v;
  });
  if (!verified) return result;
  result.repo = verified.repo;
  result.branch = verified.defaultBranch;
  result.warnings = verified.warnings;
  if (verified.expiresAt) result.expiresAt = verified.expiresAt;

  const pages = await run('pages', async () => {
    const p = await ensurePages({ ...client, repo: verified.repo });
    step('pages').detail = p.changed ? b.pagesOn : b.pagesAlreadyOn;
    return p;
  });
  if (!pages) return result;
  result.siteUrl = pages.url;

  if (opts.publishExisting) {
    const published = await run('publish', () =>
      opts.publishExisting!({ repo: verified.repo, branch: verified.defaultBranch, token })
    );
    if (!published) return result;
    step('publish').detail = b.published(published.count);
  } else {
    step('publish').state = 'skipped';
  }
  result.status = 'connected';
  return result;
}
