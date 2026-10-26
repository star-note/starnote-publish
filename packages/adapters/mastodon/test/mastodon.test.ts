import { MemoryCredentialStore } from '@starnote/publish-kit';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc, json, mockFetch, runPublish } from '../../kit/test/helpers';
import {
  createMastodonAdapter,
  mastodonAdapter,
  mastodonBinding,
  mastodonLength,
  normalizeInstance,
  renderMastodon,
} from '../src/index';

describe('renderMastodon', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL, lang: 'zh-CN' };

  it('title + summary + hashtags + link, language from the article', () => {
    const r = renderMastodon(
      doc,
      mastodonAdapter.schema.parse({}),
      {
        title: 'Hello Title',
        summary: 'One line',
        tags: ['TypeScript', 'web dev', '2026'],
      },
      content
    );
    expect(r.body).toEqual({
      status: `Hello Title\n\nOne line\n\n#TypeScript #webdev\n\n${CANONICAL}`,
      visibility: 'public',
      language: 'zh',
    });
    expect(r.report.map((i) => i.kind)).toContain('link.card');
  });

  it('fits the instance limit (URLs count 23)', () => {
    expect(mastodonLength(`ab ${CANONICAL}`)).toBe(3 + 23);
    const r = renderMastodon(
      doc,
      mastodonAdapter.schema.parse({ visibility: 'unlisted', spoiler_text: 'CW', sensitive: true }),
      { title: 'T', summary: '长'.repeat(600), tags: ['a1', 'b2'] },
      content,
      { maxCharacters: 100 }
    );
    expect(mastodonLength(r.body.status)).toBeLessThanOrEqual(100);
    expect(r.body.status.endsWith(CANONICAL)).toBe(true);
    expect(r.body).toMatchObject({ visibility: 'unlisted', spoiler_text: 'CW', sensitive: true });
    expect(r.report.map((i) => i.kind)).toContain('share.truncated');
  });

  it('normalizes instance hosts', () => {
    expect(normalizeInstance('https://Mastodon.Social/@me')).toBe('mastodon.social');
    expect(normalizeInstance('127.0.0.1')).toBeNull();
    expect(normalizeInstance('localhost')).toBeNull();
    expect(mastodonBinding.form!.parse({ instance: 'https://fosstodon.org/' })).toEqual({
      instance: 'fosstodon.org',
    });
  });
});

