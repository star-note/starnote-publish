import { convert } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { renderTumblr, toNpf, tumblrAdapter } from '../src/index';

import type { TiptapJSON } from '@starnote/publish-core';

const t = (text: string, marks?: TiptapJSON['marks']): TiptapJSON =>
  marks ? { type: 'text', text, marks } : { type: 'text', text };

describe('toNpf', () => {
  it('maps headings, formatting, quotes, nested lists, code, tables and images', () => {
    const { blocks, counts } = toNpf({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [t('Sub')] },
        {
          type: 'paragraph',
          content: [
            t('a '),
            t('bold', [{ type: 'bold' }]),
            t(' '),
            t('link', [{ type: 'link', attrs: { href: 'https://x.dev' } }, { type: 'italic' }]),
            { type: 'hardBreak' },
            t('second line'),
          ],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [t('quoted')] }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [t('one')] },
                {
                  type: 'orderedList',
                  content: [
                    { type: 'listItem', content: [{ type: 'paragraph', content: [t('one.a')] }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'codeBlock', content: [t('x = 1\ny = 2')] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [t('A')] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [t('B')] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [t('1')] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [t('2')] }] },
              ],
            },
          ],
        },
        { type: 'horizontalRule' },
        { type: 'imageBlock', attrs: { src: 'https://starnote.app/assets/a.png', caption: 'Cap' } },
        { type: 'image', attrs: { src: 'data:image/png;base64,xx' } },
      ],
    });
    expect(blocks).toEqual([
      { type: 'text', text: 'Sub', subtype: 'heading2' },
      {
        type: 'text',
        text: 'a bold link',
        formatting: [
          { start: 2, end: 6, type: 'bold' },
          { start: 7, end: 11, type: 'italic' },
          { start: 7, end: 11, type: 'link', url: 'https://x.dev' },
        ],
      },
      { type: 'text', text: 'second line' },
      { type: 'text', text: 'quoted', subtype: 'indented' },
      { type: 'text', text: 'one', subtype: 'unordered-list-item' },
      { type: 'text', text: 'one.a', subtype: 'ordered-list-item', indent_level: 1 },
      { type: 'text', text: 'x = 1', subtype: 'chat' },
      { type: 'text', text: 'y = 2', subtype: 'chat' },
      { type: 'text', text: 'A | B', formatting: [{ start: 0, end: 5, type: 'bold' }] },
      { type: 'text', text: '1 | 2' },
      { type: 'image', media: [{ url: 'https://starnote.app/assets/a.png' }], caption: 'Cap' },
    ]);
    expect(counts).toMatchObject({ divider: 1, table: 1, code: 1, image: 1, imageSkipped: 1 });
  });
});

describe('renderTumblr', () => {
  const doc = fixtureDoc();
  it('title, cover, body, link back to 辰记, tags and source_url', () => {
    const r = renderTumblr(
      doc,
      tumblrAdapter.schema.parse({ blog: 'myblog' }),
      { title: 'Hello Title', tags: ['#TypeScript', 'web, dev'], cover: '/covers/c.png' },
      { kind: 'article', doc, canonicalUrl: CANONICAL },
      { assetBase: ASSET_BASE }
    );
    const c = r.body.post.content;
    expect(c[0]).toEqual({ type: 'text', text: 'Hello Title', subtype: 'heading1' });
    expect(c[1]).toEqual({ type: 'image', media: [{ url: 'https://starnote.app/covers/c.png' }] });
    expect(c.at(-1)).toEqual({ type: 'link', url: CANONICAL, title: 'Hello Title' });
    expect(c.filter((b) => b.type === 'text' && b.text === 'Hello Title')).toHaveLength(1); // h1 dropped from body
    expect(r.body).toMatchObject({
      blog: 'myblog',
      post: { state: 'published', tags: 'TypeScript,web dev', source_url: CANONICAL },
    });
    const kinds = r.report.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'table.flattened',
        'code.monospace',
        'canonical.source',
        'image.rehosted',
      ])
    );
    expect(r.previewHtml).toContain('<h1>Hello Title</h1>');
  });

  it('short texts and queue state', () => {
    const r = renderTumblr(
      convert({ type: 'doc', content: [] }),
      tumblrAdapter.schema.parse({ state: 'queue' }),
      {},
      { kind: 'short-text', text: 'Hi there\n\nSecond', link: 'https://starnote.app/@me/x' }
    );
    expect(r.body.post.content).toEqual([
      { type: 'text', text: 'Hi there' },
      { type: 'text', text: 'Second' },
      { type: 'link', url: 'https://starnote.app/@me/x', title: 'https://starnote.app/@me/x' },
    ]);
    expect(r.report.map((i) => i.kind)).toContain('draft.only');
  });
});

describe('tumblr adapter', () => {
  it('relays the NPF post', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/tumblr': () =>
        json({
          code: 0,
          data: { url: 'https://www.tumblr.com/myblog/123', external_id: '123' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      tumblrAdapter,
      { form: { blog: 'myblog' } },
      { runtime: 'electron', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: '123' });
    expect(calls[0]!.body.body.post.content[0].subtype).toBe('heading1');
    expect(tumblrAdapter.binding).toMatchObject({
      kind: 'oauth',
      scopes: ['basic', 'write', 'offline_access'],
    });
  });
});
