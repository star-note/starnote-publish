import { convert, createPublisher } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockPage, mockSession } from '../../../core/test/session-helpers';
import { createCsdnAdapter, CSDN_SITE_SCRIPT, verify } from '../src/index';
import { csdnElectronAdapter } from '../src/electron';

import type { AccountRef, PublishEvent, TiptapJSON } from '@starnote/publish-core';

const t = (text: string): TiptapJSON => ({ type: 'text', text });
const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Docker 时区排查')] },
    { type: 'paragraph', content: [t('正文')] },
    { type: 'imageBlock', attrs: { src: 'https://cdn.starnote.app/a.jpg' } },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/b.png' } },
  ],
});
const account: AccountRef = {
  id: 'c3',
  platform: 'csdn',
  externalUid: 'u',
  displayName: 'me',
  store: 'desktop',
};
const POLICY = 'GET https://imgservice.csdn.net/direct/v1.0/image/obs/upload';
const OBS = 'POST https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/';

const routes = (
  upload: (n: number) => any = () => ({
    body: { code: 200, data: { imageUrl: 'https://i-blog.csdnimg.cn/direct/x.png' } },
  })
) =>
  mockSession({
    [POLICY]: () => ({
      body: {
        code: 200,
        data: {
          host: 'https://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/',
          filePath: 'direct/abc.png',
          policy: 'P',
          signature: 'S',
          accessId: 'AK',
          callbackUrl: 'cb',
          callbackBody: 'cbb',
          callbackBodyType: 'application/json',
          customParam: {
            rtype: 'blog_picture',
            filePath: 'direct/abc.png',
            isAudit: 0,
            'x-image-app': 'direct_blog',
            type: 'blog',
            'x-image-suffix': 'png',
            username: 'me',
          },
        },
      },
    }),
    [OBS]: (_c, n) => upload(n),
  });

async function run(sessionFetch: any, form: Record<string, unknown> = {}, page: any = mockPage()) {
  const events: PublishEvent[] = [];
  const publisher = createPublisher({
    adapters: [createCsdnAdapter({ remoteScript: false, sleep: async () => {} })],
    runtime: 'electron',
    sessionFetch,
    ...(page ? { page: async () => page } : {}),
    onEvent: (_p, e) => events.push(e),
  });
  const r = await publisher.publish({
    noteId: 'n',
    doc,
    platforms: ['csdn'],
    common: { title: 'Docker 时区排查', tags: ['#Docker', '运维', 'Docker'] },
    perPlatform: { csdn: form },
    accounts: { csdn: account },
  });
  return { result: r.results.csdn!, events, page };
}

