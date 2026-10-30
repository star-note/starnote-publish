/**
 * 交接：默认 `draft`（草稿接口填好标题、正文、题图、话题，再在发布台里打开草稿）；`prefill` 和草稿失败时的退路：
 * 图片走知乎接口转存，然后在发布台里预填知乎编辑器。两条路都由用户点发布。
 */
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
const API = 'https://zhuanlan.zhihu.com/api';
const routes = (over: Record<string, any> = {}) =>
  mockSession({
    [`POST ${API}/uploaded_images`]: () => ({
      body: { src: 'https://pic1.zhimg.com/v2-a.png' },
    }),
    ...over,
  });
const draftRoutes = (over: Record<string, any> = {}) =>
  routes({
    [`POST ${API}/articles/drafts`]: () => ({ body: { id: 9001 } }),
    [`PATCH ${API}/articles/9001/draft`]: () => ({ status: 204 }),
    [`GET ${API}/autocomplete/topics`]: () => ({
      body: [{ id: '19550517', name: '写作', type: 'topic' }],
    }),
    [`POST ${API}/articles/9001/topics`]: () => ({ body: {} }),
    ...over,
  });

async function run(
  extra: Record<string, unknown>,
  form: Record<string, unknown> = { mode: 'prefill', topics: ['写作'] },
  session = routes()
) {
  const { sessionFetch, calls } = session;
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
    perPlatform: { zhihu: form },
    accounts: { zhihu: account },
  });
  return { result: r.results.zhihu!, calls };
}

const desk = () => {
  const reqs: HandoffRequest[] = [];
  return {
    reqs,
    handoff: async (req: HandoffRequest) => {
      reqs.push(req);
      return { state: 'shown' as const };
    },
  };
};

describe('zhihu default: a filled draft opened in the 发布台', () => {
  it('defaults to draft', () => {
    expect(zhihuSchema.parse({}).mode).toBe('draft');
  });

  it('writes title, body and topics into a draft, opens it, and leaves declarations to the user', async () => {
    const d = desk();
    const { result, calls } = await run(
      { handoff: d.handoff },
      { topics: ['写作'] },
      draftRoutes()
    );
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      `POST ${API}/articles/drafts`,
      `POST ${API}/uploaded_images`,
      `PATCH ${API}/articles/9001/draft`,
      `GET ${API}/autocomplete/topics`,
      `POST ${API}/articles/9001/topics`,
    ]);
    expect(calls.some((c) => c.url.includes('content/publish'))).toBe(false);
    expect(d.reqs[0]).toMatchObject({ editorUrl: 'https://zhuanlan.zhihu.com/p/9001/edit' });
    expect(d.reqs[0]!.prefill).toBeUndefined();
    expect(result).toMatchObject({ ok: true, state: 'handoff', externalId: '9001' });
    const items = Object.fromEntries(result.report!.map((i) => [i.kind, i.text]));
    expect(items['fields.prefilled']).toContain('正文（1 张图已转存到知乎）');
    expect(items['fields.prefilled']).toContain('话题「写作」');
    expect(items['declarations.user']).toContain('创作声明');
  });

  it('falls back to the prefilled editor when the draft API fails', async () => {
    const d = desk();
    const { result } = await run(
      { handoff: d.handoff },
      { topics: ['写作'] },
      draftRoutes({ [`POST ${API}/articles/drafts`]: () => ({ status: 500, body: {} }) })
    );
    expect(d.reqs.at(-1)).toMatchObject({ editorUrl: 'https://zhuanlan.zhihu.com/write' });
    expect(result.report!.some((i) => i.kind === 'draft.fallback')).toBe(true);
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
  });
});

describe('zhihu prefill: rehost images + prefilled editor', () => {
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
