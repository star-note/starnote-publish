import { bundledScript, convert, createPublisher, sessionPartition } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockPage, mockSession } from '../../../core/test/session-helpers';
import { zhihuElectronAdapter } from '../src/electron';
import { createZhihuAdapter, renderZhihu, verify, ZHIHU_SITE_SCRIPT } from '../src/index';

import type { AccountRef, PublishEvent, PublishJob, TiptapJSON } from '@starnote/publish-core';

const t = (text: string): TiptapJSON => ({ type: 'text', text });
const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('为什么长文没人看完')] },
    { type: 'heading', attrs: { level: 4 }, content: [t('小节')] },
    {
      type: 'card',
      attrs: { variant: 'tip' },
      content: [{ type: 'paragraph', content: [t('先给结论')] }],
    },
    { type: 'paragraph', content: [{ type: 'katex', attrs: { text: 'E=mc^2' } }] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;')] },
    { type: 'imageBlock', attrs: { src: 'https://cdn.starnote.app/a.png', caption: '图一' } },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/broken.png' } },
  ],
});

const account: AccountRef = {
  id: 'a1b2c3d4',
  platform: 'zhihu',
  externalUid: 'u1',
  displayName: '小明',
  store: 'desktop',
};
const PARTITION = 'persist:pub-zhihu-a1b2c3d4';

const happy = () =>
  mockSession({
    'POST https://zhuanlan.zhihu.com/api/articles/drafts': () => ({ body: { id: 9001 } }),
    'POST https://zhuanlan.zhihu.com/api/uploaded_images': (c) =>
      (c.init.urlencoded?.url ?? '').includes('broken')
        ? { status: 400, body: { error: { message: '图片无法访问' } } }
        : { body: { src: 'https://pic1.zhimg.com/v2-abc.png' } },
    'PATCH https://zhuanlan.zhihu.com/api/articles/9001/draft': () => ({ status: 204 }),
    'GET https://zhuanlan.zhihu.com/api/autocomplete/topics': () => ({
      body: [{ id: '19550517', name: '互联网', type: 'topic' }],
    }),
    'POST https://zhuanlan.zhihu.com/api/articles/9001/topics': () => ({ body: {} }),
    'POST https://www.zhihu.com/api/v4/content/publish': () => ({
      body: { message: 'success', data: { result: '{}' } },
    }),
  });

function run(
  sessionFetch: ReturnType<typeof mockSession>['sessionFetch'],
  form: Record<string, unknown>,
  page = mockPage()
) {
  const events: PublishEvent[] = [];
  const adapter = createZhihuAdapter({
    remoteScript: false,
    sleep: async () => {},
    traceId: () => '1,uuid',
  });
  const publisher = createPublisher({
    adapters: [adapter],
    runtime: 'electron',
    sessionFetch,
    page: async () => page,
    onEvent: (_p, e) => events.push(e),
  });
  const job: PublishJob = {
    noteId: 'n1',
    doc,
    platforms: ['zhihu'],
    common: { title: '为什么长文没人看完' },
    perPlatform: { zhihu: form },
    accounts: { zhihu: account },
  };
  return publisher.publish(job).then((r) => ({ result: r.results.zhihu!, events, page }));
}