describe('csdn adapter (hand-off)', () => {
  it('never calls the signed save API', async () => {
    const script = JSON.parse(Buffer.from(CSDN_SITE_SCRIPT.payload, 'base64url').toString('utf8'));
    expect(script.endpoints.saveArticle.signed).toBe(true);
    expect(csdnElectronAdapter.runtime).toEqual(['electron']);
  });

  it('uploads images (policy → OBS), opens the editor, fills title and Markdown, leaves publishing to the user', async () => {
    const { sessionFetch, calls } = routes();
    const page = mockPage();
    const { result } = await run(sessionFetch, { article_type: 'original' }, page);
    expect(result).toMatchObject({
      ok: true,
      state: 'handoff',
      url: 'https://editor.csdn.net/md/',
    });
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      POLICY,
      OBS,
      POLICY,
      OBS,
    ]);
    expect(calls[0]!.url).toContain('x-image-suffix=jpg');
    expect(calls[2]!.url).toContain('x-image-suffix=png');
    expect(calls[1]!.init.form).toMatchObject({
      key: 'direct/abc.png',
      policy: 'P',
      AccessKeyId: 'AK',
      'x:rtype': 'blog_picture',
      'x:isAudit': '0',
      file: { kind: 'url', url: 'https://cdn.starnote.app/a.jpg', name: 'image.jpg' },
    });
    expect(calls.some((c) => c.url.includes('bizapi.csdn.net'))).toBe(false);
    // 第 3 层：insertText 填标题，剪贴板 + paste() 填正文；不执行页面脚本，不点发布
    expect(page.log.map((l) => l[0])).toEqual([
      'goto',
      'show',
      'waitForSelector',
      'insertText',
      'pasteHtml',
    ]);
    expect(page.log[3]).toEqual(['insertText', '.article-bar__title input', 'Docker 时区排查']);
    const [, sel, content] = page.log[4] as [string, string, { text: string; html?: string }];
    expect(sel).toBe('.editor__inner');
    expect(content.text).toContain('https://i-blog.csdnimg.cn/direct/x.png');
    expect(content.text).not.toContain('# Docker 时区排查');
    expect(content.html).toBeUndefined();
    const kinds = result.report!.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['image.rehosted', 'handoff.pending']));
    // 我们做了什么：填好的项；标签给建议；声明类由用户自己选，只提醒（表单里选了就带上）
    const items = Object.fromEntries(result.report!.map((i) => [i.kind, i.text]));
    expect(items['fields.prefilled']).toContain('（2 张图已转存到 CSDN）');
    expect(items['tags.manual']).toContain('Docker、运维');
    expect(items['tags.manual']).toContain('最多 7 个');
    expect(items['declarations.user']).toContain('你在表单里选的是「原创」');
  });

  it('presets no article type: the user picks it in CSDN', async () => {
    const { sessionFetch } = routes();
    const { result } = await run(sessionFetch, {});
    const text = result.report!.find((i) => i.kind === 'declarations.user')!.text;
    expect(text).toContain('创作声明');
    expect(text).not.toContain('你在表单里选的是');
  });

  it('keeps the original link when an upload fails, and says so', async () => {
    // a 500 from the image host fails that image only…
    const { sessionFetch: sf2 } = routes((n) =>
      n === 1
        ? { status: 500, body: 'oops' }
        : { body: { code: 200, data: { imageUrl: 'https://i-blog.csdnimg.cn/direct/y.png' } } }
    );
    const page = mockPage();
    const { result } = await run(sf2, {}, page);
    expect(result.ok).toBe(true);
    const failed = result.report!.find((i) => i.kind === 'image.failed')!;
    expect(failed.text).toContain('保留原图链接');
    expect((page.log[4]![2] as { text: string }).text).toContain('https://cdn.starnote.app/a.jpg');
    // …while a 403 (logged out) stops the whole run with a relogin action
    const { sessionFetch } = routes(() => ({ status: 403, body: 'denied' }));
    const relogin = await run(sessionFetch, {}, mockPage());
    expect(relogin.events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'relogin',
      actions: [{ kind: 'relogin' }],
    });
  });

  it('reports when the editor could not be filled', async () => {
    const { sessionFetch } = routes();
    const { result } = await run(sessionFetch, {}, mockPage({ failPaste: true }));
    expect(result.report!.find((i) => i.kind === 'prefill.failed')!.text).toContain('正文');
  });

  it('needs the desktop page and validates the repost link', async () => {
    const { sessionFetch } = routes();
    const noPage = await run(sessionFetch, {}, null);
    expect(noPage.events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'platform_error',
      actions: [{ kind: 'help' }, { kind: 'retry' }],
    });
    const repost = await run(sessionFetch, { article_type: 'repost' });
    expect(repost.result.error).toContain('原文链接');
  });

  it('verify uses the read-only user endpoint', async () => {
    const { sessionFetch } = mockSession({
      'GET https://me.csdn.net/api/user/show': () => ({
        body: {
          code: 200,
          data: { csdnid: 'me', nickname: '我', avatarurl: 'https://profile.csdnimg.cn/a.jpg' },
        },
      }),
    });
    expect(await verify(sessionFetch, 'c3')).toMatchObject({
      state: 'ok',
      uid: 'me',
      nickname: '我',
    });
  });
});
