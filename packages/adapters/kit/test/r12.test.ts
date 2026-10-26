import { describe, expect, it } from 'vitest';

import {
  cardOf,
  linkCommentText,
  linkPlacementField,
  originLinkOf,
  PlatformError,
  placeLink,
  relayFollowUp,
  relayPublish,
  relayRequestOf,
} from '../src/index';
import { CANONICAL, fixtureDoc, json, mockFetch } from './helpers';

const ref = { key: 'mastodon', label: 'Mastodon' };
const S = 'https://starnote.app/s/AbCd1234';

function ctx(fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) {
  return {
    fetch,
    signal: new AbortController().signal,
    noteId: 'note-1',
    apiBase: '/api/v1',
    ...extra,
  };
}

describe('relayFollowUp (SPEC-r12 §2.2)', () => {
  it('posts parent + text + account to …/comment with the comment key; an empty url is left out', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon/comment': () =>
        json({ code: 0, data: { platform: 'mastodon', external_id: '99', url: '' } }),
    });
    const r = await relayFollowUp(
      ctx(fetch, { accountId: 'acc-1' }),
      ref,
      { externalId: '1131', url: 'https://m/@me/1131', meta: { visibility: 'unlisted' } },
      { kind: 'link_comment', text: `原文：${S}` },
      { credential: { access_token: 'tok', instance: 'm.social' } }
    );
    expect(r).toEqual({ externalId: '99' });
    expect(calls[0]!.headers.get('Idempotency-Key')).toBe('comment:mastodon:1131');
    expect(calls[0]!.body).toEqual({
      parent: { external_id: '1131', meta: { visibility: 'unlisted' } },
      text: `原文：${S}`,
      credential: { access_token: 'tok', instance: 'm.social' },
      account_id: 'acc-1',
    });
  });

  it('maps the error envelope like a publish (a write: 5xx without a kind is unknown)', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon/comment': () =>
        json(
          {
            code: 40001,
            message: '不允许评论',
            data: { error_code: 'forbidden', error_kind: 'bad_body' },
          },
          400
        ),
    });
    const err = await relayFollowUp(
      ctx(fetch),
      ref,
      { externalId: '1', url: '' },
      { kind: 'link_comment', text: 't' }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect(err).toMatchObject({ code: 'forbidden', errorKind: 'bad_body' });

    const { fetch: f2 } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon/comment': () =>
        new Response('bad gateway', { status: 502 }),
    });
    const e2 = await relayFollowUp(
      ctx(f2),
      ref,
      { externalId: '1', url: '' },
      { kind: 'link_comment', text: 't' }
    ).catch((e) => e);
    expect(e2.errorKind).toBe('unknown');
  });

  it('relayPublish passes data.meta on; relayRequestOf carries follow_up', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon': () =>
        json({ code: 0, data: { url: 'u', external_id: '1', meta: { visibility: 'public' } } }),
    });
    const res = await relayPublish(ctx(fetch), ref, { status: 'x' });
    expect(res.meta).toEqual({ visibility: 'public' });
    expect(
      relayRequestOf({ a: 1 }, undefined, undefined, [], { kind: 'link_comment', text: 't' })
    ).toEqual({
      body: { a: 1 },
      follow_up: { kind: 'link_comment', text: 't' },
    });
  });
});

describe('link placement and tracking links (SPEC-r12 §2.2, §5.3)', () => {
  it('placeLink moves the link into the comment; the text follows the language', () => {
    expect(placeLink('body', S)).toEqual({ bodyLink: S, report: [] });
    expect(placeLink('first_comment', undefined)).toEqual({ bodyLink: undefined, report: [] });
    const r = placeLink('first_comment', S, 'en');
    expect(r.bodyLink).toBeUndefined();
    expect(r.followUp).toEqual({ kind: 'link_comment', text: `Read more: ${S}` });
    expect(r.report[0]!.kind).toBe('link.first_comment');
    expect(linkCommentText(S)).toBe(`原文：${S}`);
    expect(linkCommentText(S, 'zh-TW')).toBe(`原文：${S}`);
    expect(linkPlacementField('linkedin').parse(undefined)).toBe('first_comment');
    expect(linkPlacementField('threads').parse(undefined)).toBe('body');
  });

  it('cards use the short link; a form link still wins; origin lines follow the form canonical', () => {
    const doc = fixtureDoc();
    const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL, trackingUrl: S };
    expect(cardOf(doc, {}, article).link).toBe(S);
    expect(cardOf(doc, {}, article, { link: 'https://x.dev/a' }).link).toBe('https://x.dev/a');
    expect(originLinkOf({}, article, CANONICAL)).toBe(S);
    expect(originLinkOf({ canonical_url: 'https://own/1' }, article, 'https://own/1')).toBe(
      'https://own/1'
    );
  });
});
