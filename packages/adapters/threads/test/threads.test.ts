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
  createThreadsAdapter,
  fetchThreadsStats,
  renderThreads,
  threadsAdapter,
} from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => threadsAdapter.schema.parse(v);
const PATH = '/api/v1/notes/note-1/publish/threads';

describe('renderThreads', () => {
  it('a text container with the link card; one topic', () => {
    const r = renderThreads(
      doc,
      parse(),
      { title: 'Hi', summary: 'Sum', tags: ['a', 'b'] },
      article
    );
    expect(r.body).toEqual({
      media_type: 'TEXT',
      text: 'Hi\n\nSum\n\n#a',
      link_attachment: CANONICAL,
    });
    expect(r.report.map((i) => i.kind)).toContain('tags.trimmed');
  });

  it('an image container puts the link in the text; 500 with emoji by bytes', () => {
    const r = renderThreads(
      doc,
      parse({ with_cover: true }),
      { title: '👍'.repeat(200), cover: '/c.png' },
      article,
      { assetBase: ASSET_BASE }
    );
    expect(r.body).toMatchObject({ media_type: 'IMAGE', image_url: 'https://starnote.app/c.png' });
    expect(r.text.endsWith(CANONICAL)).toBe(true);
    expect(r.report.map((i) => i.kind)).toContain('share.truncated');
  });
});

describe('threads adapter (three stages)', () => {
  it('container → check → finalize through the relay', async () => {
    let checks = 0;
    const { fetch, calls } = mockFetch({
      [`POST ${PATH}/check`]: () =>
        json({
          code: 0,
          data:
            ++checks < 2
              ? { status: 'pending', pending: { container_id: 'c1' } }
              : { status: 'ready', pending: { container_id: 'c1' } },
        }),
      [`POST ${PATH}/finalize`]: () =>
        json({
          code: 0,
          data: {
            status: 'completed',
            url: 'https://www.threads.net/@me/post/X',
            external_id: 'm1',
          },
        }),
      [`POST ${PATH}`]: () =>
        json({
          code: 0,
          data: { url: '', external_id: '', state: 'processing', pending: { container_id: 'c1' } },
        }),
    });
    const a = createThreadsAdapter({ poll: { intervalSec: 0 } });
    const { result, events } = await runPublish(a, {}, { runtime: 'electron', fetch });
    expect(result).toMatchObject({
      ok: true,
      url: 'https://www.threads.net/@me/post/X',
      externalId: 'm1',
    });
    expect(calls.map((c) => c.url.replace(/^.*\/threads/, ''))).toEqual([
      '',
      '/check',
      '/check',
      '/finalize',
    ]);
    expect(calls[3]!.headers.get('Idempotency-Key')).toBe('finalize:threads:c1');
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('a failed finalize is not retried and keeps its kind', async () => {
    const { fetch, calls } = mockFetch({
      [`POST ${PATH}/check`]: () =>
        json({ code: 0, data: { status: 'ready', pending: { container_id: 'c1' } } }),
      [`POST ${PATH}/finalize`]: () =>
        json(
          { code: 50201, message: 'boom', data: { error_code: 'upstream', error_kind: 'unknown' } },
          502
        ),
      [`POST ${PATH}`]: () =>
        json({
          code: 0,
          data: { url: '', external_id: '', state: 'processing', pending: { container_id: 'c1' } },
        }),
    });
    const a = createThreadsAdapter({ poll: { intervalSec: 0 } });
    const { result } = await runPublish(a, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: false, kind: 'unknown' });
    expect(calls.filter((c) => c.url.endsWith('/finalize'))).toHaveLength(1);
  });

  it('insights → stats', async () => {
    const { fetch, calls } = mockFetch({
      'GET /v1.0/m1/insights': () =>
        json({
          data: [
            { name: 'views', values: [{ value: 120 }] },
            { name: 'likes', total_value: { value: 7 } },
            { name: 'replies', total_value: { value: 2 } },
            { name: 'reposts', total_value: { value: 1 } },
            { name: 'quotes', total_value: { value: 1 } },
          ],
        }),
    });
    const s = await fetchThreadsStats('m1', {
      fetch,
      signal: new AbortController().signal,
      runtime: 'electron',
      credential: { access_token: 'tok' },
    });
    expect(s).toMatchObject({
      source: 'official-api',
      views: 120,
      likes: 7,
      comments: 2,
      shares: 2,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer tok');
    expect(threadsAdapter.statsRequires).toBe('token');
  });
});
