/** SPEC-r11 §7: `fetchStats` of DEV, Hashnode, Mastodon, Bluesky and Reddit (Threads / Pinterest: their packages). */
import { statsRow } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { blueskyAdapter, blueskyPostUri } from '../../bluesky/src/index';
import { devtoAdapter } from '../../devto/src/index';
import { hashnodeAdapter, HASHNODE_STATS_QUERY } from '../../hashnode/src/index';
import { mastodonAdapter, mastodonInstanceOf } from '../../mastodon/src/index';
import { redditAdapter } from '../../reddit/src/index';
import { json, mockFetch } from './helpers';

import type { StatsContext } from '@starnote/publish-core';

const sctx = (fetch: typeof globalThis.fetch, extra: Partial<StatsContext> = {}): StatsContext => ({
  fetch,
  signal: new AbortController().signal,
  runtime: 'electron',
  ...extra,
});

describe('fetchStats', () => {
  it('DEV: page views, reactions, comments of the article (api-key when given)', async () => {
    const { fetch, calls } = mockFetch({
      'GET /api/articles/me/all': () =>
        json([
          { id: 1, page_views_count: 10 },
          { id: 2, page_views_count: 99, public_reactions_count: 5, comments_count: 3 },
        ]),
    });
    const s = await devtoAdapter.fetchStats!('2', sctx(fetch, { credential: { api_key: 'k' } }));
    expect(s).toMatchObject({ source: 'official-api', views: 99, likes: 5, comments: 3 });
    expect(calls[0]!.headers.get('api-key')).toBe('k');
    expect(await devtoAdapter.fetchStats!('404', sctx(fetch))).toBeNull();
    expect(statsRow('devto', '2', s!)).toEqual({
      platform: 'devto',
      external_id: '2',
      views: 99,
      likes: 5,
      comments: 3,
    });
  });

  it('Hashnode: GraphQL post stats with the token', async () => {
    const { fetch, calls } = mockFetch({
      'POST /': () =>
        json({ data: { post: { id: 'p', views: 7, reactionCount: 2, responseCount: 1 } } }),
    });
    const s = await hashnodeAdapter.fetchStats!(
      'p',
      sctx(fetch, { credential: { api_key: 'pat' } })
    );
    expect(s).toMatchObject({ views: 7, likes: 2, comments: 1 });
    expect(calls[0]!.body).toEqual({ query: HASHNODE_STATS_QUERY, variables: { id: 'p' } });
    expect(calls[0]!.headers.get('Authorization')).toBe('pat');
  });

  it('Mastodon: public status counts on the account instance', async () => {
    const { fetch, calls } = mockFetch({
      'GET /api/v1/statuses/111': () =>
        json({ favourites_count: 4, replies_count: 1, reblogs_count: 2 }),
    });
    const s = await mastodonAdapter.fetchStats!(
      '111',
      sctx(fetch, { url: 'https://mastodon.social/@me/111' })
    );
    expect(s).toMatchObject({ source: 'public', likes: 4, comments: 1, shares: 2 });
    expect(calls[0]!.url).toBe('https://mastodon.social/api/v1/statuses/111');
    expect(
      mastodonInstanceOf({
        account: {
          id: '1',
          platform: 'mastodon',
          externalUid: 'x',
          displayName: 'x',
          store: 'desktop',
          meta: { instance: 'Fosstodon.org' },
        },
      })
    ).toBe('fosstodon.org');
  });

  it('Bluesky: AppView getPosts by AT URI (rkey + the account DID)', async () => {
    const { fetch, calls } = mockFetch({
      'GET /xrpc/app.bsky.feed.getPosts': () =>
        json({ posts: [{ likeCount: 3, replyCount: 1, repostCount: 2, quoteCount: 1 }] }),
    });
    const account = {
      id: '1',
      platform: 'bluesky',
      externalUid: 'did:plc:abc',
      displayName: 'me',
      store: 'desktop' as const,
    };
    const s = await blueskyAdapter.fetchStats!('3kx', sctx(fetch, { account }));
    expect(s).toMatchObject({ likes: 3, comments: 1, shares: 3, extra: { quotes: 1 } });
    expect(decodeURIComponent(calls[0]!.url)).toContain(
      'uris=at://did:plc:abc/app.bsky.feed.post/3kx'
    );
    expect(
      blueskyPostUri('3kx', { url: 'https://bsky.app/profile/me.bsky.social/post/3kx' })
    ).toEqual({
      handle: 'me.bsky.social',
      rkey: '3kx',
    });
  });

  it('Reddit: public by_id JSON; removed posts are null', async () => {
    const { fetch } = mockFetch({
      'GET /by_id/t3_x1.json': () =>
        json({ data: { children: [{ data: { score: 12, num_comments: 4, view_count: null } }] } }),
      'GET /by_id/t3_gone.json': () =>
        json({ data: { children: [{ data: { removed_by_category: 'moderator' } }] } }),
    });
    expect(await redditAdapter.fetchStats!('x1', sctx(fetch))).toMatchObject({
      likes: 12,
      comments: 4,
    });
    expect(await redditAdapter.fetchStats!('gone', sctx(fetch))).toBeNull();
  });
});