describe('mastodon adapter', () => {
  it('uses the account limit and sends the page-memory token with the instance', async () => {
    const store = new MemoryCredentialStore();
    store.set(
      'mastodon',
      { access_token: 'tok', expires_at: null },
      { instance: 'mastodon.social' }
    );
    const adapter = createMastodonAdapter({ credential: store.credentialFor });
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon': () =>
        json({
          code: 0,
          data: { url: 'https://mastodon.social/@me/1', external_id: '1' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      adapter,
      {
        common: { title: 'x'.repeat(300) },
        accounts: {
          mastodon: {
            id: 'a',
            platform: 'mastodon',
            externalUid: '1',
            displayName: 'me',
            store: 'desktop',
            meta: { max_characters: 120 },
          },
        },
      },
      { runtime: 'web', fetch }
    );
    expect(result.ok).toBe(true);
    expect(calls[0]!.body.credential).toEqual({ access_token: 'tok', instance: 'mastodon.social' });
    expect(mastodonLength(calls[0]!.body.body.status)).toBeLessThanOrEqual(120);
  });
});

describe('SPEC-r12: link comment, tracking link, pasted links', () => {
  const doc = fixtureDoc();
  const S = 'https://starnote.app/s/AbCd1234';

  it('first_comment: no link in the status, the reply carries the short link', () => {
    const r = renderMastodon(
      doc,
      mastodonAdapter.schema.parse({ linkPlacement: 'first_comment' }),
      { title: 'Hello Title', tags: ['TS'] },
      { kind: 'article', doc, canonicalUrl: CANONICAL, trackingUrl: S }
    );
    expect(r.body.status).not.toContain('http');
    expect(r.followUp).toEqual({ kind: 'link_comment', text: `原文：${S}` });
    expect(r.report.map((i) => i.kind)).toContain('link.first_comment');
    const p = mastodonAdapter.preview!(
      doc,
      mastodonAdapter.schema.parse({ linkPlacement: 'first_comment' }),
      {},
      {
        kind: 'article',
        doc,
        canonicalUrl: CANONICAL,
      }
    ) as { followUp?: unknown };
    expect(p.followUp).toEqual({ kind: 'link_comment', text: `原文：${CANONICAL}` });
    const req = mastodonAdapter.renderRequest!({
      doc,
      form: mastodonAdapter.schema.parse({ linkPlacement: 'first_comment' }),
      common: {},
      content: { kind: 'article', doc, canonicalUrl: CANONICAL },
    });
    expect(req.follow_up).toEqual({ kind: 'link_comment', text: `原文：${CANONICAL}` });
  });

  it('publishes, then replies once through …/comment with the visibility as meta', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon/comment': () =>
        json({
          code: 0,
          data: { platform: 'mastodon', external_id: '2', url: 'https://m.social/@me/2' },
        }),
      'POST /api/v1/notes/note-1/publish/mastodon': () =>
        json({ code: 0, data: { url: 'https://m.social/@me/1', external_id: '1' } }),
    });
    const { result } = await runPublish(
      createMastodonAdapter(),
      { form: { linkPlacement: 'first_comment', visibility: 'unlisted' }, trackingUrl: S },
      { runtime: 'electron', fetch }
    );
    expect(result).toMatchObject({
      ok: true,
      externalId: '1',
      followUp: { state: 'succeeded', externalId: '2', url: 'https://m.social/@me/2' },
    });
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/notes/note-1/publish/mastodon',
      '/api/v1/notes/note-1/publish/mastodon/comment',
    ]);
    expect(calls[0]!.body.body.status).not.toContain(S);
    expect(calls[1]!.body).toMatchObject({
      parent: { external_id: '1', meta: { visibility: 'unlisted' } },
      text: `原文：${S}`,
    });
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe('comment:mastodon:1');
  });

  it('body placement uses the short link in the status', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon': () =>
        json({ code: 0, data: { url: 'u', external_id: '1' } }),
    });
    const { result } = await runPublish(
      createMastodonAdapter(),
      { trackingUrl: S },
      { runtime: 'electron', fetch }
    );
    expect(result.followUp).toBeUndefined();
    expect(calls[0]!.body.body.status.endsWith(S)).toBe(true);
  });

  it('parses pasted links and reads stats of a pasted link', async () => {
    expect(mastodonAdapter.parsePostUrl!('https://m.social/@me/77')).toEqual({
      externalId: '77',
      url: 'https://m.social/@me/77',
    });
    const { fetch, calls } = mockFetch({
      'GET /api/v1/statuses/77': () =>
        json({ favourites_count: 3, replies_count: 1, reblogs_count: 2 }),
    });
    const s = await mastodonAdapter.fetchStats!('https://m.social/@me/77', {
      fetch,
      signal: new AbortController().signal,
    });
    expect(s).toMatchObject({ likes: 3, comments: 1, shares: 2 });
    expect(calls[0]!.url).toBe('https://m.social/api/v1/statuses/77');
    expect(
      await mastodonAdapter.fetchStats!('https://m.social/about', {
        fetch,
        signal: new AbortController().signal,
      })
    ).toBeNull();
  });
});

describe('SPEC-r12 Mastodon stats tokens (review)', () => {
  const signal = new AbortController().signal;
  const route = () => json({ favourites_count: 1 });

  it('a pasted link is read on its own instance; the token only goes to the instance it belongs to', async () => {
    const { fetch, calls } = mockFetch({ 'GET /api/v1/statuses/': route });
    await mastodonAdapter.fetchStats!('https://other.org/@me/5', {
      fetch,
      signal,
      runtime: 'web',
      credential: { access_token: 'tok', instance: 'mastodon.social' },
    });
    expect(calls[0]!.url).toBe('https://other.org/api/v1/statuses/5');
    expect(calls[0]!.headers.get('Authorization')).toBeNull();

    await mastodonAdapter.fetchStats!('https://mastodon.social/@me/6', {
      fetch,
      signal,
      runtime: 'web',
      credential: { access_token: 'tok', instance: 'mastodon.social' },
    });
    expect(calls[1]!.headers.get('Authorization')).toBe('Bearer tok');
  });

  it('no instance on the credential: never a token to a host taken from a link', async () => {
    const { fetch, calls } = mockFetch({ 'GET /api/v1/statuses/': route });
    await mastodonAdapter.fetchStats!('7', {
      fetch,
      signal,
      runtime: 'web',
      url: 'https://evil.example/@me/7',
      credential: { access_token: 'tok' },
    });
    expect(calls[0]!.url).toBe('https://evil.example/api/v1/statuses/7');
    expect(calls[0]!.headers.get('Authorization')).toBeNull();
    expect(
      await mastodonAdapter.fetchStats!('https://mastodon.social/@bob@other.org/9', {
        fetch,
        signal,
        runtime: 'web',
      })
    ).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
