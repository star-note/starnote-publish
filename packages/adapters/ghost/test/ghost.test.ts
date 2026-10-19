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
  createGhostAdapter,
  GHOST_REQUESTS,
  ghostAdapter,
  ghostAdminUrl,
  renderGhost,
} from '../src/index';

describe('renderGhost', () => {
  const doc = fixtureDoc();
  const r = renderGhost(
    doc,
    ghostAdapter.schema.parse({}),
    { title: 'Hello Title', summary: 'Sum', tags: ['TS', 'Web'], cover: '/covers/c.png' },
    { kind: 'article', doc, canonicalUrl: CANONICAL },
    { assetBase: ASSET_BASE }
  );
  it('emits classless HTML with blockquote callouts, plain headings and hr', () => {
    expect(r.html).not.toContain('class="sn-');
    expect(r.html).not.toContain('<h1');
    expect(r.html).toContain('<h2 id="h-0-pill-heading">Pill heading</h2>');
    expect(r.html).toContain(
      '<blockquote>\n<p><strong>提示</strong></p>\n<p>Card body</p>\n</blockquote>'
    );
    expect(r.html).toContain('<hr>');
    expect(r.html).toContain('<pre><code class="language-ts">');
    expect(r.html).toContain('<td colspan="2">');
    expect(r.html).toContain('src="https://starnote.app/assets/a.png"');
    expect(r.html).toContain('$e^{i\\pi}+1=0$');
    expect(r.html).toContain('<a href="https://www.youtube.com/embed/dQw4w9WgXcQ">');
  });
  it('builds the post body', () => {
    expect(r.post).toMatchObject({
      title: 'Hello Title',
      status: 'published',
      visibility: 'public',
      tags: ['TS', 'Web'],
      custom_excerpt: 'Sum',
      feature_image: 'https://starnote.app/covers/c.png',
      canonical_url: CANONICAL,
    });
    const kinds = r.report.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'block.degraded.callout',
        'table.html',
        'table.kept',
        'math.as-source',
        'image.rehosted',
        'canonical.set',
      ])
    );
  });
});

describe('ghost adapter (relay)', () => {
  it('posts the post plus the images / cover for the server to upload', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/ghost': () =>
        json({
          code: 0,
          data: {
            url: 'https://blog.example.com/hello/',
            external_id: 'g1',
            state: 'published',
            report: [{ kind: 'image.rehosted', text: '1 张图片已上传到 Ghost', count: 1 }],
          },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      createGhostAdapter({ assetBase: ASSET_BASE }),
      { common: { title: 'Hello Title', cover: '/covers/c.png' } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: 'g1' });
    const sent = calls[0]!.body.body;
    expect(sent.images).toEqual(['https://starnote.app/assets/a.png']);
    expect(sent.cover).toBe('https://starnote.app/covers/c.png');
    expect(sent.post.canonical_url).toBe(CANONICAL);
    // the server's report replaces the predicted one
    expect(result.report?.find((i) => i.kind === 'image.rehosted')?.text).toBe(
      '1 张图片已上传到 Ghost'
    );
  });

  it('builds admin URLs under a subdirectory (what the server calls)', () => {
    expect(ghostAdminUrl('blog.example.com/sub/', 'posts/')).toBe(
      'https://blog.example.com/sub/ghost/api/admin/posts/'
    );
    expect(GHOST_REQUESTS.create.url).toBe('{site}/ghost/api/admin/posts/?source=html');
  });
});
