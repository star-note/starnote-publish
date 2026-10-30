/** SPEC-r13 §4b 通用模式：发布台打开作者入口页，由用户复制粘贴、自己点发布；我们不往页面里输入、不点按钮。 */
import { convert, createPublisher, platformMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockSession } from '../../../core/test/session-helpers';
import { createGenericDeskElectronAdapters } from '../src/electron';
import {
  CN_DESK_KEYS,
  TECH_DESK_KEYS,
  createGenericDeskAdapter,
  GENERIC_DESK_KEYS,
  genericDeskBinding,
  renderGeneric,
} from '../src/index';

import type { AccountRef, HandoffRequest } from '@starnote/publish-core';

const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '小标题' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '正文段落' }] },
    { type: 'image', attrs: { src: '/api/v1/assets/abc.png' } },
  ],
});

describe('通用模式 adapters', () => {
  it('covers 11 vertical, 10 big domestic, 4 tech and 11 overseas platforms (SPEC-r14 A2), all in the registry', () => {
    expect(GENERIC_DESK_KEYS).toHaveLength(36);
    expect(CN_DESK_KEYS).toHaveLength(10);
    expect(TECH_DESK_KEYS).toHaveLength(4);
    expect(createGenericDeskElectronAdapters().map((a) => a.key)).toEqual([...GENERIC_DESK_KEYS]);
    const regions = GENERIC_DESK_KEYS.map((key) => platformMeta(key)?.region);
    expect(regions.filter((r) => r === 'cn')).toHaveLength(25);
    expect(regions.filter((r) => r === 'global')).toHaveLength(11);
  });

  it('binds by logging in on the desktop and confirming, without a session check', () => {
    const b = genericDeskBinding('xueqiu');
    expect(b).toMatchObject({ kind: 'cookie', store: 'desktop' });
    expect(b.desktopSession!.success).toEqual({ manual: true });
    expect(b.instructions!.join('\n')).toContain('已登录');
  });

  it('fills the write page on the platforms whose selectors were checked', async () => {
    const filled = GENERIC_DESK_KEYS.filter((k) =>
      createGenericDeskAdapter(k).runtimes[0]!.note!.includes('自动填好')
    );
    expect(filled).toEqual([
      'xueqiu',
      'eastmoney',
      'sspai',
      'dongchedi',
      'douban',
      'toutiao',
      'bilibili',
      'weibo-article',
      'sohu',
      'qq-om',
      'douyin-article',
      'xiaohongshu-article',
      'tencent-cloud',
      '51cto',
    ]);
    const account: AccountRef = {
      id: 'x1',
      platform: 'xiaohongshu-article',
      externalUid: '',
      displayName: '我',
      store: 'desktop',
    };
    const { sessionFetch, calls } = mockSession({});
    const desk: HandoffRequest[] = [];
    const r = await createPublisher({
      adapters: [createGenericDeskAdapter('xiaohongshu-article')],
      runtime: 'electron',
      sessionFetch,
      handoff: async (req) => {
        desk.push(req);
        return { state: 'queued' };
      },
    }).publish({
      noteId: 'n',
      doc,
      platforms: ['xiaohongshu-article'],
      common: { title: '长'.repeat(70) },
      perPlatform: { 'xiaohongshu-article': {} },
      accounts: { 'xiaohongshu-article': account },
    });
    expect(calls).toHaveLength(0);
    expect(desk[0]).toMatchObject({
      editorUrl: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article',
    });
    // 标题按平台上限（64）截短
    expect([...desk[0]!.prefill!.title!]).toHaveLength(64);
    const items = Object.fromEntries(
      r.results['xiaohongshu-article']!.report!.map((i) => [i.kind, i.text])
    );
    expect(items['title.truncated']).toBe('标题超过 64 字，已截短');
    expect(items['fields.prefilled']).toBe('已在小红书长文的写作页里填好标题和正文');
    expect(items['declarations.user']).toContain('AI 声明');
    expect(items['platform.hint']).toContain('新的创作');
    expect(items['handoff.pending']).toContain('我已发布');
  });

  it('copies the body as Markdown for the tech communities', async () => {
    const account: AccountRef = {
      id: 's1',
      platform: 'segmentfault',
      externalUid: '',
      displayName: '我',
      store: 'desktop',
    };
    const { sessionFetch } = mockSession({});
    const desk: HandoffRequest[] = [];
    const adapter = createGenericDeskAdapter('segmentfault');
    expect(adapter.runtimes[0]!.note).toContain('通用模式');
    const r = await createPublisher({
      adapters: [adapter],
      runtime: 'electron',
      sessionFetch,
      handoff: async (req) => {
        desk.push(req);
        return { state: 'queued' };
      },
    }).publish({
      noteId: 'n',
      doc,
      platforms: ['segmentfault'],
      common: { title: '标题' },
      perPlatform: { segmentfault: {} },
      accounts: { segmentfault: account },
    });
    expect(desk[0]!.editorUrl).toBe('https://segmentfault.com/write');
    expect(desk[0]!.prefill).toEqual({ title: '标题', text: expect.stringContaining('## 小标题') });
    const kinds = r.results.segmentfault!.report!.map((i) => i.kind);
    expect(kinds).toContain('format.markdown');
    expect(kinds).not.toContain('fields.prefilled');
  });

  it('fills the Markdown editor on 51CTO', async () => {
    const account: AccountRef = {
      id: 'c1',
      platform: '51cto',
      externalUid: '',
      displayName: '我',
      store: 'desktop',
    };
    const { sessionFetch } = mockSession({});
    const desk: HandoffRequest[] = [];
    const r = await createPublisher({
      adapters: [createGenericDeskAdapter('51cto')],
      runtime: 'electron',
      sessionFetch,
      handoff: async (req) => {
        desk.push(req);
        return { state: 'queued' };
      },
    }).publish({
      noteId: 'n',
      doc,
      platforms: ['51cto'],
      common: { title: '标题' },
      perPlatform: { '51cto': {} },
      accounts: { '51cto': account },
    });
    expect(desk[0]!.prefill).toEqual({ title: '标题', text: expect.stringContaining('## 小标题') });
    const items = Object.fromEntries(r.results['51cto']!.report!.map((i) => [i.kind, i.text]));
    expect(items['format.markdown']).toBe('正文按 Markdown 填进了51CTO的 Markdown 编辑器');
    expect(items['fields.prefilled']).toBeDefined();
  });

  it('renders HTML for the rich editor with absolute image URLs, and plain text as the fallback', () => {
    const r = renderGeneric(doc, { title: '标题' }, 'https://starnote.app');
    expect(r.title).toBe('标题');
    expect(r.html).toContain('<h2');
    expect(r.html).toContain('https://starnote.app/api/v1/assets/abc.png');
    expect(r.text).toContain('正文段落');
  });

  it('hands the author entry page to the 发布台 with the title and body, and never calls the platform', async () => {
    const account: AccountRef = {
      id: 'a1',
      platform: 'huxiu',
      externalUid: '',
      displayName: '虎嗅',
      store: 'desktop',
    };
    const { sessionFetch, calls } = mockSession({});
    const desk: HandoffRequest[] = [];
    const r = await createPublisher({
      adapters: [createGenericDeskAdapter('huxiu', { assetBase: 'https://starnote.app' })],
      runtime: 'electron',
      sessionFetch,
      handoff: async (req) => {
        desk.push(req);
        return { state: 'queued' };
      },
    }).publish({
      noteId: 'n',
      doc,
      platforms: ['huxiu'],
      common: { title: '标题' },
      perPlatform: { huxiu: {} },
      accounts: { huxiu: account },
    });
    expect(calls).toHaveLength(0);
    expect(desk[0]).toMatchObject({
      platform: 'huxiu',
      editorUrl: 'https://www.huxiu.com/contribute/',
      label: '虎嗅',
    });
    expect(desk[0]!.prefill).toMatchObject({ title: '标题' });
    expect(desk[0]!.prefill!.html).toContain('<h2');
    const result = r.results.huxiu!;
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
    expect(result.report!.find((i) => i.kind === 'handoff.pending')!.text).toContain('我已发布');
  });
});
