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
  renderTelegraph,
  TELEGRAPH_TAGS,
  telegraphAdapter,
  telegraphBinding,
  telegraphContentBytes,
} from '../src/index';

import type { TelegraphNode } from '../src/index';

function tags(nodes: TelegraphNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes)
    if (typeof n !== 'string') {
      out.add(n.tag);
      for (const k of Object.keys(n.attrs ?? {})) out.add(`@${k}`);
      tags(n.children ?? [], out);
    }
  return out;
}

describe('renderTelegraph', () => {
  const doc = fixtureDoc();
  const r = renderTelegraph(
    doc,
    telegraphAdapter.schema.parse({ author_name: 'Me' }),
    { title: 'Hello Title' },
    { kind: 'article', doc, canonicalUrl: CANONICAL },
    { assetBase: ASSET_BASE }
  );

  it('uses only the tags and attributes Telegraph accepts', () => {
    const used = tags(r.nodes);
    for (const t of used)
      if (!t.startsWith('@')) expect(TELEGRAPH_TAGS as readonly string[]).toContain(t);
    for (const a of [...used].filter((t) => t.startsWith('@')))
      expect(['@href', '@src']).toContain(a);
  });

  it('maps headings to h3 / h4, quotes, code, images, tables and links', () => {
    expect(r.nodes).toContainEqual({ tag: 'h3', children: ['Pill heading'] });
    expect(r.nodes).toContainEqual({ tag: 'h4', children: ['Deep heading'] });
    expect(r.nodes).toContainEqual({ tag: 'pre', children: ['const a = 1;'] });
    expect(r.nodes).toContainEqual({
      tag: 'figure',
      children: [
        { tag: 'img', attrs: { src: 'https://starnote.app/assets/a.png' } },
        { tag: 'figcaption', children: ['A picture'] },
      ],
    });
    expect(r.nodes).toContainEqual({ tag: 'p', children: ['A', ' | ', 'B'] });
    expect(JSON.stringify(r.nodes)).toContain(
      '{"tag":"a","attrs":{"href":"https://example.com/docs"},"children":["the docs"]}'
    );
    expect(r.nodes.at(-2)).toEqual({ tag: 'hr' });
    expect(JSON.stringify(r.nodes.at(-1))).toContain(CANONICAL);
    expect(r.body.page).toEqual({ title: 'Hello Title', content: r.nodes, author_name: 'Me' });
    expect(r.report.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['table.flattened', 'origin.note'])
    );
  });

  it('flags a body over 64 KB', () => {
    const big = fixtureDoc();
    const huge = renderTelegraph(
      big,
      telegraphAdapter.schema.parse({}),
      { title: 'x' },
      {
        kind: 'article',
        doc: {
          ...big,
          json: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '字'.repeat(30000) }] }],
          },
        },
      }
    );
    expect(telegraphContentBytes(huge.nodes)).toBeGreaterThan(64 * 1024);
    expect(huge.report.find((i) => i.kind === 'body.too_large')?.level).toBe('error');
  });
});

describe('telegraph adapter', () => {
  it('binds with nothing but an optional author name and publishes through 辰记', async () => {
    expect(telegraphBinding.fields).toEqual(['author_name']);
    expect(telegraphBinding.form!.safeParse({}).success).toBe(true);
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/telegraph': () =>
        json({
          code: 0,
          data: {
            url: 'https://telegra.ph/Hello-Title-10-28',
            external_id: 'Hello-Title-10-28',
            report: [],
          },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(telegraphAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, externalId: 'Hello-Title-10-28', state: 'published' });
    expect(calls[0]!.body.body.page.title).toBe('Hello Title');
  });

  it('reads views without a token; pasted links keep non-ASCII paths encoded', async () => {
    const { fetch } = mockFetch({
      'GET /getViews/Hello-Title-10-28': () => json({ ok: true, result: { views: 12 } }),
    });
    const ctx = { fetch, signal: new AbortController().signal, runtime: 'web' as const };
    expect(await telegraphAdapter.fetchStats!('Hello-Title-10-28', ctx)).toMatchObject({
      views: 12,
    });
    expect(telegraphAdapter.parsePostUrl!('https://telegra.ph/Привет-10-28')!.externalId).toBe(
      '%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82-10-28'
    );
  });
});
