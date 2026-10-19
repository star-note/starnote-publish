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
  createWordpressAdapter,
  renderWordpress,
  WORDPRESS_REQUESTS,
  wordpressAdapter,
  wordpressUrl,
} from '../src/index';

const SITE = 'https://wp.example.com';

describe('renderWordpress', () => {
  const doc = fixtureDoc();
  it('emits HTML and closes with a 首发于辰记 note (no canonical field in core)', () => {
    const r = renderWordpress(
      doc,
      wordpressAdapter.schema.parse({ categories: [3] }),
      { title: 'Hello Title', summary: 'S', tags: ['TS'] },
      { kind: 'article', doc, canonicalUrl: CANONICAL },
      { assetBase: ASSET_BASE }
    );
    expect(r.html).toContain('<blockquote>\n<p><strong>提示</strong></p>');
    expect(r.html).toContain(`<p><em>本文首发于<a href="${CANONICAL}">辰记</a>。</em></p>`);
    expect(r.post).toMatchObject({
      title: 'Hello Title',
      status: 'publish',
      excerpt: 'S',
      categories: [3],
    });
    expect(r.tagNames).toEqual(['TS']);
    expect(r.report.map((i) => i.kind)).toContain('canonical.note');
  });
  it('writes the note in English for English content', () => {
    const r = renderWordpress(
      doc,
      wordpressAdapter.schema.parse({}),
      {},
      { kind: 'article', doc, canonicalUrl: CANONICAL, lang: 'en' }
    );
    expect(r.html).toContain(`Originally published at <a href="${CANONICAL}">${CANONICAL}</a>.`);
    expect(r.html).toContain('<strong>Tip</strong>');
  });
  it('builds both REST styles', () => {
    expect(wordpressUrl(`${SITE}/`, 'wp/v2/tags?search=a')).toBe(
      `${SITE}/wp-json/wp/v2/tags?search=a`
    );
    expect(wordpressUrl(SITE, 'wp/v2/tags?search=a', 'query')).toBe(
      `${SITE}/?rest_route=/wp/v2/tags&search=a`
    );
  });
});

describe('wordpress adapter (relay)', () => {
  it('posts the post, tag names and images; relogin from the server maps to rebind', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/wordpress': () =>
        json({
          code: 0,
          data: { url: 'https://wp.example.com/?p=55', external_id: '55', state: 'pending-review' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      createWordpressAdapter({ assetBase: ASSET_BASE }),
      { form: { status: 'pending' } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, state: 'pending-review', externalId: '55' });
    expect(calls[0]!.body.body).toMatchObject({
      tag_names: ['TypeScript', 'web dev'],
      images: ['https://starnote.app/assets/a.png'],
    });

    const bad = mockFetch({
      'POST /api/v1/notes/note-1/publish/wordpress': () =>
        json(
          {
            code: 40001,
            data: { error_code: 'relogin', status: 401 },
            message: 'WordPress 拒绝了授权',
          },
          400
        ),
    });
    const r = await runPublish(wordpressAdapter, {}, { runtime: 'web', fetch: bad.fetch });
    expect(r.terminal[0]).toMatchObject({ type: 'failed', code: 'relogin' });
    expect((r.terminal[0] as any).actions[0]).toMatchObject({
      kind: 'relogin',
      href: '/settings?tab=platforms&bind=wordpress',
    });
    expect(WORDPRESS_REQUESTS.verifyUser.url).toContain('users/me?context=edit');
  });
});
