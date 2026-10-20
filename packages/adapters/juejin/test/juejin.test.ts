import { bundledScript, convert, createPublisher } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockPage, mockSession } from '../../../core/test/session-helpers';
import {
  createJuejinAdapter,
  JUEJIN_SITE_SCRIPT,
  juejinBrief,
  juejinCategories,
  renderJuejin,
  verify,
} from '../src/index';

import type { AccountRef, PublishEvent, TiptapJSON } from '@starnote/publish-core';

const t = (text: string): TiptapJSON => ({ type: 'text', text });
const body = '这是一段足够长的正文，用来补齐掘金要求的摘要长度。'.repeat(4);
const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('源码解读')] },
    { type: 'notice', content: [{ type: 'paragraph', content: [t('注意版本')] }] },
    { type: 'paragraph', content: [t(body)] },
    { type: 'paragraph', content: [{ type: 'katex', attrs: { text: 'x_1' } }] },
    { type: 'imageBlock', attrs: { src: 'https://cdn.starnote.app/a.png' } },
    { type: 'image', attrs: { src: 'https://p3-juejin.byteimg.com/already.png' } },
  ],
});
const account: AccountRef = {
  id: 'b2',
  platform: 'juejin',
  externalUid: '1',
  displayName: 'me',
  store: 'desktop',
};
const API = 'https://api.juejin.cn';

const routes = (overrides: Record<string, any> = {}) =>
  mockSession({
    [`HEAD ${API}/user_api/v1/sys/token`]: () => ({
      headers: { 'x-ware-csrf-token': '0,tok123,86370000,success,sid' },
    }),
    [`POST ${API}/content_api/v1/article_draft/create`]: () => ({
      body: { err_no: 0, data: { id: '7300', article_id: '0' } },
    }),
    ['POST https://juejin.cn/image/urlSave']: () => ({
      body: { err_no: 0, data: 'https://p6-juejin.byteimg.com/new.png' },
    }),
    [`POST ${API}/content_api/v1/article_draft/update`]: () => ({ body: { err_no: 0, data: {} } }),
    [`POST ${API}/content_api/v1/article/publish`]: () => ({
      body: { err_no: 0, data: { article_id: '7400' } },
    }),
    ...overrides,
  });

async function run(sessionFetch: any, form: Record<string, unknown>, page = mockPage()) {
  const events: PublishEvent[] = [];
  const publisher = createPublisher({
    adapters: [createJuejinAdapter({ remoteScript: false, sleep: async () => {} })],
    runtime: 'electron',
    sessionFetch,
    page: async () => page,
    onEvent: (_p, e) => events.push(e),
  });
  const r = await publisher.publish({
    noteId: 'n',
    doc,
    platforms: ['juejin'],
    common: { title: '源码解读', summary: '短摘要' },
    perPlatform: { juejin: form },
    accounts: { juejin: account },
  });
  return { result: r.results.juejin!, events, page };
}

const FORM = {
  category_id: '6809637767543259144',
  tag_ids: ['6809640407484334093'],
  mode: 'publish',
};

