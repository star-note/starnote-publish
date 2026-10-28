import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { QIITA_REQUESTS, qiitaAdapter, qiitaBinding, qiitaTag, renderQiita } from '../src/index';

const ITEM = 'c686397e4a0f4f11683d';

describe('renderQiita', () => {
  const doc = fixtureDoc();
  const r = renderQiita(
    doc,
    qiitaAdapter.schema.parse({}),
    { title: 'Hello Title', tags: ['TypeScript', 'web dev', 'a/b', 'Node.js', 'AI', 'extra'] },
    { kind: 'article', doc, canonicalUrl: CANONICAL },
    { assetBase: ASSET_BASE }
  );

  it('renders Markdown with $ math, absolute images and the origin line', () => {
    expect(r.markdown).toContain('## Pill heading');
    expect(r.markdown).toContain('$e^{i\\pi}+1=0$');
    expect(r.markdown).toContain('![A picture](https://starnote.app/assets/a.png)');
    expect(r.markdown).not.toContain('==this==');
    expect(r.markdown).toContain(`*本文首发于[辰记](${CANONICAL})。*`);
  });

  it('builds the item: 5 tags with versions, public by default', () => {
    expect(r.body.item).toEqual({
      title: 'Hello Title',
      body: r.markdown,
      tags: ['TypeScript', 'web-dev', 'ab', 'Node.js', 'AI'].map((name) => ({
        name,
        versions: [],
      })),
      private: false,
    });
    expect(qiitaTag(' / ')).toBeNull();
    const kinds = r.report.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['origin.note', 'tags.trimmed', 'tags.mapped']));
  });

  it('a Japanese article gets a Japanese origin line; no tags is an error', () => {
    const ja = renderQiita(
      doc,
      qiitaAdapter.schema.parse({ private: true, organization_url_name: 'starnote' }),
      { title: 'T' },
      { kind: 'article', doc, canonicalUrl: CANONICAL, lang: 'ja' }
    );
    expect(ja.markdown).toContain('この記事は [StarNote（辰記）]');
    expect(ja.body.item).toMatchObject({
      private: true,
      organization_url_name: 'starnote',
      tags: [],
    });
    expect(ja.report.find((i) => i.kind === 'tags.required')?.level).toBe('error');
    expect(ja.report.find((i) => i.kind === 'draft.only')).toBeDefined();
  });
});

describe('qiita adapter', () => {
  it('binds with a token and publishes through 辰记 (relay), updating a known item', async () => {
    expect(qiitaAdapter.runtime).toEqual(['web', 'electron']);
    expect(qiitaBinding.fields).toEqual(['token']);
    expect(qiitaBinding.form!.safeParse({ token: 'a'.repeat(40) }).success).toBe(true);
    expect(qiitaBinding.form!.safeParse({ token: 'short' }).success).toBe(false);
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/qiita': () =>
        json({
          code: 0,
          data: { url: `https://qiita.com/me/items/${ITEM}`, external_id: ITEM, report: [] },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      qiitaAdapter,
      { previous: { qiita: { platform: 'qiita', externalId: ITEM } } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: ITEM, state: 'published' });
    expect(calls[0]!.body.previous).toEqual({ external_id: ITEM });
    expect(calls[0]!.body.body.item.tags.map((t: any) => t.name)).toEqual([
      'TypeScript',
      'web-dev',
    ]);
    expect(QIITA_REQUESTS.update).toMatchObject({
      method: 'PATCH',
      url: 'https://qiita.com/api/v2/items/{id}',
    });
  });

  it('reads stats of an item id or a pasted link', async () => {
    const { fetch, calls } = mockFetch({
      [`GET /api/v2/items/${ITEM}`]: () =>
        json({
          id: ITEM,
          likes_count: 3,
          stocks_count: 2,
          comments_count: 1,
          page_views_count: 90,
        }),
    });
    const ctx = {
      fetch,
      signal: new AbortController().signal,
      runtime: 'web' as const,
      credential: { access_token: 'tok' },
    };
    expect(await qiitaAdapter.fetchStats!(ITEM, ctx)).toMatchObject({
      views: 90,
      likes: 3,
      comments: 1,
      favorites: 2,
    });
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok');
    const id = qiitaAdapter.parsePostUrl!(`https://qiita.com/me/items/${ITEM}?utm_source=x`)!;
    expect(id.externalId).toBe(ITEM);
    expect(await qiitaAdapter.fetchStats!('nope', ctx)).toBeNull();
  });
});
