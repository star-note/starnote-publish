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
  renderZenn,
  ZENN_SLUG,
  zennAdapter,
  zennBinding,
  zennSlugOf,
  zennTopic,
} from '../src/index';

describe('renderZenn', () => {
  const doc = fixtureDoc();
  const r = renderZenn(
    doc,
    zennAdapter.schema.parse({}),
    { title: 'Hello Title', tags: ['TypeScript', 'C++', 'C#', 'Node.js', 'web dev', 'extra'] },
    { kind: 'article', doc, canonicalUrl: CANONICAL, shortId: '8Kq2xA7b' },
    { assetBase: ASSET_BASE }
  );

  it('writes articles/<slug>.md with Zenn front matter', () => {
    expect(r.slug).toBe('starnote-8_kq2x_a7b');
    expect(ZENN_SLUG.test(r.slug)).toBe(true);
    expect(r.path).toBe('articles/starnote-8_kq2x_a7b.md');
    expect(r.content.startsWith('---\ntitle: "Hello Title"\nemoji: "📝"\ntype: "tech"\n')).toBe(
      true
    );
    expect(r.content).toContain(
      'topics: ["typescript","cpp","csharp","nodejs","webdev"]\npublished: true\n---\n'
    );
    expect(r.content).toContain('$e^{i\\pi}+1=0$');
    expect(r.content).toContain('![A picture](https://starnote.app/assets/a.png)');
    expect(r.content).toContain(`*本文首发于[辰记](${CANONICAL})。*`);
    expect(r.body).toEqual({ article: { slug: r.slug, content: r.content, published: true } });
    expect(r.report.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['zenn.file', 'tags.trimmed'])
    );
  });

  it('drafts, schedules and keeps the slug of an earlier publish', () => {
    const d = renderZenn(
      doc,
      zennAdapter.schema.parse({
        published: false,
        type: 'idea',
        emoji: '🚀',
        published_at: '2026-11-01 09:00',
      }),
      { title: 'x'.repeat(80) },
      { kind: 'article', doc },
      { previousSlug: 'my-existing-slug' }
    );
    expect(d.slug).toBe('my-existing-slug');
    expect(d.content).toContain('type: "idea"');
    expect(d.content).toContain('published: false\npublished_at: "2026-11-01 09:00"');
    expect(d.title.length).toBeLessThanOrEqual(70);
    expect(d.report.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['draft.only', 'scheduled', 'title.truncated'])
    );
  });

  it('topics and slugs follow Zenn rules', () => {
    expect(zennTopic('Next.js 14')).toBe('nextjs14');
    expect(zennTopic('!!!')).toBeNull();
    expect(zennTopic('a'.repeat(30))!.length).toBe(18);
    const s = zennSlugOf(undefined, '标题');
    expect(ZENN_SLUG.test(s)).toBe(true);
    expect(zennSlugOf(undefined, '标题')).toBe(s);
    expect(zennAdapter.schema.safeParse({ emoji: 'abc' }).success).toBe(false);
  });
});

describe('zenn adapter', () => {
  it('binds with the Zenn user name and repository (token optional) and publishes through 辰记', async () => {
    expect(zennBinding.fields).toEqual(['zenn_username', 'repo', 'token']);
    expect(
      zennBinding.form!.safeParse({ zenn_username: 'me', repo: 'me/zenn-content' }).success
    ).toBe(true);
    expect(
      zennBinding.form!.safeParse({ zenn_username: 'me', repo: 'me/zenn', token: 'ghp_x' }).success
    ).toBe(false);
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/zenn': () =>
        json({
          code: 0,
          data: {
            url: 'https://zenn.dev/me/articles/my-existing-slug',
            external_id: 'my-existing-slug',
            report: [],
          },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      zennAdapter,
      { previous: { zenn: { platform: 'zenn', externalId: 'my-existing-slug' } } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: 'my-existing-slug', state: 'published' });
    expect(calls[0]!.body.body.article.slug).toBe('my-existing-slug');
    expect(calls[0]!.body.previous).toEqual({ external_id: 'my-existing-slug' });
    const preview = await zennAdapter.preview!(fixtureDoc(), zennAdapter.schema.parse({}), {
      title: 'T',
    });
    expect(preview.format).toBe('files');
    expect(preview.files![0]!.path).toMatch(/^articles\/starnote-[0-9a-f]{8}\.md$/);
    expect(
      zennAdapter.parsePostUrl!('https://zenn.dev/me/articles/my-existing-slug')!.externalId
    ).toBe('my-existing-slug');
  });
});