describe('juejin adapter', () => {
  it('renders Markdown and pads the summary to 掘金 50–100 chars', () => {
    const r = renderJuejin(
      doc,
      { title: '源码解读', summary: '短摘要' },
      bundledScript(JUEJIN_SITE_SCRIPT)
    );
    expect(r.markdown.startsWith('> **提示**')).toBe(true);
    expect(r.markdown).toContain('$x_1$');
    expect(r.images).toEqual(['https://cdn.starnote.app/a.png']);
    expect([...r.brief].length).toBeGreaterThanOrEqual(50);
    expect([...r.brief].length).toBeLessThanOrEqual(100);
    expect(r.report.map((i) => i.kind)).toContain('summary.generated');
    expect(juejinBrief('短', '也短').report[0]!.kind).toBe('summary.short');
  });

  it('publishes with the CSRF token and the uuid cookie query: token → draft → image → update → publish', async () => {
    const { sessionFetch, calls } = routes();
    const { result } = await run(sessionFetch, FORM);
    expect(result).toMatchObject({
      ok: true,
      url: 'https://juejin.cn/post/7400',
      state: 'pending-review',
      externalId: '7400',
    });
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      `HEAD ${API}/user_api/v1/sys/token`,
      `POST ${API}/content_api/v1/article_draft/create`,
      'POST https://juejin.cn/image/urlSave',
      `POST ${API}/content_api/v1/article_draft/update`,
      `POST ${API}/content_api/v1/article/publish`,
    ]);
    const create = calls[1]!;
    expect(create.url).toBe(`${API}/content_api/v1/article_draft/create?aid=2608`);
    expect(create.init.cookieQuery).toEqual([
      { param: 'uuid', cookie: '__tea_cookie_tokens_2608', jsonPath: 'web_id' },
    ]);
    expect(create.init.headers).toEqual({ 'x-secsdk-csrf-token': 'tok123' });
    expect(create.init.json).toMatchObject({
      category_id: FORM.category_id,
      tag_ids: FORM.tag_ids,
      edit_type: 10,
      mark_content: '',
    });
    const update = calls[3]!.init.json as Record<string, any>;
    expect(update.id).toBe('7300');
    expect(update.mark_content).toContain('https://p6-juejin.byteimg.com/new.png');
    expect(update.mark_content).toContain('https://p3-juejin.byteimg.com/already.png');
    expect([...update.brief_content].length).toBeGreaterThanOrEqual(50);
    expect(calls[4]!.init.json).toMatchObject({ draft_id: '7300', sync_to_org: false });
  });

  it('keeps the original link and reports when the image transfer fails', async () => {
    const { sessionFetch, calls } = routes({
      'POST https://juejin.cn/image/urlSave': () => ({ status: 404, body: 'gone' }),
    });
    const { result } = await run(sessionFetch, FORM);
    expect(result.ok).toBe(true);
    expect((calls[3]!.init.json as any).mark_content).toContain('https://cdn.starnote.app/a.png');
    expect(result.report!.find((i) => i.kind === 'image.failed')!.text).toContain('保留原图链接');
  });

  it('hands off to the editor on request', async () => {
    const { sessionFetch, calls } = routes();
    const { result, page } = await run(sessionFetch, { ...FORM, mode: 'review' });
    expect(result).toMatchObject({ state: 'handoff', url: 'https://juejin.cn/editor/drafts/7300' });
    expect(page.log.map((l) => l[0])).toEqual(['goto', 'show']);
    expect(calls.some((c) => c.url.includes('article/publish'))).toBe(false);
  });

  it.each([
    [{ status: 200, body: { err_no: 403, err_msg: '未登录' } }, 'relogin'],
    [{ status: 429, body: '' }, 'rate_limited'],
    [{ status: 200, body: { err_no: 4031, err_msg: '标签数量超过上限' } }, 'platform_error'],
  ])('maps %o to %s', async (reply, code) => {
    const { sessionFetch } = routes({
      [`POST ${API}/content_api/v1/article_draft/create`]: () => reply,
    });
    const { result, events } = await run(sessionFetch, FORM);
    expect(result.ok).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'failed', code });
  });

  it('rejects a form without category or tags before calling 掘金', async () => {
    const { sessionFetch, calls } = routes();
    const { result } = await run(sessionFetch, { mode: 'publish' });
    expect(result.error).toContain('分类');
    expect(calls).toHaveLength(0);
  });

  it('reads categories and the current user', async () => {
    const { sessionFetch } = mockSession({
      [`GET ${API}/tag_api/v1/query_category_briefs`]: () => ({
        body: { err_no: 0, data: [{ category_id: '1', category_name: '前端' }] },
      }),
      [`GET ${API}/user_api/v1/user/get`]: () => ({
        body: {
          err_no: 0,
          data: { user_id: '99', user_name: '掘友', avatar_large: 'https://p3.byteimg.com/a.png' },
        },
      }),
    });
    expect(await juejinCategories(sessionFetch, 'b2')).toEqual([{ id: '1', name: '前端' }]);
    expect(await verify(sessionFetch, 'b2')).toMatchObject({
      state: 'ok',
      uid: '99',
      nickname: '掘友',
    });
  });
});
