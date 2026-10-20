import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { HASHNODE_QUERIES, hashnodeAdapter, hashnodeTagSlug, renderHashnode } from '../src/index';

describe('renderHashnode', () => {
  const doc = fixtureDoc();
  const r = renderHashnode(
    doc,
    hashnodeAdapter.schema.parse({ subtitle: 'Sub', enable_toc: true }),
    { title: 'Hello Title', tags: ['TypeScript', 'Web Dev', '中文'], cover: 'https://cdn.x/c.png' },
    { kind: 'article', doc, canonicalUrl: CANONICAL },
    { assetBase: ASSET_BASE }
  );

  it('keeps $…$ math, turns video into links, degrades blocks', () => {
    expect(r.markdown).toContain('$e^{i\\pi}+1=0$');
    expect(r.markdown).toContain('[https://www.youtube.com/embed/dQw4w9WgXcQ]');
    expect(r.markdown).toContain('> **提示**');
    expect(r.markdown).toContain('![A picture](https://starnote.app/assets/a.png)');
    expect(r.markdown).not.toContain('# Hello Title');
  });

  it('builds the input with tag objects and originalArticleURL', () => {
    expect(r.input).toEqual({
      title: 'Hello Title',
      subtitle: 'Sub',
      contentMarkdown: r.markdown,
      tags: [
        { slug: 'typescript', name: 'TypeScript' },
        { slug: 'web-dev', name: 'Web Dev' },
      ],
      originalArticleURL: CANONICAL,
      coverImage: 'https://cdn.x/c.png',
      enableToc: true,
    });
    expect(hashnodeTagSlug('C++ / Rust')).toBe('c-rust');
    const kinds = r.report.map((i) => i.kind);
    expect(kinds).toContain('tags.trimmed'); // 中文 has no ASCII slug
    expect(kinds).toContain('canonical.set');
    expect(kinds).toContain('math.as-source');
  });
});

describe('hashnode adapter (relay)', () => {
  const PUB = 'a'.repeat(24);
  it('posts mode + input to 辰记 and keeps the update id', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/hashnode': () =>
        json({
          code: 0,
          data: { url: 'https://a.hashnode.dev/s', external_id: 'p1' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      hashnodeAdapter,
      {
        form: { mode: 'draft', publication_id: PUB },
        previous: { hashnode: { platform: 'hashnode', externalId: 'p0' } },
      },
      { runtime: 'web', fetch }
    );
    // an update of a published post stays published even with mode draft
    expect(result).toMatchObject({ ok: true, externalId: 'p1', state: 'published' });
    expect(calls[0]!.body.body).toMatchObject({ mode: 'draft', input: { publicationId: PUB } });
    expect(calls[0]!.body.previous).toEqual({ external_id: 'p0' });
    expect(HASHNODE_QUERIES.publish).toContain('publishPost(input: $input)');
  });

  it('maps pro_required to help and refuses bodies over 100 KB before sending', async () => {
    const pro = mockFetch({
      'POST /api/v1/notes/note-1/publish/hashnode': () =>
        json(
          {
            code: 40001,
            data: { error_code: 'pro_required' },
            message: 'Hashnode 要求这个博客开通 Pro',
          },
          400
        ),
    });
    const a = await runPublish(hashnodeAdapter, {}, { runtime: 'web', fetch: pro.fetch });
    expect(a.terminal[0]).toMatchObject({ type: 'failed', code: 'pro_required' });
    expect((a.terminal[0] as any).actions.map((x: any) => x.kind)).toEqual(['help']);

    const { fetch, calls } = mockFetch({});
    const big = 'x'.repeat(110 * 1024);
    const doc = {
      ...fixtureDoc(),
      json: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: big }] }],
      },
    };
    const b = await runPublish(
      hashnodeAdapter,
      { doc, content: { kind: 'article', doc } },
      { runtime: 'web', fetch }
    );
    expect(b.terminal[0]).toMatchObject({ code: 'too_large' });
    expect(calls).toHaveLength(0);
  });
});
