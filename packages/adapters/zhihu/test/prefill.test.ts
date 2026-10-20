/** 默认交接：图片走知乎接口转存，然后在发布台里预填知乎编辑器，由用户点发布。 */
import { convert, createPublisher, HANDOFF_FILLED_TEXT } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockPage, mockSession } from '../../../core/test/session-helpers';
import { createZhihuAdapter, zhihuSchema } from '../src/index';

import type { AccountRef, HandoffRequest, TiptapJSON } from '@starnote/publish-core';

const t = (text: string): TiptapJSON => ({ type: 'text', text });
const doc = convert({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [t('正文第一段')] },
    { type: 'imageBlock', attrs: { src: 'https://cdn.starnote.app/a.png' } },
  ],
});
const account: AccountRef = {
  id: 'a1',
  platform: 'zhihu',
  externalUid: 'u',
  displayName: 'me',
  store: 'desktop',
};
const routes = () =>
  mockSession({
    'POST https://zhuanlan.zhihu.com/api/uploaded_images': () => ({
      body: { src: 'https://pic1.zhimg.com/v2-a.png' },
    }),
  });

async function run(extra: Record<string, unknown>) {
  const { sessionFetch, calls } = routes();
  const publisher = createPublisher({
    adapters: [createZhihuAdapter({ remoteScript: false })],
    runtime: 'electron',
    sessionFetch,
    ...extra,
  });
  const r = await publisher.publish({
    noteId: 'n1',
    doc,
    platforms: ['zhihu'],
    common: { title: '标题' },
    perPlatform: { zhihu: { topics: ['写作'] } },
    accounts: { zhihu: account },
  });
  return { result: r.results.zhihu!, calls };
}

describe('zhihu default: prefill + hand-off', () => {
  it('defaults to prefill', () => {
    expect(zhihuSchema.parse({}).mode).toBe('prefill');
  });

  it('rehosts images, then puts a prefilled editor on the 发布台; never creates or publishes by API', async () => {
    const desk: HandoffRequest[] = [];
    const { result, calls } = await run({
      handoff: async (req: HandoffRequest) => {
        desk.push(req);
        return { state: 'shown' };
      },
    });
    expect(calls.map((c) => c.url)).toEqual(['https://zhuanlan.zhihu.com/api/uploaded_images']);
    expect(desk).toHaveLength(1);
    expect(desk[0]).toMatchObject({
      taskId: 'n1:zhihu:a1',
      platform: 'zhihu',
      accountId: 'a1',
      editorUrl: 'https://zhuanlan.zhihu.com/write',
      label: '知乎',
      prefill: { title: '标题', text: expect.stringContaining('正文第一段') },
    });
    expect(desk[0]!.prefill!.html).toContain('src="https://pic1.zhimg.com/v2-a.png"');
    expect(result).toMatchObject({
      ok: true,
      state: 'handoff',
      url: 'https://zhuanlan.zhihu.com/write',
    });
    const items = result.report!.map((i) => [i.kind, i.text]);
    expect(items).toContainEqual(['handoff.pending', HANDOFF_FILLED_TEXT]);
    expect(items).toContainEqual(['tags.manual', '发布时请选择话题：写作']);
  });

  it('without the desk, fills a single window: insertText title, paste body', async () => {
    const page = mockPage();
    const { result } = await run({ page: async () => page });
    expect(page.log.map((l) => l[0])).toEqual([
      'goto',
      'show',
      'waitForSelector',
      'insertText',
      'pasteHtml',
    ]);
    expect(page.log[3]).toEqual(['insertText', 'textarea[placeholder*="标题"]', '标题']);
    expect(page.log[4]![1]).toBe('.public-DraftEditor-content');
    expect(result.state).toBe('handoff');
    expect(result.report!.some((i) => i.kind === 'prefill.failed')).toBe(false);
  });
});
