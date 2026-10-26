import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc, json, mockFetch, runPublish } from '../../kit/test/helpers';
import { createFacebookAdapter, facebookAdapter, renderFacebook } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => facebookAdapter.schema.parse(v);

describe('renderFacebook', () => {
  it('message + link (Facebook builds the card)', () => {
    const r = renderFacebook(
      doc,
      parse({ page_id: '123456' }),
      { title: 'Hi', summary: 'Sum', tags: ['x y'] },
      article
    );
    expect(r.body).toEqual({ message: 'Hi\n\nSum\n\n#xy', link: CANONICAL, page_id: '123456' });
  });
});

describe('facebook adapter', () => {
  it('relays; Share Dialog fallback with an app id', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/facebook': () =>
        json({ code: 0, data: { url: 'https://www.facebook.com/1_2', external_id: '1_2' } }),
    });
    const { result } = await runPublish(facebookAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: '1_2' });
    expect(calls[0]!.body.body.link).toBe(CANONICAL);
    const a = createFacebookAdapter({ facebookAppId: '42' });
    const h = a.renderHandoff!({ doc, form: parse(), common: {}, content: article });
    expect(h.handoff.openUrl.startsWith('https://www.facebook.com/dialog/share?')).toBe(true);
  });

  it('a token error (Meta 190) comes back as disconnect', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/notes/note-1/publish/facebook': () =>
        json(
          {
            code: 40101,
            message: 'token expired',
            data: { error_code: 'relogin', error_kind: 'disconnect', status: 401 },
          },
          401
        ),
    });
    const { result } = await runPublish(facebookAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: false, kind: 'disconnect', code: 'relogin' });
    expect(result.actions!.map((a) => a.kind)).toEqual(['relogin', 'help']);
  });
});
