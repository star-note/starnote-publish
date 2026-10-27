import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { linkedinAdapter, linkedinPostUrl, littleText, renderLinkedin } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => linkedinAdapter.schema.parse(v);

describe('renderLinkedin', () => {
  it('commentary in little text, an article card back to 辰记, the thumbnail to upload', () => {
    const r = renderLinkedin(
      doc,
      parse({ linkPlacement: 'body' }),
      { title: 'C# (tips)', summary: 'Sum', tags: ['dotnet'], cover: '/c.png' },
      article,
      { assetBase: ASSET_BASE }
    );
    expect(r.body.post.commentary).toBe('C\\# \\(tips\\)\n\nSum\n\n{hashtag|\\#|dotnet}');
    expect(r.body.post.content).toEqual({
      article: { source: CANONICAL, title: 'C# (tips)', description: 'Sum' },
    });
    expect(r.body.post).toMatchObject({ visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' });
    expect(r.body.thumb_url).toBe('https://starnote.app/c.png');
    expect(littleText('a_b*c')).toBe('a\\_b\\*c');
    expect(linkedinPostUrl('urn:li:share:1')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:1'
    );
  });

  it('without a link: text only, with the missing-link notice', () => {
    const r = renderLinkedin(doc, parse(), { title: 'T' }, { kind: 'article', doc });
    expect(r.body.post.content).toBeUndefined();
    expect(r.report.map((i) => i.kind)).toContain('canonical.missing');
  });
});

describe('linkedin adapter', () => {
  it('relays with the page-memory credential on the web; one at a time', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/linkedin': () =>
        json({
          code: 0,
          data: {
            url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
            external_id: 'urn:li:share:1',
          },
        }),
    });
    const { createLinkedinAdapter } = await import('../src/index');
    const a = createLinkedinAdapter({ credential: () => ({ access_token: 'tok' }) });
    const { result } = await runPublish(a, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: 'urn:li:share:1' });
    expect(calls[0]!.body.credential).toEqual({ access_token: 'tok' });
    expect(a.maxConcurrent).toBe(1);
    const h = a.renderHandoff!({ doc, form: parse(), common: {}, content: article });
    expect(h.handoff.openUrl.startsWith('https://www.linkedin.com/sharing/share-offsite/?')).toBe(
      true
    );
  });
});

describe('SPEC-r12 LinkedIn', () => {
  it('defaults to the link as the first comment: no article card, no thumbnail', () => {
    const r = renderLinkedin(doc, parse(), { title: 'T', cover: '/c.png' }, article, {
      assetBase: ASSET_BASE,
    });
    expect(r.body.post.content).toBeUndefined();
    expect(r.body.thumb_url).toBeUndefined();
    expect(r.followUp).toEqual({ kind: 'link_comment', text: `原文：${CANONICAL}` });
  });

  it('comments on the post URN through …/comment', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/linkedin/comment': () =>
        json({
          code: 0,
          data: { platform: 'linkedin', external_id: 'urn:li:comment:(urn:li:share:1,9)' },
        }),
      'POST /api/v1/notes/note-1/publish/linkedin': () =>
        json({
          code: 0,
          data: {
            url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
            external_id: 'urn:li:share:1',
          },
        }),
    });
    const { createLinkedinAdapter } = await import('../src/index');
    const { result } = await runPublish(
      createLinkedinAdapter(),
      {},
      { runtime: 'electron', fetch }
    );
    expect(result.followUp).toMatchObject({ state: 'succeeded' });
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe('comment:linkedin:urn:li:share:1');
    expect(calls[1]!.body.parent).toEqual({ external_id: 'urn:li:share:1' });
  });

  it('a failed comment leaves the post published', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/notes/note-1/publish/linkedin/comment': () =>
        json(
          {
            code: 40301,
            message: '没有评论权限',
            data: { error_code: 'forbidden', error_kind: 'disconnect' },
          },
          403
        ),
      'POST /api/v1/notes/note-1/publish/linkedin': () =>
        json({ code: 0, data: { url: 'u', external_id: 'urn:li:share:1' } }),
    });
    const { createLinkedinAdapter } = await import('../src/index');
    const { result, terminal } = await runPublish(
      createLinkedinAdapter(),
      {},
      { runtime: 'electron', fetch }
    );
    expect(result).toMatchObject({
      ok: true,
      followUp: { state: 'failed', error: { kind: 'disconnect', code: 'forbidden' } },
    });
    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.type).toBe('done');
  });

  it('parses feed / posts links to URNs', () => {
    expect(
      linkedinAdapter.parsePostUrl!('https://www.linkedin.com/feed/update/urn:li:share:7/')
        ?.externalId
    ).toBe('urn:li:share:7');
    expect(linkedinAdapter.parsePostUrl!('https://x.com/a/status/1')).toBeNull();
  });
});
