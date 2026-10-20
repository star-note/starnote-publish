import { zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  connect,
  detectRepo,
  ensurePages,
  GITHUB_TOKEN_CREATE_URL,
  githubPagesBinding,
  githubTokenForm,
  MANY_REPOS_WARNING,
  parseTokenExpiration,
  templateRepoUrl,
  tokenCreateUrl,
  verify,
  verifyGithubToken,
} from '../src/index';
import { json, mockFetch } from './helpers';

const TOKEN = `github_pat_${'A1b2'.repeat(10)}`;

const repoBody = (push: boolean) => ({
  full_name: 'me/me.github.io',
  default_branch: 'main',
  private: false,
  html_url: 'https://github.com/me/me.github.io',
  permissions: { admin: false, push, pull: true },
});

function withExpiry(body: unknown, expiry?: string) {
  const res = json(body);
  if (expiry) res.headers.set('github-authentication-token-expiration', expiry);
  return res;
}

describe('binding declaration', () => {
  it('asks only for a fine-grained token, kept on the server', () => {
    expect(githubPagesBinding).toMatchObject({
      kind: 'token',
      provider: 'github',
      store: 'server',
      fields: ['token'],
      createUrl: 'https://github.com/settings/personal-access-tokens/new',
      permissions: ['Contents: Read and write', 'Pages: Read and write', 'Metadata: Read-only'],
    });
    expect(GITHUB_TOKEN_CREATE_URL).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(githubPagesBinding.instructions?.join('\n')).toContain('Only select repositories');
    expect(zodFieldMeta(githubTokenForm).map((f) => [f.name, f.required])).toEqual([
      ['token', true],
      ['repo', false],
    ]);
    expect(githubTokenForm.safeParse({ token: TOKEN }).success).toBe(true);
    expect(githubTokenForm.safeParse({ token: 'ghp_classic_token_123456789012' }).success).toBe(
      false
    );
  });
});

describe('pre-filled GitHub links', () => {
  it('create-from-template page with owner, name, visibility and description', () => {
    const url = new URL(templateRepoUrl({ login: 'LuDejun' }));
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/new');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template_owner: 'star-note',
      template_name: 'starnote-blog-template',
      owner: '@me',
      name: 'ludejun.github.io',
      visibility: 'public',
      description: '我的博客 · 由辰记 StarNote 发布',
    });
    expect(templateRepoUrl({ repoName: 'blog', template: { owner: 'o', name: 't' } })).toContain(
      'template_owner=o&template_name=t&owner=%40me&name=blog&visibility=public'
    );
    expect(templateRepoUrl()).not.toContain('name=ludejun');
  });

  it('token page with name, description, expiry and permissions', () => {
    const url = tokenCreateUrl({ repo: 'me/me.github.io' });
    expect(
      url.startsWith('https://github.com/settings/personal-access-tokens/new?name=StarNote+')
    ).toBe(true);
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      name: 'StarNote 发布 me/me.github.io',
      description: '辰记 StarNote 发布到 GitHub Pages（me/me.github.io）',
      expires_in: '365',
      contents: 'write',
      pages: 'write',
    });
    expect(new URL(tokenCreateUrl({ expiresInDays: 90 })).searchParams.get('expires_in')).toBe(
      '90'
    );
  });
});

describe('detectRepo', () => {
  it('looks up <login>.github.io without a token', async () => {
    const found = mockFetch({
      'GET /repos/me/me.github.io': () =>
        json({ full_name: 'me/me.github.io', html_url: 'https://github.com/me/me.github.io' }),
    });
    expect(await detectRepo('me', { fetch: found.fetch })).toEqual({
      exists: true,
      repo: 'me/me.github.io',
      htmlUrl: 'https://github.com/me/me.github.io',
    });
    expect(found.calls[0]!.headers.has('Authorization')).toBe(false);
    const missing = mockFetch({ 'GET /repos/me/me.github.io': () => json({}, 404) });
    expect(await detectRepo('me', { fetch: missing.fetch })).toEqual({
      exists: false,
      repo: 'me/me.github.io',
    });
  });
});

