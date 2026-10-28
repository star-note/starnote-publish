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
  CONVERTKIT_REQUESTS,
  convertkitAdapter,
  convertkitBinding,
  renderConvertkit,
} from '../src/index';

describe('renderConvertkit', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };

  it('a draft broadcast by default: HTML content, send_at null, preview text, thumbnail', () => {
    const r = renderConvertkit(
      doc,
      convertkitAdapter.schema.parse({}),
      { title: 'Hello Title', summary: 'One line', cover: '/covers/c.png' },
      content,
      { assetBase: ASSET_BASE }
    );
    expect(r.html).toContain('<h2');
    expect(r.html).toContain(`本文首发于<a href="${CANONICAL}">辰记</a>`);
    expect(r.body.broadcast).toEqual({
      subject: 'Hello Title',
      content: r.html,
      description: 'One line',
      preview_text: 'One line',
      public: false,
      send_at: null,
      thumbnail_url: 'https://starnote.app/covers/c.png',
      thumbnail_alt: 'Hello Title',
    });
    expect(r.report.find((i) => i.kind === 'draft.only')).toBeDefined();
  });

  it('schedules with send_at; scheduling without a time is an error', () => {
    const at = '2026-11-01T09:00:00+08:00';
    const s = renderConvertkit(
      doc,
      convertkitAdapter.schema.parse({ send: 'schedule', send_at: at, public: true }),
      {},
      content
    );
    expect(s.body.broadcast).toMatchObject({ send_at: at, public: true });
    const bad = renderConvertkit(
      doc,
      convertkitAdapter.schema.parse({ send: 'schedule' }),
      {},
      content
    );
    expect(bad.body.broadcast.send_at).toBeNull();
    expect(bad.report.find((i) => i.kind === 'schedule.missing')?.level).toBe('error');
  });
});

describe('convertkit adapter', () => {
  it('publishes through 辰记 and reads broadcast stats', async () => {
    expect(convertkitBinding.createUrl).toBe(
      'https://app.kit.com/account_settings/developer_settings'
    );
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/convertkit': () =>
        json({
          code: 0,
          data: { url: 'https://app.kit.com/campaigns/7/draft', external_id: '7', report: [] },
          message: 'ok',
        }),
      'GET /v4/broadcasts/7/stats': () =>
        json({
          broadcast: {
            id: 7,
            stats: {
              recipients: 100,
              open_rate: 41.5,
              emails_opened: 41,
              click_rate: 3,
              total_clicks: 5,
            },
          },
        }),
    });
    const { result } = await runPublish(convertkitAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: '7', state: 'draft' });
    expect(calls[0]!.body.body.broadcast.send_at).toBeNull();
    const ctx = {
      fetch,
      signal: new AbortController().signal,
      runtime: 'web' as const,
      credential: { api_key: 'k' },
    };
    expect(await convertkitAdapter.fetchStats!('7', ctx)).toMatchObject({
      reads: 41,
      extra: { recipients: 100, open_rate: 41.5, click_rate: 3, total_clicks: 5 },
    });
    expect(calls[1]!.headers.get('x-kit-api-key')).toBe('k');
    expect(CONVERTKIT_REQUESTS.create.url).toBe('https://api.kit.com/v4/broadcasts');
  });
});
