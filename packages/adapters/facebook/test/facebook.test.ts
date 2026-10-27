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

describe('SPEC-r12 Facebook', () => {
  const S = 'https://starnote.app/s/AbCd1234';

  it('first_comment drops the link field; the Page comments it on the post', async () => {
    const r = renderFacebook(
      doc,
      parse({ linkPlacement: 'first_comment' }),
      { title: 'Hi' },
      article
    );
    expect(r.body).not.toHaveProperty('link');
    expect(r.followUp?.text).toBe(`原文：${CANONICAL}`);

    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/facebook/comment': () =>
        json({ code: 0, data: { platform: 'facebook', external_id: '1_2_3' } }),
      'POST /api/v1/notes/note-1/publish/facebook': () =>
        json({ code: 0, data: { url: 'https://www.facebook.com/2', external_id: '1_2' } }),
    });
    const { result } = await runPublish(
      createFacebookAdapter(),
      { form: { linkPlacement: 'first_comment' }, trackingUrl: S },
      { runtime: 'electron', fetch }
    );
    expect(result.followUp).toMatchObject({
      state: 'succeeded',
      externalId: '1_2_3',
      text: `原文：${S}`,
    });
    expect(calls[1]!.body).toMatchObject({ parent: { external_id: '1_2' }, text: `原文：${S}` });
  });

  it('body placement shares the short link; a pasted permalink gives the Graph id', () => {
    const r = renderFacebook(doc, parse(), { title: 'Hi' }, { ...article, trackingUrl: S });
    expect(r.body.link).toBe(S);
    expect(
      facebookAdapter.parsePostUrl!('https://www.facebook.com/permalink.php?story_fbid=2&id=1')
        ?.externalId
    ).toBe('1_2');
  });

  it('the cover is not checked against image rules (Facebook does not upload it)', () => {
    const r = renderFacebook(
      doc,
      parse(),
      { title: 'Hi', coverMeta: { mime: 'image/webp', bytes: 5 * 1024 * 1024 } },
      article
    );
    expect(r.report.filter((i) => i.kind.startsWith('media.'))).toEqual([]);
  });

  it('a post with only the link comment is still an empty post', async () => {
    const { convert } = await import('@starnote/publish-core');
    const { fetch, calls } = mockFetch({});
    const { terminal } = await runPublish(
      createFacebookAdapter(),
      {
        doc: convert({ type: 'doc', content: [] }),
        common: {},
        form: { linkPlacement: 'first_comment', include_summary: false, include_tags: false },
      },
      { runtime: 'electron', fetch }
    );
    expect(terminal[0]).toMatchObject({ type: 'failed', code: 'invalid' });
    expect(calls).toHaveLength(0);
  });
});