describe('connect', () => {
  const happy = (repos: string[], extra: Record<string, () => Response> = {}) =>
    mockFetch({
      'GET /user': () => json({ login: 'me' }),
      'GET /user/repos': () => json(repos.map((full_name) => ({ full_name }))),
      'GET /repos/me/me.github.io': () => withExpiry(repoBody(true), '2027-10-19 00:00:00 UTC'),
      'GET /repos/me/me.github.io/pages': () => json({}, 404),
      'POST /repos/me/me.github.io/pages': () => json({ html_url: 'https://me.github.io/' }, 201),
      ...extra,
    });
  const states = (r: { steps: { id: string; state: string }[] }) =>
    r.steps.map((s) => `${s.id}:${s.state}`);

  it('one repository: user → repo → verify → pages → first publish', async () => {
    const { fetch, calls } = happy(['me/me.github.io']);
    const published: unknown[] = [];
    const r = await connect(TOKEN, {
      fetch,
      publishExisting: async (ctx) => {
        published.push(ctx);
        return { count: 3 };
      },
    });
    expect(r).toMatchObject({
      status: 'connected',
      login: 'me',
      repo: 'me/me.github.io',
      branch: 'main',
      siteUrl: 'https://me.github.io/',
      expiresAt: '2027-10-19T00:00:00.000Z',
      warnings: [],
    });
    expect(states(r)).toEqual([
      'user:done',
      'repos:done',
      'verify:done',
      'pages:done',
      'publish:done',
    ]);
    expect(r.steps.map((s) => s.detail)).toEqual([
      'me',
      'me/me.github.io',
      '令牌到期：2027-10-19',
      '已开启（GitHub Actions 构建）',
      '已发布 3 篇',
    ]);
    expect(published).toEqual([{ repo: 'me/me.github.io', branch: 'main', token: TOKEN }]);
    // the repo list from step 2 is reused by verify: /user/repos is called once
    expect(calls.filter((c) => c.url.includes('/user/repos'))).toHaveLength(1);
  });

  it('several repositories: returns the list to choose from, then connects the chosen one', async () => {
    const { fetch } = happy(['me/me.github.io', 'me/other']);
    const r = await connect(TOKEN, { fetch });
    expect(r).toMatchObject({ status: 'choose-repo', repos: ['me/me.github.io', 'me/other'] });
    expect(states(r)).toEqual([
      'user:done',
      'repos:waiting',
      'verify:waiting',
      'pages:waiting',
      'publish:waiting',
    ]);

    const again = await connect(TOKEN, { fetch, repo: 'me/me.github.io' });
    expect(again.status).toBe('connected');
    expect(again.warnings).toEqual([MANY_REPOS_WARNING]);
    expect(states(again).at(-1)).toBe('publish:skipped');
  });

  it('no repository yet: points at the pre-filled template page', async () => {
    const { fetch } = happy([]);
    const r = await connect(TOKEN, { fetch });
    expect(r.status).toBe('no-repo');
    expect(r.templateUrl).toBe(templateRepoUrl({ login: 'me' }));
  });

  it('stops at the failing step with its error', async () => {
    const bad = mockFetch({ 'GET /user': () => json({ message: 'Bad credentials' }, 401) });
    const r = await connect(TOKEN, { fetch: bad.fetch });
    expect(r.status).toBe('failed');
    expect(r.steps[0]).toMatchObject({ state: 'failed', error: { code: 'relogin' } });

    const readOnly = happy(['me/me.github.io'], {
      'GET /repos/me/me.github.io': () => json(repoBody(false)),
    });
    const r2 = await connect(TOKEN, { fetch: readOnly.fetch });
    expect(states(r2)).toEqual([
      'user:done',
      'repos:done',
      'verify:failed',
      'pages:waiting',
      'publish:waiting',
    ]);
    expect(r2.steps[2]?.error?.code).toBe('forbidden');
  });
});

describe('parseTokenExpiration', () => {
  it('reads the formats GitHub sends', () => {
    expect(parseTokenExpiration('2026-12-01 08:00:00 UTC')).toBe('2026-12-01T08:00:00.000Z');
    expect(parseTokenExpiration('2026-12-01 00:00:00 -0800')).toBe('2026-12-01T08:00:00.000Z');
    expect(parseTokenExpiration('2026-12-01 16:00:00 +08:00')).toBe('2026-12-01T08:00:00.000Z');
    expect(parseTokenExpiration(null)).toBeUndefined();
    expect(parseTokenExpiration('soon')).toBeUndefined();
  });
});

