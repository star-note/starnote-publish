/** 交接：默认 `draft`（草稿接口填好全部字段再打开草稿）；`prefill` 和草稿失败时的退路：编辑器预填 Markdown。 */
import { convert, createPublisher, HANDOFF_FILLED_TEXT } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockSession } from '../../../core/test/session-helpers';
import { createJuejinAdapter, juejinSchema } from '../src/index';
import { fetchJuejinStats } from '../src/adapter';
import { guessJuejinCategory, tagKeywords } from '../src/fields';

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

describe('juejin hand-off', () => {
  it('defaults to draft and needs no category or tags', () => {
    expect(juejinSchema.parse({})).toMatchObject({ mode: 'draft' });
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
      perPlatform: { juejin: { mode: 'prefill' } },
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

const API = 'https://api.juejin.cn';
const draftRoutes = (over: Record<string, any> = {}) => ({
  [`HEAD ${API}/user_api/v1/sys/token`]: () => ({
    headers: { 'x-ware-csrf-token': '0,tok,1,success,s' },
  }),
  [`GET ${API}/tag_api/v1/query_category_briefs`]: () => ({
    body: {
      err_no: 0,
      data: [
        { category_id: '6809637767543259144', category_name: '前端' },
        { category_id: '6809637769959178254', category_name: '后端' },
      ],
    },
  }),
  [`POST ${API}/tag_api/v1/query_tag_list`]: () => ({
    body: { err_no: 0, data: [{ tag_id: '6809640407484334093', tag: { tag_name: 'Vue.js' } }] },
  }),
  [`POST ${API}/content_api/v1/article_draft/create`]: () => ({
    body: { err_no: 0, data: { id: '7300' } },
  }),
  ['POST https://juejin.cn/image/urlSave']: () => ({
    body: { err_no: 0, data: 'https://p6-juejin.byteimg.com/a.png' },
  }),
  [`POST ${API}/content_api/v1/article_draft/update`]: () => ({ body: { err_no: 0, data: {} } }),
  ...over,
});

async function publishDraft(
  sessionFetch: any,
  common: Record<string, unknown> = { title: 'Vue 组件通信', tags: ['Vue'] }
) {
  const desk: HandoffRequest[] = [];
  const r = await createPublisher({
    adapters: [createJuejinAdapter({ remoteScript: false, sleep: async () => {} })],
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
    common,
    perPlatform: { juejin: {} },
    accounts: { juejin: account },
  });
  return { result: r.results.juejin!, desk };
}

describe('juejin default: a filled draft opened in the 发布台', () => {
  it('guesses category and tag, fills the brief, writes the draft and opens it', async () => {
    const { sessionFetch, calls } = mockSession(draftRoutes());
    const { result, desk } = await publishDraft(sessionFetch);
    const update = calls.find((c) => c.url.includes('article_draft/update'))!;
    const body = update.init.json as Record<string, any>;
    expect(body).toMatchObject({
      id: '7300',
      category_id: '6809637767543259144',
      tag_ids: ['6809640407484334093'],
    });
    expect([...body.brief_content].length).toBeGreaterThanOrEqual(50);
    expect(body.mark_content).toContain('https://p6-juejin.byteimg.com/a.png');
    expect(desk[0]).toMatchObject({ editorUrl: 'https://juejin.cn/editor/drafts/7300' });
    expect(desk[0]!.prefill).toBeUndefined();
    expect(result).toMatchObject({ ok: true, state: 'handoff', externalId: '7300' });
    const filled = result.report!.find((i) => i.kind === 'fields.prefilled')!.text;
    expect(filled).toContain('分类「前端」');
    expect(filled).toContain('标签「Vue.js」');
  });

  it('falls back to the prefilled editor when the draft API fails', async () => {
    const { sessionFetch } = mockSession(
      draftRoutes({
        [`POST ${API}/content_api/v1/article_draft/create`]: () => ({ status: 500, body: {} }),
      })
    );
    const { result, desk } = await publishDraft(sessionFetch);
    expect(desk.at(-1)).toMatchObject({ editorUrl: 'https://juejin.cn/editor/drafts/new' });
    expect(result.report!.some((i) => i.kind === 'draft.fallback')).toBe(true);
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
  });
});

describe('juejin fields and stats', () => {
  it('guesses the category from title, tags and text', () => {
    expect(guessJuejinCategory({ title: 'React Hooks 实战' })).toBe('前端');
    expect(guessJuejinCategory({ title: '用 Claude 写 Agent', tags: ['大模型'] })).toBe('人工智能');
    expect(guessJuejinCategory({ title: '我的 2026', text: '生活随笔' })).toBe('代码人生');
    expect(tagKeywords(['#Vue'], '前端')).toEqual(['Vue', '前端']);
    expect(tagKeywords(undefined, '代码人生')).toEqual([]);
  });

  it('reads the public article stats', async () => {
    const fetch = (async () =>
      new Response(
        JSON.stringify({
          err_no: 0,
          data: {
            article_info: { view_count: 120, digg_count: 7, comment_count: 2, collect_count: 5 },
          },
        })
      )) as unknown as typeof globalThis.fetch;
    expect(await fetchJuejinStats('7400', { fetch })).toMatchObject({
      source: 'public',
      views: 120,
      likes: 7,
      comments: 2,
      favorites: 5,
    });
    expect(await fetchJuejinStats('not-an-id', { fetch })).toBeNull();
  });
});
