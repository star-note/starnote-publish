import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { commitFiles, gitBlobSha, GitHubApiError, toBase64 } from '../src/index';
import { json, mockFetch } from './helpers';

const R = '/repos/me/me.github.io';

function gitSha(text: string | Uint8Array) {
  const bytes = typeof text === 'string' ? Buffer.from(text) : Buffer.from(text);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function repo(existing: Record<string, string> = {}, opts: { conflicts?: number } = {}) {
  let conflicts = opts.conflicts ?? 0;
  let blob = 0;
  return mockFetch({
    [`GET ${R}/git/ref/heads/main`]: () => json({ object: { sha: 'head1' } }),
    [`GET ${R}/git/commits/head1`]: () => json({ tree: { sha: 'tree1' } }),
    [`GET ${R}/git/trees/tree1`]: () =>
      json({
        tree: Object.entries(existing).map(([path, sha]) => ({ path, type: 'blob', sha })),
        truncated: false,
      }),
    [`POST ${R}/git/blobs`]: (c) => json({ sha: `blob-${++blob}-${c.body.encoding}` }, 201),
    [`POST ${R}/git/trees`]: () => json({ sha: 'tree2' }, 201),
    [`POST ${R}/git/commits`]: () => json({ sha: 'commit2' }, 201),
    [`PATCH ${R}/git/refs/heads/main`]: () =>
      conflicts-- > 0
        ? json({ message: 'Update is not a fast forward' }, 422)
        : json({ object: { sha: 'commit2' } }),
  });
}

describe('gitBlobSha / toBase64', () => {
  it('matches git and base64', async () => {
    expect(await gitBlobSha('hello\n')).toBe(gitSha('hello\n'));
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(await gitBlobSha(bytes)).toBe(gitSha(bytes));
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('commitFiles', () => {
  it('writes blobs, a tree, a commit and moves the branch, in one commit', async () => {
    const { fetch, calls } = repo();
    const result = await commitFiles({
      fetch,
      token: 'tok',
      repo: 'me/me.github.io',
      branch: 'main',
      message: 'publish: T (#id)',
      files: [
        { path: 'content/posts/id/index.zh-CN.html', content: '<p>中文</p>' },
        { path: 'content/posts/id/assets/abc.png', content: new Uint8Array([1, 2, 3]) },
      ],
    });
    expect(result).toEqual({
      commitSha: 'commit2',
      baseSha: 'head1',
      written: ['content/posts/id/index.zh-CN.html', 'content/posts/id/assets/abc.png'],
      deleted: [],
      unchanged: [],
      attempts: 1,
    });
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com', '')}`)).toEqual([
      `GET ${R}/git/ref/heads/main`,
      `GET ${R}/git/commits/head1`,
      `GET ${R}/git/trees/tree1?recursive=1`,
      `POST ${R}/git/blobs`,
      `POST ${R}/git/blobs`,
      `POST ${R}/git/trees`,
      `POST ${R}/git/commits`,
      `PATCH ${R}/git/refs/heads/main`,
    ]);
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
    expect(calls[0]!.headers.get('X-GitHub-Api-Version')).toBe('2022-11-28');
    expect(calls[3]!.body).toEqual({ content: '<p>中文</p>', encoding: 'utf-8' });
    expect(calls[4]!.body).toEqual({ content: 'AQID', encoding: 'base64' });
    expect(calls[5]!.body).toEqual({
      base_tree: 'tree1',
      tree: [
        {
          path: 'content/posts/id/index.zh-CN.html',
          mode: '100644',
          type: 'blob',
          sha: 'blob-1-utf-8',
        },
        {
          path: 'content/posts/id/assets/abc.png',
          mode: '100644',
          type: 'blob',
          sha: 'blob-2-base64',
        },
      ],
    });
    expect(calls[6]!.body).toEqual({
      message: 'publish: T (#id)',
      tree: 'tree2',
      parents: ['head1'],
    });
    expect(calls[7]!.body).toEqual({ sha: 'commit2', force: false });
  });

  it('skips files already in the repository and deletes with sha null', async () => {
    const { fetch, calls } = repo({ 'a/img.png': gitSha(new Uint8Array([9])), 'a/old.html': 'x' });
    const result = await commitFiles({
      fetch,
      token: 't',
      repo: 'me/me.github.io',
      branch: 'main',
      message: 'm',
      files: [
        { path: 'a/img.png', content: new Uint8Array([9]) },
        { path: 'a/old.html', content: null },
        { path: 'a/gone.html', content: null },
      ],
    });
    expect(result).toMatchObject({
      written: [],
      deleted: ['a/old.html'],
      unchanged: ['a/img.png', 'a/gone.html'],
    });
    expect(calls.filter((c) => c.url.endsWith('/git/blobs'))).toHaveLength(0);
    expect(calls.find((c) => c.url.endsWith('/git/trees'))!.body.tree).toEqual([
      { path: 'a/old.html', mode: '100644', type: 'blob', sha: null },
    ]);
  });

  it('makes no commit when nothing changed', async () => {
    const { fetch, calls } = repo({ 'x.html': gitSha('same') });
    const result = await commitFiles({
      fetch,
      token: 't',
      repo: 'me/me.github.io',
      branch: 'main',
      message: 'm',
      files: [{ path: 'x.html', content: 'same' }],
    });
    expect(result).toMatchObject({ commitSha: null, baseSha: 'head1', unchanged: ['x.html'] });
    expect(calls).toHaveLength(3);
  });

  it('starts over on a non-fast-forward, without uploading blobs again', async () => {
    const { fetch, calls } = repo({}, { conflicts: 1 });
    const result = await commitFiles({
      fetch,
      token: 't',
      repo: 'me/me.github.io',
      branch: 'main',
      message: 'm',
      files: [{ path: 'x.html', content: 'x' }],
    });
    expect(result.attempts).toBe(2);
    expect(calls.filter((c) => c.url.endsWith('/git/blobs'))).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  });

  it('gives up after maxAttempts and maps HTTP errors', async () => {
    const { fetch } = repo({}, { conflicts: 5 });
    const args = {
      token: 't',
      repo: 'me/me.github.io',
      branch: 'main',
      message: 'm',
      files: [{ path: 'x', content: 'x' }],
    };
    await expect(commitFiles({ ...args, fetch, maxAttempts: 2 })).rejects.toMatchObject({
      status: 422,
      code: 'conflict',
    });

    const unauthorized = mockFetch({
      [`GET ${R}/git/ref/heads/main`]: () => json({ message: 'Bad credentials' }, 401),
    });
    const err = await commitFiles({ ...args, fetch: unauthorized.fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect(err).toMatchObject({
      code: 'relogin',
      message: 'GitHub 令牌无效或已过期，请重新填写：Bad credentials',
    });
  });
});
