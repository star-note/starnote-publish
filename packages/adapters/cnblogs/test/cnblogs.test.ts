import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import {
  CNBLOGS_REQUESTS,
  cnblogsAdapter,
  cnblogsBinding,
  cnblogsRelayBody,
  renderCnblogs,
} from '../src/index';

describe('renderCnblogs', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const common = {
    title: 'Hello Title',
    summary: 'One line',
    tags: ['TypeScript', 'web dev', 'TypeScript'],
  };
  const r = renderCnblogs(doc, cnblogsAdapter.schema.parse({}), common, content, {
    assetBase: ASSET_BASE,
  });

  it('renders Markdown with $ math and absolute images, title kept out of the body', () => {
    expect(r.markdown).not.toContain('# Hello Title');
    expect(r.markdown).toContain('![A picture](https://starnote.app/assets/a.png)');
    expect(r.markdown).toContain('$e^{i\\pi}+1=0$');
    expect(r.markdown).not.toContain('==this==');
  });

  it('builds the MetaWeblog post: [Markdown], tags, excerpt; images for the server to upload', () => {
    expect(r.post).toEqual({
      title: 'Hello Title',
      description: r.markdown,
      categories: ['[Markdown]'],
      mt_keywords: 'TypeScript,web dev',
      mt_excerpt: 'One line',
    });
    expect(r.images).toContain('https://starnote.app/assets/a.png');
    const kinds = Object.fromEntries(r.report.map((i) => [i.kind, i.text]));
    expect(kinds['format.markdown']).toContain('Markdown');
    expect(kinds['image.rehosted']).toContain('由服务器上传到博客园');
    expect(kinds['rules.tech-only']).toContain('技术内容');
    expect(kinds['origin.note']).toBeUndefined();
    expect(kinds['home.submitted']).toBeUndefined();
  });

  it('personal categories, the front page and the draft are the user’s choices', () => {
    const form = cnblogsAdapter.schema.parse({
      categories: ['前端', '前端', 'TypeScript'],
      home: true,
      published: false,
      origin_note: true,
    });
    const x = renderCnblogs(doc, form, common, content);
    expect(x.post.categories).toEqual([
      '[Markdown]',
      '[随笔分类]前端',
      '[随笔分类]TypeScript',
      '[发布至博客园首页]',
    ]);
    expect(x.markdown).toContain(CANONICAL);
    expect(cnblogsRelayBody(x, form)).toMatchObject({ publish: false });
    const kinds = x.report.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['home.submitted', 'draft.only', 'origin.note']));
    expect(
      cnblogsAdapter.schema.safeParse({ categories: ['1', '2', '3', '4', '5', '6'] }).success
    ).toBe(false);
  });
});

describe('cnblogs adapter', () => {
  it('binds with a personal access token stored on the server', () => {
    expect(cnblogsBinding).toMatchObject({ kind: 'token', store: 'server', provider: 'cnblogs' });
    const form = cnblogsBinding.form!;
    expect(form.safeParse({ blog_app: 'me', username: 'me', token: 'x'.repeat(32) }).success).toBe(
      true
    );
    expect(form.safeParse({ blog_app: 'a/b', username: 'me', token: 'x'.repeat(32) }).success).toBe(
      false
    );
    expect(CNBLOGS_REQUESTS.create.url).toBe('https://rpc.cnblogs.com/metaweblog/{blog_app}');
  });

  it('renders here and publishes through 辰记 (relay)', async () => {
    expect(cnblogsAdapter.runtime).toEqual(['web', 'electron']);
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/cnblogs': () =>
        json({
          code: 0,
          data: {
            url: 'https://www.cnblogs.com/me/p/18000001',
            external_id: '18000001',
            report: [{ kind: 'image.rehosted', text: '1 张图片已上传到博客园' }],
          },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(cnblogsAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({
      ok: true,
      url: 'https://www.cnblogs.com/me/p/18000001',
      externalId: '18000001',
      state: 'published',
    });
    const sent = calls[0]!.body;
    expect(sent.body).toMatchObject({ publish: true, post: { categories: ['[Markdown]'] } });
    expect(Array.isArray(sent.body.images)).toBe(true);
  });

  it('parses pasted post links and reads stats from the Open API', async () => {
    const parsed = cnblogsAdapter.parsePostUrl!(
      'https://www.cnblogs.com/me/p/18000001.html?utm_source=x'
    );
    expect(parsed).toEqual({
      externalId: '18000001',
      url: 'https://www.cnblogs.com/me/p/18000001',
    });
    const { fetch, calls } = mockFetch({
      'GET /api/blogs/me/posts': () =>
        json([
          { Id: 1, Url: 'https://www.cnblogs.com/me/p/1', ViewCount: 1 },
          { Id: 18000001, ViewCount: 120, CommentCount: 3, DiggCount: 9 },
        ]),
    });
    const ctx = {
      fetch,
      signal: new AbortController().signal,
      runtime: 'web' as const,
      credential: { blog_app: 'me', access_token: 'tok' },
    };
    expect(await cnblogsAdapter.fetchStats!('18000001', ctx)).toMatchObject({
      source: 'official-api',
      views: 120,
      comments: 3,
      likes: 9,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
    // a pasted link names the blog itself
    expect(
      await cnblogsAdapter.fetchStats!('https://www.cnblogs.com/me/p/1', { ...ctx, credential: {} })
    ).toMatchObject({ views: 1 });
    expect(await cnblogsAdapter.fetchStats!('42', { ...ctx, credential: {} })).toBeNull();
  });
});