describe('zhihu adapter', () => {
  it('declares an electron-only, desktop-session adapter', () => {
    expect(zhihuElectronAdapter.runtime).toEqual(['electron']);
    expect(zhihuElectronAdapter.binding).toMatchObject({ kind: 'cookie', store: 'desktop' });
    expect(zhihuElectronAdapter.binding?.desktopSession?.success.cookies?.[0]?.name).toBe('z_c0');
  });

  it('renders 知乎 HTML: h2/h3, quote with 提示, formula images, <pre lang>', () => {
    const r = renderZhihu(doc, { title: '为什么长文没人看完' }, bundledScript(ZHIHU_SITE_SCRIPT));
    expect(r.html).not.toContain('为什么长文没人看完</h');
    expect(r.html).toContain('<h3>小节</h3>');
    expect(r.html).toContain('<blockquote>\n<p><strong>提示：</strong></p>');
    expect(r.html).toContain('<img eeimg="1" src="https://www.zhihu.com/equation?tex=E%3Dmc%5E2"');
    expect(r.html).toContain('<pre lang="ts"><code>const a = 1;</code></pre>');
    expect(r.images).toEqual([
      'https://cdn.starnote.app/a.png',
      'https://cdn.starnote.app/broken.png',
    ]);
    expect(r.report.map((i) => i.kind)).toEqual(['block.degraded', 'math.rasterized']);
  });

  it('publishes: draft → images → body → topics → publish, in the account partition', async () => {
    const { sessionFetch, calls } = happy();
    const { result } = await run(sessionFetch, { topics: ['互联网'], mode: 'publish' });
    expect(result).toMatchObject({
      ok: true,
      url: 'https://zhuanlan.zhihu.com/p/9001',
      state: 'published',
    });
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      'POST https://zhuanlan.zhihu.com/api/articles/drafts',
      'POST https://zhuanlan.zhihu.com/api/uploaded_images',
      'POST https://zhuanlan.zhihu.com/api/uploaded_images',
      'PATCH https://zhuanlan.zhihu.com/api/articles/9001/draft',
      'GET https://zhuanlan.zhihu.com/api/autocomplete/topics',
      'POST https://zhuanlan.zhihu.com/api/articles/9001/topics',
      'POST https://www.zhihu.com/api/v4/content/publish',
    ]);
    expect(new Set(calls.map((c) => c.partition))).toEqual(new Set([PARTITION]));
    expect(calls[0]!.init.csrf).toEqual({ cookie: '_xsrf', header: 'x-xsrftoken' });
    expect(calls[1]!.init.urlencoded).toEqual({
      source: 'article',
      url: 'https://cdn.starnote.app/a.png',
    });
    const body = calls[3]!.init.json as { content: string; title: string };
    expect(body.title).toBe('为什么长文没人看完');
    expect(body.content).toContain('src="https://pic1.zhimg.com/v2-abc.png"');
    // the failed image keeps its original link
    expect(body.content).toContain('src="https://cdn.starnote.app/broken.png"');
    expect(calls[5]!.init.json).toEqual({ id: '19550517', name: '互联网', type: 'topic' });
    expect(calls[6]!.init.json).toMatchObject({
      action: 'article',
      data: { draft: { id: '9001', disabled: 1 }, publish: { traceId: '1,uuid' } },
    });
    const kinds = result.report!.map((i) => i.kind);
    expect(kinds).toContain('image.rehosted');
    const failed = result.report!.find((i) => i.kind === 'image.failed')!;
    expect(failed.text).toContain('保留原图链接');
    expect(failed.samples).toEqual(['https://cdn.starnote.app/broken.png']);
  });

  it('hands off to the editor when no topic is given (知乎 needs one) or when asked to', async () => {
    for (const form of [{ mode: 'publish' }, { topics: ['互联网'], mode: 'review' }]) {
      const { sessionFetch, calls } = happy();
      const { result, page } = await run(sessionFetch, form);
      expect(result).toMatchObject({
        ok: true,
        state: 'handoff',
        url: 'https://zhuanlan.zhihu.com/p/9001/edit',
      });
      expect(page.log).toEqual([['goto', 'https://zhuanlan.zhihu.com/p/9001/edit'], ['show']]);
      expect(calls.some((c) => c.url.includes('content/publish'))).toBe(false);
      expect(result.report!.some((i) => i.kind === 'handoff.pending')).toBe(true);
    }
  });

  it('falls back to the editor when 知乎 refuses the publish call', async () => {
    const { sessionFetch } = mockSession({
      'POST https://zhuanlan.zhihu.com/api/articles/drafts': () => ({ body: { id: 9001 } }),
      'POST https://zhuanlan.zhihu.com/api/uploaded_images': () => ({
        body: { src: 'https://pic1.zhimg.com/x.png' },
      }),
      'PATCH https://zhuanlan.zhihu.com/api/articles/9001/draft': () => ({ status: 204 }),
      'GET https://zhuanlan.zhihu.com/api/autocomplete/topics': () => ({
        body: [{ id: '1', name: '互联网' }],
      }),
      'POST https://zhuanlan.zhihu.com/api/articles/9001/topics': () => ({ body: {} }),
      'POST https://www.zhihu.com/api/v4/content/publish': () => ({
        body: { message: 'need verify' },
      }),
    });
    const { result } = await run(sessionFetch, { topics: ['互联网'], mode: 'publish' });
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
  });

  it.each([
    [401, 'relogin', 'relogin'],
    [429, 'rate_limited', 'retry'],
    [500, 'platform_error', 'help'],
  ])('maps HTTP %i to %s', async (status, code, action) => {
    const { sessionFetch } = mockSession({
      'POST https://zhuanlan.zhihu.com/api/articles/drafts': () => ({
        status,
        body: { error: {} },
      }),
    });
    const { result, events } = await run(sessionFetch, { topics: ['a'], mode: 'publish' });
    expect(result.ok).toBe(false);
    const failed = events.at(-1) as Extract<PublishEvent, { type: 'failed' }>;
    expect(failed).toMatchObject({ type: 'failed', code });
    expect(failed.actions?.[0]?.kind).toBe(action);
  });

  it('asks for a login when no account is bound, and refuses to run without the desktop', async () => {
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [createZhihuAdapter({ remoteScript: false })],
      runtime: 'electron',
      onEvent: (_p, e) => events.push(e),
    });
    const r = await publisher.publish({
      noteId: 'n',
      doc,
      platforms: ['zhihu'],
      common: {},
      perPlatform: {},
    });
    expect(r.results.zhihu!.error).toContain('桌面端');
  });

  it('verify reads the nickname through the read-only endpoint', async () => {
    const { sessionFetch, calls } = mockSession({
      'GET https://www.zhihu.com/api/v4/me': () => ({
        body: { id: 'hash1', name: '小明', avatar_url: 'https://pic1.zhimg.com/a.jpg' },
      }),
    });
    expect(await verify(sessionFetch, 'a1b2c3d4')).toEqual({
      state: 'ok',
      uid: 'hash1',
      nickname: '小明',
      avatar: 'https://pic1.zhimg.com/a.jpg',
    });
    expect(calls[0]!.partition).toBe(sessionPartition('zhihu', 'a1b2c3d4'));
    const out = mockSession({
      'GET https://www.zhihu.com/api/v4/me': () => ({ status: 401, body: {} }),
    });
    expect((await verify(out.sessionFetch, 'a1b2c3d4')).state).toBe('needs-relogin');
  });
});
