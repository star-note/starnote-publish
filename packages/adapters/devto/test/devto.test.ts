import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { DEVTO_REQUESTS, devtoAdapter, devtoTag, renderDevto } from '../src/index';

describe('renderDevto', () => {
  const doc = fixtureDoc();
  const r = renderDevto(
    doc,
    devtoAdapter.schema.parse({}),
    {
      title: 'Hello Title',
      summary: 'One line',
      tags: ['TypeScript', 'web dev', 'Node.js', 'AI', 'extra', '中文'],
      cover: '/covers/c.png',
    },
    { kind: 'article', doc, canonicalUrl: CANONICAL },
    { assetBase: ASSET_BASE }
  );

  it('degrades custom blocks to DEV Markdown', () => {
    const md = r.markdown;
    expect(md).not.toContain('# Hello Title'); // title is a field, not repeated in the body
    expect(md).toContain('## Pill heading');
    expect(md).toContain('> **提示**\n>\n> Card body');
    expect(md).toContain('> **Heads up**\n>\n> Careful now');
    expect(md).toContain('---');
    expect(md).toContain('```ts\nconst a = 1;\n```');
    expect(md).toContain('| A | B |');
    expect(md).toContain('<td colspan="2">'); // merged cells stay HTML
    expect(md).toContain('![A picture](https://starnote.app/assets/a.png)');
    expect(md).toContain('{% katex inline %}e^{i\\pi}+1=0{% endkatex %}');
    expect(md).toContain('{% youtube dQw4w9WgXcQ %}');
    expect(md).toContain('[https://player.bilibili.com/player.html?bvid=BV1]');
    expect(md).toContain('### Deep heading'); // h4 → ###
    expect(md).toContain('[the docs](https://example.com/docs)');
    expect(md).not.toContain('==this=='); // DEV has no highlight mark
  });

  it('builds the request body: 4 normalized tags, canonical, cover, description', () => {
    expect(r.body.article).toEqual({
      title: 'Hello Title',
      body_markdown: r.markdown,
      published: true,
      tags: 'typescript,webdev,nodejs,ai',
      canonical_url: CANONICAL,
      description: 'One line',
      main_image: 'https://starnote.app/covers/c.png',
    });
    expect(devtoTag('Web Dev!')).toBe('webdev');
    expect(devtoTag('中文')).toBeNull();
  });

  it('predicts the report', () => {
    const kinds = Object.fromEntries(r.report.map((i) => [i.kind, i.text]));
    expect(kinds['block.degraded.callout']).toBe('提示框降级为引用块 2 处');
    expect(kinds['block.degraded.heading']).toContain('1 处');
    expect(kinds['block.degraded.divider']).toContain('1 处');
    expect(kinds['tags.trimmed']).toContain('最多 4 个标签，已截断为 4 个');
    expect(kinds['canonical.set']).toBe('设置 canonical 指回辰记原文');
    expect(kinds['math.liquid']).toContain('1 处');
    expect(kinds['video.embedded']).toContain('1 处');
    expect(kinds['video.linkified']).toContain('1 处');
    expect(kinds['table.html']).toContain('1 个');
  });

  it('can turn canonical off and add an origin note', () => {
    const off = renderDevto(
      doc,
      devtoAdapter.schema.parse({ set_canonical: false }),
      {},
      { kind: 'article', doc, canonicalUrl: CANONICAL }
    );
    expect(off.body.article.canonical_url).toBeUndefined();
    const note = renderDevto(
      doc,
      devtoAdapter.schema.parse({ origin_note: true }),
      {},
      { kind: 'article', doc, canonicalUrl: CANONICAL }
    );
    expect(note.markdown).toContain(`*Originally published at [${CANONICAL}](${CANONICAL}).*`);
  });
});

describe('devto adapters', () => {
  it('the browser adapter renders here and publishes through 辰记 (relay)', async () => {
    expect(devtoAdapter.runtime).toEqual(['web', 'electron']);
    expect(devtoAdapter.binding?.kind).toBe('token');
    const preview = await devtoAdapter.preview!(fixtureDoc(), devtoAdapter.schema.parse({}), {
      title: 'T',
    });
    expect(preview.format).toBe('markdown');

    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/devto': () =>
        json({
          code: 0,
          data: {
            url: 'https://dev.to/me/x',
            external_id: '42',
            report: [{ kind: 'relay.ok', text: 'ok' }],
          },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      devtoAdapter,
      { previous: { devto: { platform: 'devto', externalId: '42', url: 'https://dev.to/me/x' } } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({
      ok: true,
      url: 'https://dev.to/me/x',
      externalId: '42',
      state: 'published',
    });
    expect(result.report?.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['canonical.set', 'relay.ok'])
    );
    const sent = calls[0]!.body;
    expect(sent.previous).toEqual({ external_id: '42', url: 'https://dev.to/me/x' });
    expect(sent.body.article).toMatchObject({ title: 'Hello Title', canonical_url: CANONICAL });
  });

  it('maps relay errors: relogin, rate_limited with retry_after, help', async () => {
    const run = (status: number, data: unknown, message = '失败') =>
      runPublish(
        devtoAdapter,
        {},
        {
          runtime: 'web',
          fetch: mockFetch({
            'POST /api/v1/notes/note-1/publish/devto': () =>
              json({ code: 40001, data, message }, status),
          }).fetch,
        }
      );
    const a = await run(400, { error_code: 'relogin', status: 401 }, 'DEV 的 API key 已失效');
    expect(a.terminal[0]).toMatchObject({
      type: 'failed',
      code: 'relogin',
      reason: 'DEV 的 API key 已失效',
    });
    expect((a.terminal[0] as any).actions.map((x: any) => x.kind)).toEqual(['relogin', 'help']);
    const b = await run(429, { error_code: 'rate_limited', retry_after: 30 });
    expect(b.terminal[0]).toMatchObject({ code: 'rate_limited', retryAfterSec: 30 });
    expect(b.result.retryAfterSec).toBe(30);
    const c = await run(
      400,
      { error_code: 'invalid', status: 422 },
      'Canonical url has already been taken'
    );
    expect((c.terminal[0] as any).actions.map((x: any) => x.kind)).toEqual(['help']);
  });

  it('has no Node entry: the request descriptions say what the server sends', () => {
    expect(DEVTO_REQUESTS.create).toMatchObject({
      method: 'POST',
      url: 'https://dev.to/api/articles',
    });
    expect(DEVTO_REQUESTS.update.url).toBe('https://dev.to/api/articles/{id}');
  });
});
