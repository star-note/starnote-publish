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
  createPinterestAdapter,
  fetchPinterestStats,
  pinterestAdapter,
  renderPinterest,
} from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => pinterestAdapter.schema.parse(v);
const account = {
  id: 'p1',
  platform: 'pinterest',
  externalUid: 'u',
  displayName: 'me',
  store: 'desktop' as const,
  meta: { board_id: '987' },
};

describe('renderPinterest', () => {
  it('cover + link + the bound board', () => {
    const r = renderPinterest(
      doc,
      parse(),
      { title: 'Hi', summary: 'Sum', tags: ['a'], cover: '/c.png', coverAlt: 'alt' },
      article,
      { assetBase: ASSET_BASE, account }
    );
    expect(r.body).toEqual({
      board_id: '987',
      title: 'Hi',
      description: 'Sum\n\n#a',
      link: CANONICAL,
      alt_text: 'alt',
      media_source: { source_type: 'image_url', url: 'https://starnote.app/c.png' },
    });
  });

  it('needs an https image and a board', () => {
    expect(() =>
      renderPinterest({ ...doc, images: [] }, parse(), {}, article, { account })
    ).toThrow(/图片/);
    expect(() =>
      renderPinterest(doc, parse(), { cover: '/c.png' }, article, { assetBase: ASSET_BASE })
    ).toThrow(/画板/);
  });
});

describe('pinterest adapter', () => {
  it('relays with the account board; fails as bad_body without one', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/pinterest': () =>
        json({ code: 0, data: { url: 'https://www.pinterest.com/pin/1/', external_id: '1' } }),
    });
    const a = createPinterestAdapter({ assetBase: ASSET_BASE });
    const ok = await runPublish(a, { accounts: { pinterest: account } }, { runtime: 'web', fetch });
    expect(ok.result).toMatchObject({ ok: true, externalId: '1' });
    expect(calls[0]!.body.body.board_id).toBe('987');
    const bad = await runPublish(a, {}, { runtime: 'web', fetch });
    expect(bad.result).toMatchObject({ ok: false, kind: 'bad_body' });
  });

  it('analytics → stats', async () => {
    const { fetch, calls } = mockFetch({
      'GET /v5/pins/1/analytics': () =>
        json({
          all: { summary_metrics: { IMPRESSION: 50, SAVE: 3, PIN_CLICK: 4, OUTBOUND_CLICK: 2 } },
        }),
    });
    const now = Date.UTC(2026, 9, 26);
    const s = await fetchPinterestStats(
      '1',
      {
        fetch,
        signal: new AbortController().signal,
        runtime: 'web',
        credential: { access_token: 't' },
      },
      undefined,
      now
    );
    expect(s).toMatchObject({
      views: 50,
      favorites: 3,
      extra: { pin_clicks: 4, outbound_clicks: 2 },
    });
    expect(calls[0]!.url).toContain('start_date=2026-07-29&end_date=2026-10-26');
  });
});

describe('SPEC-r12 Pinterest', () => {
  it('reads stats of a pasted Pin link by its id', async () => {
    const { fetch, calls } = mockFetch({
      'GET /v5/pins/4455/analytics': () => json({ all: { summary_metrics: { IMPRESSION: 12 } } }),
    });
    const ctx = { fetch, signal: new AbortController().signal, runtime: 'web' as const };
    expect(await fetchPinterestStats('https://www.pinterest.com/pin/4455/', ctx)).toMatchObject({
      views: 12,
    });
    expect(calls).toHaveLength(1);
    expect(await fetchPinterestStats('https://www.pinterest.com/me/board/', ctx)).toBeNull();
  });
});