describe('verifyGithubToken', () => {
  it('accepts a token that can push to the repo, with its expiry and no warning', async () => {
    const { fetch, calls } = mockFetch({
      'GET /repos/me/me.github.io': () => withExpiry(repoBody(true), '2026-12-01 08:00:00 UTC'),
      'GET /user/repos': () => json([{ full_name: 'me/me.github.io' }]),
    });
    expect(await verify(TOKEN, 'me/me.github.io', { fetch })).toEqual({
      repo: 'me/me.github.io',
      defaultBranch: 'main',
      private: false,
      htmlUrl: 'https://github.com/me/me.github.io',
      expiresAt: '2026-12-01T08:00:00.000Z',
      warnings: [],
    });
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(calls[1]!.url).toContain('per_page=2');
  });

  it('warns when the token reaches more than one repository; no expiry header means none', async () => {
    const { fetch } = mockFetch({
      'GET /repos/me/me.github.io': () => json(repoBody(true)),
      'GET /user/repos': () => json([{}, {}]),
    });
    const r = await verifyGithubToken({ fetch, token: TOKEN, repo: 'me/me.github.io' });
    expect(r.warnings).toEqual([MANY_REPOS_WARNING]);
    expect(r).not.toHaveProperty('expiresAt');
  });

  it('rejects read-only tokens, bad tokens and repositories the token cannot see', async () => {
    const readOnly = mockFetch({ 'GET /repos/me/me.github.io': () => json(repoBody(false)) });
    await expect(verify(TOKEN, 'me/me.github.io', { fetch: readOnly.fetch })).rejects.toMatchObject(
      {
        code: 'forbidden',
        message: '这个令牌对仓库没有写权限：请把 Contents 设为 Read and write',
      }
    );
    const bad = mockFetch({
      'GET /repos/me/me.github.io': () => json({ message: 'Bad credentials' }, 401),
    });
    await expect(verify(TOKEN, 'me/me.github.io', { fetch: bad.fetch })).rejects.toMatchObject({
      code: 'relogin',
    });
    const hidden = mockFetch({
      'GET /repos/me/me.github.io': () => json({ message: 'Not Found' }, 404),
    });
    await expect(verify(TOKEN, 'me/me.github.io', { fetch: hidden.fetch })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('ensurePages', () => {
  it('creates Pages with the workflow build', async () => {
    const { fetch, calls } = mockFetch({
      'GET /repos/me/me.github.io/pages': () => json({}, 404),
      'POST /repos/me/me.github.io/pages': () =>
        json({ html_url: 'https://me.github.io/', build_type: 'workflow' }, 201),
    });
    expect(await ensurePages({ fetch, token: 't', repo: 'me/me.github.io' })).toEqual({
      url: 'https://me.github.io/',
      changed: true,
    });
    expect(calls[1]!.body).toEqual({ build_type: 'workflow' });
  });

  it('switches a legacy site to the workflow build and leaves a workflow site alone', async () => {
    const legacy = mockFetch({
      'GET /repos/me/b/pages': () =>
        json({ html_url: 'https://me.github.io/b/', build_type: 'legacy' }),
      'PUT /repos/me/b/pages': () => new Response(null, { status: 204 }),
    });
    expect(await ensurePages({ fetch: legacy.fetch, token: 't', repo: 'me/b' })).toEqual({
      url: 'https://me.github.io/b/',
      changed: true,
    });
    expect(legacy.calls[1]).toMatchObject({ method: 'PUT', body: { build_type: 'workflow' } });

    const ready = mockFetch({
      'GET /repos/me/b/pages': () => json({ html_url: 'u', build_type: 'workflow' }),
    });
    expect(await ensurePages({ fetch: ready.fetch, token: 't', repo: 'me/b' })).toEqual({
      url: 'u',
      changed: false,
    });
  });

  it('falls back to PUT when POST says it already exists', async () => {
    const { fetch, calls } = mockFetch({
      'GET /repos/me/b/pages': () => json({}, 404),
      'POST /repos/me/b/pages': () => json({ message: 'exists' }, 409),
      'PUT /repos/me/b/pages': () => new Response(null, { status: 204 }),
    });
    expect(await ensurePages({ fetch, token: 't', repo: 'me/b' })).toEqual({
      url: null,
      changed: true,
    });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PUT']);
  });
});
