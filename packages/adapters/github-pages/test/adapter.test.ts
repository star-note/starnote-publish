import { createHash } from 'node:crypto';

import { convert, createPublisher } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { githubPagesElectronAdapter } from '../src/electron';
import { createGithubPagesAdapter, githubPagesMeta } from '../src/index';
import { createGithubPagesWebAdapter, githubPagesWebAdapter, plainFetch } from '../src/web';
import { json, mockFetch } from './helpers';

import type { AccountRef, PublishEvent, PublishJob } from '@starnote/publish-core';

const R = '/repos/me/me.github.io';
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const pngHash = createHash('sha256').update(PNG).digest('hex').slice(0, 12);

const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/a.png' } },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/missing.jpg' } },
  ],
});
const en = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/a.png' } },
  ],
});

const account: AccountRef = {
  id: 'acc 1',
  platform: 'github-pages',
  externalUid: '42',
  displayName: 'me',
  store: 'server',
  meta: { repo: 'me/me.github.io' },
};

function githubRepo(existing: Record<string, string> = {}) {
  let n = 0;
  return mockFetch({
    [`GET ${R}/git/ref/heads/main`]: () => json({ object: { sha: 'head1' } }),
    [`GET ${R}/git/commits/head1`]: () => json({ tree: { sha: 'tree1' } }),
    [`GET ${R}/git/trees/tree1`]: () =>
      json({ tree: Object.entries(existing).map(([path, sha]) => ({ path, type: 'blob', sha })) }),
    [`POST ${R}/git/blobs`]: () => json({ sha: `b${++n}` }, 201),
    [`POST ${R}/git/trees`]: () => json({ sha: 'tree2' }, 201),
    [`POST ${R}/git/commits`]: () => json({ sha: 'commit2' }, 201),
    [`PATCH ${R}/git/refs/heads/main`]: () => json({}),
  });
}

const assets = () =>
  mockFetch({
    'GET /a.png': () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }),
    'GET /missing.jpg': () => new Response('nope', { status: 404 }),
  });

function job(extra: Partial<PublishJob> = {}): PublishJob {
  return {
    noteId: 'note-1',
    doc,
    platforms: ['github-pages'],
    common: { title: '发布标题' },
    perPlatform: { 'github-pages': { repo: 'me/me.github.io', post_id: '8kq2xa' } },
    accounts: { 'github-pages': account },
    content: { kind: 'article', doc, translations: { en } },
    ...extra,
  };
}

