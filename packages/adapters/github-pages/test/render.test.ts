import { convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  defaultPostId,
  frontMatter,
  githubPagesSchema,
  postUrl,
  renderPost,
  resolveLayout,
  rewriteImageSources,
  siteBaseUrl,
} from '../src/index';

const zh = convert({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '我的 AI 写作工作流' }],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '准备' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '正文：有 "引号" 和 # 号' }] },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/a.png?x=1&y=2' } },
  ],
});
const en = convert({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'My AI writing workflow' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
  ],
});
const form = githubPagesSchema.parse({ repo: 'ludejun/ludejun.github.io', post_id: '8kq2xa' });
const now = new Date('2026-10-19T08:00:00Z');

describe('schema', () => {
  it('defaults branch, directory, language and canonical', () => {
    expect(form).toEqual({
      repo: 'ludejun/ludejun.github.io',
      branch: 'main',
      dir: 'content/posts',
      lang: 'zh-CN',
      post_id: '8kq2xa',
      canonical: 'self',
    });
    expect(githubPagesSchema.safeParse({ repo: 'nope' }).success).toBe(false);
    expect(githubPagesSchema.safeParse({ repo: 'a/b', dir: '/abs' }).success).toBe(false);
    expect(githubPagesSchema.safeParse({ repo: 'a/b', dir: 'x/../y' }).success).toBe(false);
    expect(zodFieldMeta(githubPagesSchema).map((f) => f.name)).toEqual([
      'repo',
      'branch',
      'dir',
      'lang',
      'post_id',
      'site_url',
      'canonical',
    ]);
  });
});

describe('URLs', () => {
  it('derives the site from the repository and prefixes non-default languages', () => {
    const layout = resolveLayout();
    expect(siteBaseUrl('Ludejun/ludejun.github.io')).toBe('https://ludejun.github.io');
    expect(siteBaseUrl('ludejun/blog')).toBe('https://ludejun.github.io/blog');
    expect(siteBaseUrl('ludejun/blog', 'https://blog.example.com/')).toBe(
      'https://blog.example.com'
    );
    expect(postUrl(layout, 'https://s', 'id1', 'zh-CN')).toBe('https://s/id1/');
    expect(postUrl(layout, 'https://s', 'id1', 'en')).toBe('https://s/en/id1/');
    expect(postUrl(resolveLayout({ defaultLanguage: 'en' }), 'https://s', 'id1', 'zh-CN')).toBe(
      'https://s/zh/id1/'
    );
    expect(defaultPostId('2F1C-ab90-xyz')).toBe('2f1cab90');
  });
});

describe('renderPost', () => {
  it('writes front matter + marker + HTML per language under one post directory', () => {
    const post = renderPost({
      doc: zh,
      form,
      common: { title: '覆盖的标题', tags: ['AI', '写作'] },
      noteId: 'note-1',
      translations: { en },
      canonicalUrl: 'https://starnote.app/@ludejun/8Kq2xA7b',
      starnoteId: '8Kq2xA7b',
      category: { slug: 'tech', name: '技术' },
      publishedAt: '2026-10-18T02:00:00.000Z',
      now,
    });
    expect(post.dir).toBe('content/posts/8kq2xa');
    expect(post.files.map((f) => f.path)).toEqual([
      'content/posts/8kq2xa/index.zh-CN.html',
      'content/posts/8kq2xa/index.en.html',
    ]);
    expect(post.urls).toEqual({
      'zh-CN': 'https://ludejun.github.io/8kq2xa/',
      en: 'https://ludejun.github.io/en/8kq2xa/',
    });
    expect(post.url).toBe('https://ludejun.github.io/8kq2xa/');

    const main = post.files[0]!.content;
    // the template contract (SPEC-r8-github-template §2.2); the API's render_post writes the same bytes
    const head = main.slice(0, main.indexOf('---\n<!--sn:article 1-->'));
    expect(head.split('\n').map((l) => l.split(':')[0])).toEqual([
      '---',
      'title',
      'summary',
      'lang',
      'published_at',
      'updated_at',
      'category',
      'tags',
      'canonical',
      'starnote_url',
      'starnote_id',
      'note_id',
      'translations',
      'toc',
      'generator',
      '',
    ]);
    expect(main).not.toMatch(/^(id|slug):/m);
    expect(main).toContain('title: "覆盖的标题"\n');
    expect(main).toContain('lang: "zh-CN"\n');
    expect(main).toContain('category: {"slug":"tech","name":"技术"}\n');
    expect(main).toContain('translations: {"en":"index.en.html"}\n');
    expect(main).toContain('tags: ["AI","写作"]\n');
    expect(main).toContain(
      'published_at: "2026-10-18T02:00:00.000Z"\nupdated_at: "2026-10-19T08:00:00.000Z"\n'
    );
    expect(main).toContain('canonical: "https://ludejun.github.io/8kq2xa/"\n');
    expect(main).toContain('starnote_url: "https://starnote.app/@ludejun/8Kq2xA7b"\n');
    expect(main).toContain('starnote_id: "8Kq2xA7b"\nnote_id: "note-1"\n');
    expect(main).toContain('generator: "starnote-publish/github-pages"\n');
    expect(main).toContain('---\n<!--sn:article 1-->\n');
    expect(main).toContain(zh.html);

    const second = post.files[1]!.content;
    expect(second).toContain('title: "My AI writing workflow"\n');
    expect(second).toContain('translations: {"zh-CN":"index.zh-CN.html"}\n');
    expect(second).toContain('canonical: "https://ludejun.github.io/en/8kq2xa/"\n');
    expect(post.report).toEqual([{ kind: 'translated', text: '同时发布了 en 版', count: 1 }]);
  });

  it('points canonical at 辰记 when asked, and honours a custom layout', () => {
    const post = renderPost({
      doc: zh,
      form: { ...form, canonical: 'chenji', dir: 'posts', site_url: 'https://blog.example.com' },
      noteId: 'n',
      canonicalUrl: 'https://starnote.app/@ludejun/8kq2xa',
      layout: { postFile: '{lang}.html', marker: '<!--x-->' },
      now,
    });
    expect(post.files[0]!.path).toBe('posts/8kq2xa/zh-CN.html');
    expect(post.files[0]!.content).toContain('canonical: "https://starnote.app/@ludejun/8kq2xa"');
    expect(post.url).toBe('https://blog.example.com/8kq2xa/');
    // without a 辰记 post there is no starnote_url / starnote_id / category, and the date is `now`
    const bare = renderPost({ doc: zh, form, noteId: 'n', now }).files[0]!.content;
    expect(bare).not.toMatch(/^(starnote_url|starnote_id|category):/m);
    expect(bare).toContain('published_at: "2026-10-19T08:00:00.000Z"');
    expect(post.files[0]!.content).toContain('---\n<!--x-->\n');
    expect(post.report).toEqual([{ kind: 'canonical.set', text: '规范链接指向辰记原文' }]);
  });

  it('rewrites rehosted image sources, raw or HTML-escaped', () => {
    const src = 'https://cdn.starnote.app/a.png?x=1&y=2';
    const html = `<img src="${src}"><img src="https://cdn.starnote.app/a.png?x=1&amp;y=2">`;
    expect(rewriteImageSources(html, new Map([[src, 'assets/abc.png']]))).toBe(
      '<img src="assets/abc.png"><img src="assets/abc.png">'
    );
  });

  it('drops empty front matter values', () => {
    expect(frontMatter({ a: 'x', b: undefined, c: '', d: null, e: [1] })).toBe(
      '---\na: "x"\ne: [1]\n---\n'
    );
  });
});
