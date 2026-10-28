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
  BUTTONDOWN_MARKDOWN_MODE,
  BUTTONDOWN_REQUESTS,
  buttondownAdapter,
  renderButtondown,
} from '../src/index';

describe('renderButtondown', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };

  it('a Markdown draft by default, with canonical, description and image', () => {
    const r = renderButtondown(
      doc,
      buttondownAdapter.schema.parse({}),
      { title: 'Hello Title', summary: 'One line', cover: '/c.png' },
      content,
      { assetBase: ASSET_BASE }
    );
    expect(r.body.email).toEqual({
      subject: 'Hello Title',
      body: `${BUTTONDOWN_MARKDOWN_MODE}\n${r.markdown}`,
      status: 'draft',
      description: 'One line',
      canonical_url: CANONICAL,
      image: 'https://starnote.app/c.png',
    });
    expect(r.body.email.body.startsWith('---')).toBe(false);
    expect(r.markdown).toContain('## Pill heading');
  });

  it('never sends right away: only draft or scheduled', () => {
    expect(buttondownAdapter.schema.safeParse({ status: 'about_to_send' }).success).toBe(false);
    const at = '2026-11-01T09:00:00Z';
    const s = renderButtondown(
      doc,
      buttondownAdapter.schema.parse({ status: 'scheduled', publish_date: at }),
      {},
      content
    );
    expect(s.body.email).toMatchObject({ status: 'scheduled', publish_date: at });
  });
});

describe('buttondown adapter', () => {
  it('publishes through 辰记 and reads analytics', async () => {
    const id = 'em_01jexample0000000000000';
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/buttondown': () =>
        json({
          code: 0,
          data: { url: 'https://buttondown.com/me/archive/hello', external_id: id, report: [] },
          message: 'ok',
        }),
      [`GET /v1/emails/${id}/analytics`]: () =>
        json({ recipients: 50, opens: 20, clicks: 4, page_views_lifetime: 70, comments: 1 }),
    });
    const { result } = await runPublish(buttondownAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: id, state: 'draft' });
    const ctx = {
      fetch,
      signal: new AbortController().signal,
      runtime: 'web' as const,
      credential: { api_key: 'k' },
    };
    expect(await buttondownAdapter.fetchStats!(id, ctx)).toMatchObject({
      views: 70,
      reads: 20,
      comments: 1,
      extra: { recipients: 50, clicks: 4 },
    });
    expect(calls[1]!.headers.get('authorization')).toBe('Token k');
    expect(calls[1]!.headers.get('x-api-version')).toBe('2026-04-01');
    expect(BUTTONDOWN_REQUESTS.update).toMatchObject({
      method: 'PATCH',
      url: 'https://api.buttondown.com/v1/emails/{id}',
    });
  });
});
