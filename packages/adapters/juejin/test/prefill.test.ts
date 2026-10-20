/** 默认交接：掘金编辑器预填 Markdown，分类、标签、摘要由用户在发布弹窗里选。 */
import { convert, createPublisher, HANDOFF_FILLED_TEXT } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockSession } from '../../../core/test/session-helpers';
import { createJuejinAdapter, juejinSchema } from '../src/index';

import type { AccountRef, HandoffRequest } from '@starnote/publish-core';

const doc = convert({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '正文'.repeat(40) }] },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/a.png' } },
  ],
});
const account: AccountRef = {
  id: 'b2',
  platform: 'juejin',
  externalUid: '1',
  displayName: 'me',
  store: 'desktop',
};

describe('juejin default: prefill + hand-off', () => {
  it('defaults to prefill and needs no category or tags', () => {
    expect(juejinSchema.parse({})).toMatchObject({ mode: 'prefill' });
    expect(juejinSchema.safeParse({ mode: 'publish' }).success).toBe(false);
  });

  it('transfers images, then hands a prefilled Markdown editor to the 发布台', async () => {
    const { sessionFetch, calls } = mockSession({
      'HEAD https://api.juejin.cn/user_api/v1/sys/token': () => ({
        headers: { 'x-ware-csrf-token': '0,tok,1,success,s' },
      }),
      'POST https://juejin.cn/image/urlSave': () => ({
        body: { err_no: 0, data: 'https://p6-juejin.byteimg.com/a.png' },
      }),
    });
    const desk: HandoffRequest[] = [];
    const r = await createPublisher({
      adapters: [createJuejinAdapter({ remoteScript: false })],
      runtime: 'electron',
      sessionFetch,
      handoff: async (req) => {
        desk.push(req);
        return { state: 'queued' };
      },
    }).publish({
      noteId: 'n',
      doc,
      platforms: ['juejin'],
      common: { title: '标题' },
      perPlatform: { juejin: {} },
      accounts: { juejin: account },
    });
    const result = r.results.juejin!;
    expect(
      calls.some((c) => c.url.includes('article_draft') || c.url.includes('article/publish'))
    ).toBe(false);
    expect(desk[0]).toMatchObject({
      platform: 'juejin',
      editorUrl: 'https://juejin.cn/editor/drafts/new',
    });
    expect(desk[0]!.prefill!.text).toContain('https://p6-juejin.byteimg.com/a.png');
    expect(desk[0]!.prefill!.html).toBeUndefined();
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
    expect(result.report!.find((i) => i.kind === 'handoff.pending')!.text).toBe(
      HANDOFF_FILLED_TEXT
    );
    expect(result.report!.find((i) => i.kind === 'fields.manual')!.text).toContain('分类和标签');
  });
});