describe('github-pages adapters', () => {
  it('declare the same key, schema and binding on every runtime', () => {
    expect(githubPagesWebAdapter.runtime).toEqual(['web']);
    expect(githubPagesElectronAdapter.runtime).toEqual(['electron']);
    for (const a of [githubPagesWebAdapter, githubPagesElectronAdapter]) {
      expect(a.key).toBe(githubPagesMeta.key);
      expect(a.contentTypes).toEqual(['article']);
      expect(a.binding).toMatchObject({ kind: 'token', provider: 'github' });
    }
  });

  it('web: gets the token from the server, rehosts images and commits every language at once', async () => {
    const api = mockFetch({
      'POST /api/v1/platform-accounts/acc%201/github-token': () =>
        json({ code: 0, data: { token: 'gho_x' }, message: 'ok' }),
    });
    const gh = githubRepo();
    const img = assets();
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [
        createGithubPagesWebAdapter({
          githubFetch: gh.fetch,
          assetFetch: img.fetch,
          now: () => new Date('2026-10-19T00:00:00Z'),
        }),
      ],
      runtime: 'web',
      fetch: api.fetch,
      onEvent: (_p, e) => events.push(e),
    });
    const { results } = await publisher.publish(job());

    const r = results['github-pages']!;
    expect(r).toMatchObject({
      ok: true,
      url: 'https://me.github.io/8kq2xa/',
      externalId: 'me/me.github.io#8kq2xa',
      state: 'published',
    });
    expect(r.report?.map((i) => i.kind)).toEqual([
      'image.rehosted',
      'image.failed',
      'translated',
      'build.pending',
    ]);
    expect(r.report?.[0]).toMatchObject({ count: 1, text: '1 张图片已转存到仓库' });
    expect(r.report?.[1]).toMatchObject({
      level: 'warn',
      samples: ['https://cdn.starnote.app/missing.jpg'],
    });

    // the token came from our API with the authed fetch; GitHub got it as a bearer token
    expect(api.calls).toHaveLength(1);
    expect(gh.calls[0]!.headers.get('Authorization')).toBe('Bearer gho_x');

    const tree = gh.calls
      .find((c) => c.url.endsWith('/git/trees'))!
      .body.tree.map((e: any) => e.path);
    expect(tree).toEqual([
      'content/posts/8kq2xa/index.zh-CN.html',
      'content/posts/8kq2xa/index.en.html',
      `content/posts/8kq2xa/assets/${pngHash}.png`,
    ]);
    const blobs = gh.calls.filter((c) => c.url.endsWith('/git/blobs')).map((c) => c.body);
    expect(blobs[0].content).toContain(`<img src="assets/${pngHash}.png"`);
    expect(blobs[0].content).toContain('src="https://cdn.starnote.app/missing.jpg"');
    expect(blobs[0].content).toContain('title: "发布标题"');
    expect(blobs[1].content).toContain('title: "Title"');
    expect(blobs[2]).toEqual({ content: Buffer.from(PNG).toString('base64'), encoding: 'base64' });
    const commit = gh.calls.find((c) => c.url.endsWith('/git/commits'))!.body;
    expect(commit.message).toBe('publish: 发布标题 (#8kq2xa)\n\nStarNote-Note: note-1');

    expect(events.filter((e) => e.type === 'report')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', url: 'https://me.github.io/8kq2xa/' });
  });

  it('reports reused images and unchanged posts without committing', async () => {
    const gh = githubRepo();
    const img = assets();
    const adapter = createGithubPagesAdapter({
      runtimes: [{ runtime: 'web', mode: 'api' }],
      token: async () => 't',
      githubFetch: gh.fetch,
      assetFetch: img.fetch,
      now: () => new Date('2026-10-19T00:00:00Z'),
    });
    // First run to learn the exact files, then a repository that already has them.
    const first = await createPublisher({ adapters: [adapter], runtime: 'web' }).publish(
      job({ content: undefined })
    );
    expect(first.results['github-pages']?.ok).toBe(true);
    const blobs = gh.calls.filter((c) => c.url.endsWith('/git/blobs')).map((c) => c.body);
    const { gitBlobSha } = await import('../src/index');
    const existing = {
      'content/posts/8kq2xa/index.zh-CN.html': await gitBlobSha(blobs[0].content),
      [`content/posts/8kq2xa/assets/${pngHash}.png`]: await gitBlobSha(PNG),
    };
    const again = githubRepo(existing);
    const adapter2 = createGithubPagesAdapter({
      runtimes: [{ runtime: 'web', mode: 'api' }],
      token: async () => 't',
      githubFetch: again.fetch,
      assetFetch: assets().fetch,
      now: () => new Date('2026-10-19T00:00:00Z'),
    });
    const { results } = await createPublisher({ adapters: [adapter2], runtime: 'web' }).publish(
      job({ content: undefined })
    );
    expect(results['github-pages']?.report?.map((i) => i.kind)).toEqual([
      'image.reused',
      'image.failed',
      'unchanged',
    ]);
    expect(again.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('fails asking to bind without an account', async () => {
    const gh = githubRepo();
    const events: PublishEvent[] = [];
    const unbound = createPublisher({
      adapters: [createGithubPagesWebAdapter({ githubFetch: gh.fetch })],
      runtime: 'web',
      fetch: mockFetch({}).fetch,
      onEvent: (_p, e) => events.push(e),
    });
    await unbound.publish(job({ accounts: {} }));
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'bind',
      reason: '请先在「设置 → 平台账号」绑定 GitHub 令牌',
    });
    expect(gh.calls).toHaveLength(0);
  });

  it('maps an expired token to relogin', async () => {
    const api = mockFetch({
      'POST /api/v1/platform-accounts/acc%201/github-token': () =>
        json({ code: 40101, data: null, message: '授权已过期' }),
    });
    const events: PublishEvent[] = [];
    await createPublisher({
      adapters: [createGithubPagesWebAdapter()],
      runtime: 'web',
      fetch: api.fetch,
      onEvent: (_p, e) => events.push(e),
    }).publish(job());
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'relogin', reason: '授权已过期' });
  });

  it('previews every file and the predicted report', async () => {
    const publisher = createPublisher({ adapters: [githubPagesWebAdapter], runtime: 'web' });
    const p = await publisher.preview('github-pages', {
      doc,
      form: { repo: 'me/blog', post_id: 'p1' },
      content: { kind: 'article', doc, translations: { en } },
    });
    expect(p?.format).toBe('files');
    expect(p?.url).toBe('https://me.github.io/blog/p1/');
    expect(p?.files?.map((f) => f.path)).toEqual([
      'content/posts/p1/index.zh-CN.html',
      'content/posts/p1/index.en.html',
    ]);
    expect(p?.report.map((i) => i.kind)).toEqual(['image.rehosted', 'translated']);
  });

  it('plain fetch never sends cookies to third parties', async () => {
    const seen: RequestInit[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response('{}');
    }) as typeof fetch;
    try {
      await plainFetch('https://api.github.com/x', { credentials: 'include', method: 'GET' });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0]?.credentials).toBe('omit');
  });
});
