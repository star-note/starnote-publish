import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { HATENA_REQUESTS, hatenaAdapter, hatenaBinding, renderHatena } from '../src/index';

describe('renderHatena', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL, lang: 'ja' };

  it('Markdown mode: Markdown body, categories, published entry', () => {
    const r = renderHatena(
      doc,
      hatenaAdapter.schema.parse({}),
      { title: 'Hello Title', tags: ['TypeScript', 'web dev'] },
      content,
      { assetBase: ASSET_BASE }
    );
    expect(r.format).toBe('markdown');
    expect(r.content).toContain('## Pill heading');
    expect(r.content).toContain('この記事は [StarNote（辰記）]');
    expect(r.body.entry).toEqual({
      title: 'Hello Title',
      content: r.content,
      categories: ['TypeScript', 'web dev'],
      draft: false,
    });
    expect(r.report.find((i) => i.kind === 'syntax.mode')!.text).toContain('Markdown');
  });

  it('見たまま mode sends HTML; drafts and 予約投稿', () => {
    const html = renderHatena(
      doc,
      hatenaAdapter.schema.parse({ syntax: 'html', draft: true }),
      {},
      content
    );
    expect(html.format).toBe('html');
    expect(html.content).toContain('<h2');
    expect(html.content).toContain('StarNote（辰記）</a>');
    expect(html.body.entry.draft).toBe(true);
    const at = '2026-11-01T09:00:00+09:00';
    const s = renderHatena(
      doc,
      hatenaAdapter.schema.parse({ schedule_at: at, custom_url: 'my/entry' }),
      {},
      content
    );
    expect(s.body.entry).toMatchObject({
      draft: true,
      scheduled: true,
      updated: at,
      custom_url: 'my/entry',
    });
    expect(s.report.find((i) => i.kind === 'scheduled')).toBeDefined();
    expect(hatenaAdapter.schema.safeParse({ schedule_at: '2026-11-01 09:00' }).success).toBe(false);
  });
});

describe('hatena adapter', () => {
  it('binds with Hatena ID + blog ID + API key and publishes through 辰记', async () => {
    const form = hatenaBinding.form!;
    expect(
      form.safeParse({ hatena_id: 'me-123', blog_id: 'Me.Hatenablog.com', api_key: 'abcdefghij' })
        .success
    ).toBe(true);
    expect(
      form.safeParse({ hatena_id: 'id:me', blog_id: 'x', api_key: 'abcdefghij' }).success
    ).toBe(false);
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/hatena': () =>
        json({
          code: 0,
          data: {
            url: 'https://me.hatenablog.com/entry/2026/10/28/hello',
            external_id: '13574176438046791234',
            report: [],
          },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      hatenaAdapter,
      { form: { draft: true } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: '13574176438046791234', state: 'draft' });
    expect(calls[0]!.body.body.entry.draft).toBe(true);
    expect(HATENA_REQUESTS.create.url).toBe(
      'https://blog.hatena.ne.jp/{hatena_id}/{blog_id}/atom/entry'
    );
    expect(hatenaAdapter.fetchStats).toBeUndefined();
    expect(
      hatenaAdapter.parsePostUrl!('https://me.hatenablog.com/entry/2026/10/28/hello?utm_source=x')
    ).toEqual({
      externalId: 'https://me.hatenablog.com/entry/2026/10/28/hello',
      url: 'https://me.hatenablog.com/entry/2026/10/28/hello',
    });
  });
});
