import { convert, createPublisher, sessionPartition } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockPage, mockSession } from '../../../core/test/session-helpers';
import { wechatMpElectronAdapter } from '../src/electron';
import {
  createWechatMpAdapter,
  replaceImageSrcs,
  verify,
  WECHAT_HANDOFF_TEXT,
  WECHAT_RELOGIN_TEXT,
} from '../src/index';

import type { AccountRef, PublishEvent, TiptapJSON } from '@starnote/publish-core';

const t = (text: string): TiptapJSON => ({ type: 'text', text });
const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('写给公众号的长文')] },
    {
      type: 'paragraph',
      content: [
        t('参考 '),
        {
          type: 'text',
          text: '辰记官网',
          marks: [{ type: 'link', attrs: { href: 'https://starnote.app/' } }],
        },
      ],
    },
    {
      type: 'imageBlock',
      attrs: { src: 'https://cdn.starnote.app/a.png?x=1&y=2', caption: '图一' },
    },
    { type: 'image', attrs: { src: 'https://cdn.starnote.app/broken.png' } },
  ],
});
const account: AccountRef = {
  id: 'w1',
  platform: 'wechat',
  externalUid: 'gh_1',
  displayName: '我的号',
  store: 'desktop',
};
const HOME_HTML = `<script>window.wx.commonData = { data: { t: "987654", ticket: "abc123", user_name: "gh_abc", nick_name: "辰记小号", time: "1760850000", head_img: "https://wx.qlogo.cn/a.png" } };</script>`;
const LOGIN_HTML =
  '<html><body><div class="login__type__container">请使用微信扫描二维码登录</div></body></html>';
const BY_URL = 'POST https://mp.weixin.qq.com/cgi-bin/uploadimg2cdn';
const UPLOAD = 'POST https://mp.weixin.qq.com/cgi-bin/filetransfer';
const SAVE = 'POST https://mp.weixin.qq.com/cgi-bin/operate_appmsg';

function routes(over: Record<string, any> = {}) {
  return mockSession({
    'GET https://mp.weixin.qq.com/': () => ({ body: HOME_HTML }),
    // 按 URL 转存：正文图成功，封面走不通（改为下载后上传），坏图两条路都失败
    [BY_URL]: (c: any) =>
      c.init.urlencoded.imgurl.includes('a.png')
        ? { body: { errcode: 0, url: 'https://mmbiz.qpic.cn/a/0?wx_fmt=png', file_id: 1 } }
        : { body: { errcode: -1, errmsg: 'invalid url' } },
    [UPLOAD]: (c: any) =>
      c.init.form.file.url.includes('broken')
        ? { body: { base_resp: { ret: 1, err_msg: 'image invalid' } } }
        : {
            body: {
              base_resp: { ret: 0, err_msg: 'ok' },
              cdn_url: 'https://mmbiz.qpic.cn/cover/0',
              content: '100000002',
            },
          },
    [SAVE]: () => ({ body: { base_resp: { ret: 0, err_msg: 'ok' }, appMsgId: 2247483650 } }),
    ...over,
  });
}

async function run(sessionFetch: any, form: Record<string, unknown> = {}, page = mockPage()) {
  const events: PublishEvent[] = [];
  let n = 0;
  const publisher = createPublisher({
    adapters: [
      createWechatMpAdapter({
        remoteScript: false,
        sleep: async () => {},
        random: () => `0.${++n}`,
      }),
    ],
    runtime: 'electron',
    sessionFetch,
    page: async () => page,
    onEvent: (_p, e) => events.push(e),
  });
  const r = await publisher.publish({
    noteId: 'n',
    doc,
    platforms: ['wechat'],
    common: {
      title: '写给公众号的长文',
      summary: '一段摘要',
      cover: 'https://cdn.starnote.app/cover.png',
    },
    perPlatform: { wechat: form },
    accounts: { wechat: account },
    content: { kind: 'article', doc, canonicalUrl: 'https://starnote.app/@me/abc' },
  });
  return { result: r.results.wechat!, events, page };
}