describe('renderRequest of the existing relay adapters (SPEC-r11 §12)', () => {
  it('is the body publish sends, with previous', () => {
    const r = redditAdapter.renderRequest!({
      doc: { title: 'T' } as any,
      form: redditAdapter.schema.parse({ subreddit: 'abc' }),
      common: { title: 'Hello' },
      content: {
        kind: 'article',
        doc: { title: 'T', images: [] } as any,
        canonicalUrl: 'https://s/1',
      },
    });
    expect(r.body).toMatchObject({ sr: 'abc', kind: 'link', url: 'https://s/1' });
    const h = redditAdapter.renderHandoff!({
      doc: { title: 'T' } as any,
      form: redditAdapter.schema.parse({ subreddit: 'abc' }),
      common: { title: 'Hello' },
      content: {
        kind: 'article',
        doc: { title: 'T', images: [] } as any,
        canonicalUrl: 'https://s/1',
      },
    });
    expect(h.handoff.openUrl.startsWith('https://www.reddit.com/r/abc/submit?')).toBe(true);
  });
});

describe('the canonical placeholder is budgeted at a real link', () => {
  it('Bluesky: a placeholder never goes into the text (facets would shift); it becomes the card', async () => {
    const { CANONICAL_PLACEHOLDER } = await import('@starnote/publish-core');
    const { renderBluesky } = await import('../../bluesky/src/index');
    const { fixtureDoc } = await import('./helpers');
    const doc = fixtureDoc();
    const r = renderBluesky(
      doc,
      blueskyAdapter.schema.parse({ link_card: false }),
      { title: 'T', summary: 's'.repeat(400), tags: ['a'] },
      { kind: 'article', doc, canonicalUrl: CANONICAL_PLACEHOLDER }
    );
    expect(r.text).not.toContain(CANONICAL_PLACEHOLDER);
    expect(r.body.record.embed?.external.uri).toBe(CANONICAL_PLACEHOLDER);
    expect(r.body.record.facets?.some((f) => f.features[0]!.$type.endsWith('#link'))).toBeFalsy();
    expect(r.report.map((i) => i.kind)).toContain('link.card.forced');
  });

  it('Instagram caption leaves room for the real link', async () => {
    const { CANONICAL_PLACEHOLDER, CANONICAL_PLACEHOLDER_RESERVE } =
      await import('@starnote/publish-core');
    const { instagramAdapter, renderInstagram } = await import('../../instagram/src/index');
    const { fixtureDoc } = await import('./helpers');
    const doc = fixtureDoc();
    const r = renderInstagram(
      doc,
      instagramAdapter.schema.parse({}),
      { title: 'T', summary: 'x'.repeat(5000) },
      { kind: 'article', doc, canonicalUrl: CANONICAL_PLACEHOLDER }
    );
    expect(r.caption).toContain(CANONICAL_PLACEHOLDER);
    expect(
      [...r.caption].length - CANONICAL_PLACEHOLDER.length + CANONICAL_PLACEHOLDER_RESERVE
    ).toBeLessThanOrEqual(2200);
  });
});
