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
  createInstagramApiAdapter,
  instagramApiAdapter,
  isPublicHttpsUrl,
  renderInstagramApi,
} from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => instagramApiAdapter.schema.parse(v);
const PATH = '/api/v1/notes/note-1/publish/instagram';

describe('renderInstagramApi', () => {
  it('cover + body images as a carousel request', () => {
    const r = renderInstagramApi(doc, parse(), { title: 'Hi', cover: '/c.png' }, article, {
      assetBase: ASSET_BASE,
    });
    expect(r.body.images).toEqual([
      { image_url: 'https://starnote.app/c.png' },
      { image_url: 'https://starnote.app/assets/a.png' },
    ]);
    expect(r.body.caption).toContain(CANONICAL);
  });

  it('refuses images Meta cannot fetch', () => {
    expect(() =>
      renderInstagramApi(doc, parse(), {}, article, { assetBase: 'http://localhost:5173/' })
    ).toThrow(/公网 HTTPS/);
    expect(isPublicHttpsUrl('https://starnote.app/a.png')).toBe(true);
    for (const u of [
      'http://x.com/a',
      'https://localhost/a',
      'https://192.168.1.2/a',
      'https://app.test/a',
    ])
      expect(isPublicHttpsUrl(u), u).toBe(false);
  });
});

describe('instagram API adapter', () => {
  it('three stages through the relay; the hand-off when not bound', async () => {
    const { fetch, calls } = mockFetch({
      [`POST ${PATH}/check`]: () =>
        json({ code: 0, data: { status: 'ready', pending: { container_id: 'k' } } }),
      [`POST ${PATH}/finalize`]: () =>
        json({
          code: 0,
          data: { status: 'completed', url: 'https://www.instagram.com/p/X/', external_id: 'm' },
        }),
      [`POST ${PATH}`]: () =>
        json({
          code: 0,
          data: { url: '', external_id: '', state: 'processing', pending: { container_id: 'k' } },
        }),
    });
    const a = createInstagramApiAdapter({ assetBase: ASSET_BASE, poll: { intervalSec: 0 } });
    const { result } = await runPublish(a, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: 'm' });
    expect(calls).toHaveLength(3);
    const h = a.renderHandoff!({ doc, form: parse(), common: {}, content: article });
    expect(h.handoff.via).toBe('web-share');
  });

  it('a localhost image fails as bad_body before anything is sent', async () => {
    const { fetch, calls } = mockFetch({});
    const a = createInstagramApiAdapter({ assetBase: 'http://localhost:5173/' });
    const { result } = await runPublish(a, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: false, kind: 'bad_body' });
    expect(calls).toHaveLength(0);
  });
});