describe('wechat-mp adapter (个人号桌面端路线)', () => {
  it('is an electron adapter bound through the desktop session, keyed `wechat`', () => {
    expect(wechatMpElectronAdapter.key).toBe('wechat');
    expect(wechatMpElectronAdapter.runtime).toEqual(['electron']);
    expect(wechatMpElectronAdapter.binding).toMatchObject({ kind: 'cookie', store: 'desktop' });
    expect(wechatMpElectronAdapter.binding?.desktopSession?.success.urlMatch).toContain('token=');
  });

  it('checks the login, uploads images and cover, saves one 图文 and hands off', async () => {
    const { sessionFetch, calls } = routes();
    const page = mockPage();
    const { result } = await run(sessionFetch, { author: '陆德俊' }, page);
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      'GET https://mp.weixin.qq.com/',
      'POST https://mp.weixin.qq.com/cgi-bin/uploadimg2cdn', // a.png：按 URL 转存成功
      'POST https://mp.weixin.qq.com/cgi-bin/uploadimg2cdn', // broken.png：失败 →
      'POST https://mp.weixin.qq.com/cgi-bin/filetransfer', //   下载后上传，也失败
      'POST https://mp.weixin.qq.com/cgi-bin/uploadimg2cdn', // 封面：按 URL 失败 →
      'POST https://mp.weixin.qq.com/cgi-bin/filetransfer', //   下载后上传成功
      'POST https://mp.weixin.qq.com/cgi-bin/operate_appmsg',
    ]);
    expect(new Set(calls.map((c) => c.partition))).toEqual(
      new Set([sessionPartition('wechat', 'w1')])
    );
    expect(calls[1]!.init.urlencoded).toMatchObject({
      imgurl: 'https://cdn.starnote.app/a.png?x=1&y=2',
      t: 'ajax-editor-upload-img',
      token: '987654',
    });
    const up = calls[5]!;
    expect(up.url).toContain('ticket_id=gh_abc');
    expect(up.url).toContain('ticket=abc123');
    expect(up.url).toContain('svr_time=1760850000');
    expect(up.url).toContain('token=987654');
    expect(up.init.form!.file).toEqual({ kind: 'url', url: 'https://cdn.starnote.app/cover.png' });

    const save = calls[6]!;
    expect(save.url).toBe(
      'https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=987654&lang=zh_CN'
    );
    const body = save.init.urlencoded!;
    expect(body).toMatchObject({
      token: '987654',
      f: 'json',
      ajax: '1',
      count: '1',
      title0: '写给公众号的长文',
      author0: '陆德俊',
      digest0: '一段摘要',
      sourceurl0: 'https://starnote.app/@me/abc',
      cdn_url0: 'https://mmbiz.qpic.cn/cover/0',
      cdn_235_1_url0: 'https://mmbiz.qpic.cn/cover/0',
      fileid0: '',
      auto_gen_digest0: '0',
      need_open_comment0: '1',
    });
    // 公众号专用 HTML：内联样式，外链转文末参考链接，图片换成微信地址
    expect(body.content0).toContain('style=');
    expect(body.content0).toContain('参考链接');
    expect(body.content0).not.toContain('<a ');
    expect(body.content0).toContain('src="https://mmbiz.qpic.cn/a/0?wx_fmt=png"');
    expect(body.content0).not.toContain('cdn.starnote.app/a.png');
    expect(body.content0).toContain('src="https://cdn.starnote.app/broken.png"');

    expect(result).toMatchObject({
      ok: true,
      state: 'handoff',
      externalId: '2247483650',
      url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=2247483650&token=987654&lang=zh_CN',
    });
    expect(page.log).toEqual([['goto', result.url], ['show']]);
    const items = Object.fromEntries(result.report!.map((i) => [i.kind, i]));
    expect(items['handoff.pending']!.text).toBe(WECHAT_HANDOFF_TEXT);
    expect(items['image.rehosted']!.count).toBe(1);
    expect(items['image.failed']!.text).toContain('保留原图链接');
    expect(items['link.footnoted']!.count).toBe(1);
    // 不发表、不群发
    expect(calls.some((c) => /masssend|freepublish|publish/.test(c.url))).toBe(false);
    expect(items['image.rehosted']!.text).toContain('公众号素材库');
  });

  it('stops before uploading when the 后台 login expired, asking to scan again', async () => {
    const { sessionFetch, calls } = routes({
      'GET https://mp.weixin.qq.com/': () => ({ body: LOGIN_HTML }),
    });
    const { result, events } = await run(sessionFetch);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(WECHAT_RELOGIN_TEXT);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'relogin',
      actions: [{ kind: 'relogin' }],
    });
    expect(calls).toHaveLength(1);
  });

  it('maps an expired session while saving (ret 200003) to the same relogin message', async () => {
    const { sessionFetch } = routes({
      [SAVE]: () => ({ body: { base_resp: { ret: 200003, err_msg: 'invalid session' } } }),
    });
    const { result, events } = await run(sessionFetch);
    expect(result.error).toBe(WECHAT_RELOGIN_TEXT);
    expect(events.at(-1)).toMatchObject({ code: 'relogin' });
  });

  it('maps rate limits to retry and other errors to help', async () => {
    const limited = await run(
      routes({ [SAVE]: () => ({ body: { base_resp: { ret: 200013 } } }) }).sessionFetch
    );
    expect(limited.events.at(-1)).toMatchObject({
      code: 'rate_limited',
      actions: [{ kind: 'retry' }],
    });
    const other = await run(
      routes({ [SAVE]: () => ({ body: { base_resp: { ret: 64506, err_msg: '保存失败' } } }) })
        .sessionFetch
    );
    expect(other.events.at(-1)).toMatchObject({
      code: 'platform_error',
      actions: [{ kind: 'help' }, { kind: 'retry' }],
    });
  });

  it('replaces escaped image URLs in the HTML', () => {
    const html = '<img src="https://a/b.png?x=1&amp;y=2"><img src="https://a/c.png">';
    expect(
      replaceImageSrcs(html, new Map([['https://a/b.png?x=1&y=2', 'https://mmbiz.qpic.cn/1']]))
    ).toBe('<img src="https://mmbiz.qpic.cn/1"><img src="https://a/c.png">');
  });

  it('verify reads the account from the 后台 page', async () => {
    const ok = mockSession({ 'GET https://mp.weixin.qq.com/': () => ({ body: HOME_HTML }) });
    expect(await verify(ok.sessionFetch, 'w1')).toEqual({
      state: 'ok',
      uid: 'gh_abc',
      nickname: '辰记小号',
      avatar: 'https://wx.qlogo.cn/a.png',
    });
    const out = mockSession({ 'GET https://mp.weixin.qq.com/': () => ({ body: LOGIN_HTML }) });
    expect((await verify(out.sessionFetch, 'w1')).state).toBe('needs-relogin');
  });
});
