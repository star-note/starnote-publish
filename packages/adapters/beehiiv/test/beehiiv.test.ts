import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { BEEHIIV_REQUESTS, beehiivAdapter, beehiivBinding, renderBeehiiv } from '../src/index';

const PUB = 'pub_11ebcfc9-38ee-405d-a0e4-c2f6072133f1';
const POST = 'post_00000000-1111-2222-3333-444444444444';

describe('renderBeehiiv', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };

  it('a draft post by default with subtitle, tags and thumbnail', () => {
    const r = renderBeehiiv(
      doc,
      beehiivAdapter.schema.parse({}),
      { title: 'Hello Title', summary: 'One line', tags: ['TS', 'Web'], cover: '/c.png' },
      content,
      { assetBase: ASSET_BASE }
    );
    expect(r.body.post).toEqual({
      title: 'Hello Title',
      body_content: r.html,
      status: 'draft',
      subtitle: 'One line',
      content_tags: ['TS', 'Web'],
      thumbnail_image_url: 'https://starnote.app/c.png',
    });
    expect(r.report.find((i) => i.kind === 'draft.only')).toBeDefined();
  });

  it('publishing now warns that it is sent; scheduling is confirmed + scheduled_at', () => {
    const now = renderBeehiiv(
      doc,
      beehiivAdapter.schema.parse({ status: 'confirmed' }),
      {},
      content
    );
    expect(now.body.post.status).toBe('confirmed');
    expect(now.report.find((i) => i.kind === 'sent.now')?.level).toBe('warn');
    const at = '2026-11-01T09:00:00Z';
    const s = renderBeehiiv(
      doc,
      beehiivAdapter.schema.parse({ status: 'schedule', scheduled_at: at }),
      {},
      content
    );
    expect(s.body.post).toMatchObject({ status: 'confirmed', scheduled_at: at });
  });
});

describe('beehiiv adapter', () => {
  it('binding says the plan; publishes through 辰记; reads stats with the publication', async () => {
    expect(beehiivBinding.instructions![0]).toContain('Pro 和 Enterprise');
    expect(
      beehiivBinding.form!.safeParse({ api_key: 'k'.repeat(30), publication_id: PUB }).success
    ).toBe(true);
    expect(
      beehiivBinding.form!.safeParse({ api_key: 'k'.repeat(30), publication_id: 'pub_x' }).success
    ).toBe(false);
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/beehiiv': () =>
        json({
          code: 0,
          data: { url: 'https://x.beehiiv.com/p/hello', external_id: POST, report: [] },
          message: 'ok',
        }),
      [`GET /v2/publications/${PUB}/posts/${POST}`]: () =>
        json({
          data: {
            id: POST,
            stats: {
              email: { recipients: 10, unique_opens: 6, open_rate: 60, click_rate: 2 },
              web: { views: 33, clicks: 1 },
            },
          },
        }),
    });
    const { result } = await runPublish(beehiivAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: POST, state: 'draft' });
    const ctx = {
      fetch,
      signal: new AbortController().signal,
      runtime: 'web' as const,
      credential: { api_key: 'k' },
      account: {
        id: 'a',
        platform: 'beehiiv',
        externalUid: PUB,
        displayName: 'B',
        store: 'server' as const,
        meta: { publication_id: PUB },
      },
    };
    expect(await beehiivAdapter.fetchStats!(POST, ctx)).toMatchObject({
      views: 33,
      reads: 6,
      extra: { recipients: 10 },
    });
    expect(calls[1]!.url).toContain('?expand=stats');
    expect(await beehiivAdapter.fetchStats!(POST, { ...ctx, account: undefined })).toBeNull();
    expect(BEEHIIV_REQUESTS.update.method).toBe('PATCH');
  });
});
