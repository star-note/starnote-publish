import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { WORDPRESS_COM_REQUESTS, renderWordpressCom, wordpressComAdapter } from '../src/index';

describe('renderWordpressCom', () => {
  const doc = fixtureDoc();

  it('uses tag and category names, an excerpt and the origin note', () => {
    const r = renderWordpressCom(
      doc,
      wordpressComAdapter.schema.parse({
        site_id: '42',
        categories: ['Tech, AI', 'Notes'],
        slug: 'hello',
      }),
      {
        title: 'Hello Title',
        summary: 'One line',
        tags: ['a,b', 'Web Dev'],
        cover: '/covers/c.png',
      },
      { kind: 'article', doc, canonicalUrl: CANONICAL },
      { assetBase: ASSET_BASE }
    );
    expect(r.body).toEqual({
      site_id: '42',
      post: {
        title: 'Hello Title',
        content: r.html,
        status: 'publish',
        format: 'standard',
        excerpt: 'One line',
        tags: 'a b,Web Dev',
        categories: 'Tech AI,Notes',
        slug: 'hello',
      },
    });
    expect(r.html).toContain('本文首发于');
    expect(r.html.startsWith('<p><img src="https://starnote.app/covers/c.png"')).toBe(true);
    expect(r.report.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['canonical.note', 'cover.inline', 'tags.mapped'])
    );
  });

  it('drafts / pending / private', () => {
    for (const status of ['draft', 'pending', 'private'] as const) {
      const r = renderWordpressCom(doc, wordpressComAdapter.schema.parse({ status }), {});
      expect(r.body.post.status).toBe(status);
      expect(r.report.map((i) => i.kind)).toContain('draft.only');
    }
  });
});

describe('wordpress-com adapter', () => {
  it('relays and reports pending review', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/wordpress-com': () =>
        json({
          code: 0,
          data: { url: 'https://me.wordpress.com/?p=9', external_id: '9' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      wordpressComAdapter,
      { form: { status: 'pending' } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: '9', state: 'pending-review' });
    expect(calls[0]!.body.body.post.status).toBe('pending');
    expect(wordpressComAdapter.binding).toMatchObject({ kind: 'oauth', store: 'desktop' });
    expect(WORDPRESS_COM_REQUESTS.create.url).toBe(
      'https://public-api.wordpress.com/rest/v1.1/sites/{site}/posts/new'
    );
  });
});
