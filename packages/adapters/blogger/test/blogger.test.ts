import { MemoryCredentialStore } from '@starnote/publish-kit';
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
  BLOGGER_REQUESTS,
  bloggerAdapter,
  createBloggerAdapter,
  renderBlogger,
} from '../src/index';

const ok = (data: Record<string, unknown>) => () => json({ code: 0, data, message: 'ok' });

describe('renderBlogger', () => {
  const doc = fixtureDoc();
  const r = renderBlogger(
    doc,
    bloggerAdapter.schema.parse({ blog_id: '123' }),
    { title: 'Hello Title', tags: ['TypeScript', 'web dev', 'TypeScript'], cover: '/covers/c.png' },
    { kind: 'article', doc, canonicalUrl: CANONICAL, lang: 'zh-CN' },
    { assetBase: ASSET_BASE }
  );

  it('builds the relay body: HTML, labels, cover first, origin note last', () => {
    expect(r.body.blog_id).toBe('123');
    expect(r.body.is_draft).toBe(false);
    expect(r.body.post.kind).toBe('blogger#post');
    expect(r.body.post.title).toBe('Hello Title');
    expect(r.body.post.labels).toEqual(['TypeScript', 'web dev']);
    expect(r.html.startsWith('<p><img src="https://starnote.app/covers/c.png"')).toBe(true);
    expect(r.html).toContain('https://starnote.app/assets/a.png');
    expect(r.html).toContain(`本文首发于<a href="${CANONICAL}">辰记</a>`);
    expect(r.html).not.toContain('<h1'); // the title is a field
    expect(Object.keys(r.body.post).sort()).toEqual(['content', 'kind', 'labels', 'title']);
  });

  it('predicts the report', () => {
    const kinds = r.report.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'cover.inline',
        'canonical.note',
        'image.linked',
        'block.degraded.callout',
      ])
    );
  });

  it('drafts and English notes', () => {
    const d = renderBlogger(
      doc,
      bloggerAdapter.schema.parse({ status: 'draft' }),
      {},
      { kind: 'article', doc, canonicalUrl: CANONICAL, lang: 'en' }
    );
    expect(d.body.is_draft).toBe(true);
    expect(d.body.blog_id).toBeUndefined();
    expect(d.html).toContain('Originally published at');
    expect(d.report.map((i) => i.kind)).toContain('draft.only');
  });
});

describe('blogger adapter', () => {
  it('declares an OAuth binding kept on the desktop, and the official requests', () => {
    expect(bloggerAdapter.binding).toMatchObject({
      kind: 'oauth',
      store: 'desktop',
      provider: 'google',
    });
    expect(bloggerAdapter.runtime).toEqual(['electron', 'web', 'server']);
    expect(BLOGGER_REQUESTS.create.url).toContain('/blogs/{blogId}/posts?isDraft=');
  });

  it('relays without a credential on the desktop / with 云端代发', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/blogger': ok({
        url: 'https://me.blogspot.com/2026/10/hello.html',
        external_id: '777',
      }),
    });
    const { result } = await runPublish(
      bloggerAdapter,
      { form: { blog_id: '123' } },
      { runtime: 'electron', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: '777', state: 'published' });
    expect(calls[0]!.body.credential).toBeUndefined();
    expect(calls[0]!.body.body.blog_id).toBe('123');
  });

  it('sends the page-memory token only from the browser', async () => {
    const store = new MemoryCredentialStore();
    store.set('blogger', {
      access_token: 'ya29.test',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const adapter = createBloggerAdapter({ credential: store.credentialFor });
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/blogger': ok({
        url: 'https://x.blogspot.com/p',
        external_id: '1',
      }),
    });
    await runPublish(adapter, {}, { runtime: 'web', fetch });
    expect(calls[0]!.body.credential).toEqual({ access_token: 'ya29.test' });
    await runPublish(adapter, {}, { runtime: 'electron', fetch });
    expect(calls[1]!.body.credential).toBeUndefined();
  });

  it('maps relay errors', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/notes/note-1/publish/blogger': () =>
        json({ code: 40901, data: { error_code: 'local_only' }, message: '云端代发已关闭' }, 409),
    });
    const { terminal } = await runPublish(bloggerAdapter, {}, { runtime: 'web', fetch });
    expect(terminal[0]).toMatchObject({ type: 'failed', code: 'local_only' });
  });
});
