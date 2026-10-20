import {
  convert,
  createPublisher,
  platformMeta,
  runtimeList,
  zodToAntdRules,
} from '@starnote/publish-core';
import { describe, expect, it, vi } from 'vitest';

import { chenjiAdapter, chenjiSchema, guessCategory } from '../src/index';

import type { PublishEvent } from '@starnote/publish-core';

const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '我的标题' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '章节' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '正文内容' }] },
  ],
});

function envelope(code: number, data: unknown, message = 'ok') {
  return new Response(JSON.stringify({ code, data, message }), {
    status: code === 0 ? 201 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chenji adapter', () => {
  it('declares runtime, capabilities and schema', () => {
    expect(chenjiAdapter.key).toBe('chenji');
    expect(chenjiAdapter.runtime).toEqual(['web', 'electron', 'server']);
    expect(chenjiAdapter.capabilities).toEqual({ supportsUpdate: true, titleMax: 120 });
    expect(chenjiSchema.parse({ category: { id: 'c1' } })).toEqual({
      category: { id: 'c1' },
      visibility: 'public',
      show_in_blog: true,
    });
    // A new category by name is created on publish; names are trimmed and capped at 40 chars.
    expect(chenjiSchema.parse({ category: { name: ' 周报 ' } }).category).toEqual({ name: '周报' });
    expect(chenjiSchema.safeParse({ category: { id: '' } }).success).toBe(false);
    expect(chenjiSchema.safeParse({ category: { name: 'x'.repeat(41) } }).success).toBe(false);
    expect(chenjiSchema.safeParse({}).success).toBe(false);
    expect(chenjiSchema.safeParse({ category: { id: 'c1' }, visibility: 'link' }).success).toBe(
      false
    );
    expect(zodToAntdRules(chenjiSchema).category).toEqual([
      { required: true, message: '请选择分类' },
    ]);
    expect(zodToAntdRules(chenjiSchema).visibility).toEqual([
      { type: 'enum', enum: ['public', 'password'], message: '请选择有效的选项' },
    ]);
  });

  it('prefills the category from tags or keywords', () => {
    const categories = [
      { id: 'c-tech', name: '技术' },
      { id: 'c-life', name: '生活随笔' },
    ];
    expect(guessCategory({ categories, tags: ['技术'] })).toBe('c-tech');
    expect(guessCategory({ categories, keywords: ['随笔'] })).toBe('c-life');
    expect(guessCategory({ categories, tags: ['旅行'] })).toBeUndefined();
    expect(chenjiAdapter.prefill?.(doc, { categories, tags: ['生活随笔'] })).toEqual({
      category: { id: 'c-life' },
    });
    expect(chenjiAdapter.prefill?.(doc, { categories: [] })).toEqual({});
  });

  it('posts the converted document and emits progress then done', async () => {
    const fetchMock = vi.fn(async () =>
      envelope(0, {
        id: 'pub-1',
        note_id: 'n1',
        url: 'https://starnote.test/@lu/my-title',
        slug: 'my-title',
        title: '我的标题',
        version: 1,
      })
    );
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [chenjiAdapter],
      runtime: 'web',
      fetch: fetchMock as unknown as typeof fetch,
      apiBase: '/api/v1',
      onEvent: (_platform, event) => events.push(event),
    });
    const result = await publisher.publish({
      noteId: 'n1',
      doc,
      platforms: ['chenji'],
      common: { summary: '自定义摘要' },
      perPlatform: { chenji: { category: { id: 'c-tech' }, visibility: 'password' } },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/notes/n1/publish/chenji');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      category: { id: 'c-tech' },
      visibility: 'password',
      show_in_blog: true,
      summary: '自定义摘要',
      html: doc.html,
      toc: [{ id: 'h-1-章节', level: 2, text: '章节' }],
      title: '我的标题',
    });

    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'progress', 'done']);
    expect(events[0]).toMatchObject({ type: 'progress', percent: 10, text: '转换正文' });
    expect(events[2]).toMatchObject({ type: 'progress', percent: 100 });
    expect(events[3]).toMatchObject({
      type: 'done',
      url: 'https://starnote.test/@lu/my-title',
      externalId: 'pub-1',
    });
    expect(result.results.chenji).toEqual({
      ok: true,
      url: 'https://starnote.test/@lu/my-title',
      externalId: 'pub-1',
    });
  });

  it('passes cover variants and alt text through, dropping unknown keys', async () => {
    const fetchMock = vi.fn(async () =>
      envelope(0, { id: 'p', url: 'u', note_id: 'n1', slug: 's', title: 't', version: 1 })
    );
    const publisher = createPublisher({
      adapters: [chenjiAdapter],
      runtime: 'web',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const h = (c: string) => c.repeat(64);
    await publisher.publish({
      noteId: 'n1',
      doc,
      platforms: ['chenji'],
      common: {
        cover: h('a'),
        coverVariants: { og: h('b'), square: h('c'), wide: '', banner: h('d') } as never,
        coverAlt: '海边的灯塔',
      },
      perPlatform: { chenji: { category: { id: 'c1' } } },
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.cover_asset_hash).toBe(h('a'));
    expect(body.cover_variants).toEqual({ og: h('b'), square: h('c') });
    expect(body.cover_alt).toBe('海边的灯塔');
  });

  it('falls back to the document summary and title', async () => {
    const fetchMock = vi.fn(async () =>
      envelope(0, { id: 'p', url: 'u', note_id: 'n1', slug: 's', title: 't', version: 1 })
    );
    const publisher = createPublisher({
      adapters: [chenjiAdapter],
      runtime: 'node',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await publisher.publish({
      noteId: 'n1',
      doc,
      platforms: ['chenji'],
      common: {},
      perPlatform: { chenji: { category: { name: '新栏目' } } },
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.summary).toBe(doc.summary);
    expect(body.title).toBe('我的标题');
    expect(body.category).toEqual({ name: '新栏目' });
  });

  it('turns a non-zero envelope into a failed event with retry', async () => {
    const fetchMock = vi.fn(async () => envelope(40901, null, 'slug 已存在，请换一个'));
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [chenjiAdapter],
      runtime: 'web',
      fetch: fetchMock as unknown as typeof fetch,
      onEvent: (_platform, event) => events.push(event),
    });
    const result = await publisher.publish({
      noteId: 'n1',
      doc,
      platforms: ['chenji'],
      common: {},
      perPlatform: { chenji: { category: { id: 'c' } } },
    });
    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'failed']);
    expect(events[2]).toMatchObject({
      type: 'failed',
      reason: 'slug 已存在，请换一个',
      code: '40901',
      actions: [{ id: 'retry', label: '重试', kind: 'retry' }],
    });
    expect(result.results.chenji).toEqual({ ok: false, error: 'slug 已存在，请换一个' });
  });

  it('fails validation before calling the API', async () => {
    const fetchMock = vi.fn();
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [chenjiAdapter],
      runtime: 'web',
      fetch: fetchMock as unknown as typeof fetch,
      onEvent: (_platform, event) => events.push(event),
    });
    const result = await publisher.publish({
      noteId: 'n1',
      doc,
      platforms: ['chenji'],
      common: {},
      perPlatform: { chenji: {} },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ type: 'failed', code: 'invalid_form' })]);
    expect(result.results.chenji?.error).toContain('请选择分类');
  });

  it('declares the SPEC-r8 fields without changing behaviour', async () => {
    expect(chenjiAdapter.runtimes).toEqual([
      { runtime: 'web', mode: 'api' },
      { runtime: 'electron', mode: 'api' },
      { runtime: 'server', mode: 'api', schedulable: true },
    ]);
    expect(runtimeList(chenjiAdapter)).toEqual(chenjiAdapter.runtime);
    expect(chenjiAdapter.contentTypes).toEqual(['article']);
    expect(chenjiAdapter.binding).toEqual({ kind: 'session', store: 'none' });
    expect(platformMeta('chenji')?.runtimes).toEqual(chenjiAdapter.runtimes);
    const publisher = createPublisher({ adapters: [chenjiAdapter], runtime: 'web' });
    expect(publisher.plan('chenji', { env: { accounts: {} } })[0]).toMatchObject({
      kind: 'run-here',
    });
    expect(await publisher.preview('chenji', { doc, form: { category: { id: 'c1' } } })).toEqual({
      format: 'html',
      title: '我的标题',
      body: doc.html,
      report: [],
    });
  });
});
