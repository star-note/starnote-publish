/** SPEC-r13 §4b 通用模式：发布台打开作者入口页，由用户复制粘贴、自己点发布；我们不往页面里输入、不点按钮。 */
import { convert, createPublisher, platformMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockSession } from '../../../core/test/session-helpers';
import { createGenericDeskElectronAdapters } from '../src/electron';
import {
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
  it('covers the eleven domestic vertical platforms, all in the registry', () => {
    expect(GENERIC_DESK_KEYS).toHaveLength(11);
    expect(createGenericDeskElectronAdapters().map((a) => a.key)).toEqual([...GENERIC_DESK_KEYS]);
    for (const key of GENERIC_DESK_KEYS) expect(platformMeta(key)?.region, key).toBe('cn');
  });

  it('binds by logging in on the desktop and confirming, without a session check', () => {
    const b = genericDeskBinding('xueqiu');
    expect(b).toMatchObject({ kind: 'cookie', store: 'desktop' });
    expect(b.desktopSession!.success).toEqual({ manual: true });
    expect(b.instructions!.join('\n')).toContain('已登录');
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
      platform: 'sspai',
      externalUid: '',
      displayName: '少数派',
      store: 'desktop',
    };
    const { sessionFetch, calls } = mockSession({});
    const desk: HandoffRequest[] = [];
    const r = await createPublisher({
      adapters: [createGenericDeskAdapter('sspai', { assetBase: 'https://starnote.app' })],
      runtime: 'electron',
      sessionFetch,
      handoff: async (req) => {
        desk.push(req);
        return { state: 'queued' };
      },
    }).publish({
      noteId: 'n',
      doc,
      platforms: ['sspai'],
      common: { title: '标题' },
      perPlatform: { sspai: {} },
      accounts: { sspai: account },
    });
    expect(calls).toHaveLength(0);
    expect(desk[0]).toMatchObject({
      platform: 'sspai',
      editorUrl: 'https://sspai.com/',
      label: '少数派',
    });
    expect(desk[0]!.prefill).toMatchObject({ title: '标题' });
    expect(desk[0]!.prefill!.html).toContain('<h2');
    const result = r.results.sspai!;
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
    expect(result.report!.find((i) => i.kind === 'handoff.pending')!.text).toContain('我已发布');
  });
});
