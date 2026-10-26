/** 页面操作层级（SPEC-r8「风控与真人化」）：第 1 层：直接调公众号后台自己的接口（token / ticket 用同一会话取回首页 HTML 解析）；存好后打开图文编辑页，由你点「发表」。 */
import {
  bundledScript,
  defineAdapter,
  fillTemplate,
  handOffEditor,
  openSessionRun,
  PlatformSessionError,
  rehostImages,
  truncateText,
} from '@starnote/publish-core';

import { renderWechatMp, replaceImageSrcs } from './render';
import { wechatMpSchema } from './schema';
import bundledSigned from './site-script.signed.json';

import type {
  AdapterPreview,
  Adapter,
  BindingSpec,
  PublishOutput,
  ReportItem,
  RuntimeSupport,
  SessionAdapterOptions,
  SessionClient,
  SignedSiteScript,
  SiteScript,
  WechatOptions,
} from '@starnote/publish-core';

export const WECHAT_MP_SITE_SCRIPT = bundledSigned as SignedSiteScript;
const LABEL = '微信公众号';
export const WECHAT_RELOGIN_TEXT = '公众号需要重新扫码登录';
export const WECHAT_HANDOFF_TEXT = '已存进公众号后台，请在后台点「发表」，群发需管理员扫码确认';

/**
 * 个人号的桌面端路线：管理员在桌面端弹出的公众号登录页上用微信扫码（二维码在微信自己的页面上，辰记不读取），
 * 登录态只在 `persist:pub-wechat-<accountId>`。和知乎、掘金、CSDN 同一套登录窗口与站点脚本。
 */
export const wechatMpBinding: BindingSpec = {
  kind: 'cookie',
  store: 'desktop',
  helpUrl: 'https://mp.weixin.qq.com/',
  instructions: [
    '在辰记桌面端点「在桌面端登录微信公众号」',
    '桌面端弹出公众号自己的登录页，由管理员用微信扫码确认',
    '登录成功后窗口自动关闭；公众号后台的登录几天就会过期，过期后再扫一次码',
  ],
  checkEvery: 3600,
  desktopSession: bundledScript(WECHAT_MP_SITE_SCRIPT).session!,
};

export interface WechatMpAdapterOptions extends SessionAdapterOptions {
  runtimes?: RuntimeSupport[];
  /** Passed to `convertWechat` (accent, assetBase, code highlighting, divider mode…). */
  wechat?: WechatOptions;
  /** `random` / `t` request parameters; injectable for tests. */
  random?: () => string;
}

interface WxSession {
  token: string;
  ticket?: string;
  userName?: string;
  time?: string;
}

/** Reads the 后台 session (token…) from the home page; no token means the login expired. */
async function wxSession(client: SessionClient, script: SiteScript): Promise<WxSession> {
  const home = await client.call('home');
  const r = home.result;
  const token = typeof r.token === 'string' ? r.token : '';
  if (!/^\d+$/.test(token))
    throw new PlatformSessionError('relogin', WECHAT_RELOGIN_TEXT, { helpUrl: script.urls.help });
  return {
    token,
    ...(typeof r.ticket === 'string' ? { ticket: r.ticket } : {}),
    ...(typeof r.userName === 'string' ? { userName: r.userName } : {}),
    ...(typeof r.time === 'string' ? { time: r.time } : {}),
  };
}

/**
 * 公众号（个人号）over the desktop session: check the login → upload images and cover to the 素材库 →
 * save one 图文 into the 后台 (草稿箱) → hand off: the user presses「发表」(群发 needs the admin's scan).
 * We never publish or mass-send.
 */
export function createWechatMpAdapter(
  opts: WechatMpAdapterOptions = {}
): Adapter<typeof wechatMpSchema> {
  const random = opts.random ?? (() => String(Math.random()));
  const preview = (script: SiteScript) =>
    ((doc, _form, common = {}) => {
      const r = renderWechatMp(doc, common, script, opts.wechat);
      const report = [...r.report];
      if (r.images.length)
        report.push({
          kind: 'image.rehosted',
          text: `${r.images.length} 张图片会上传到公众号素材库`,
          count: r.images.length,
          level: 'info',
        });
      return { format: 'html', title: r.title, body: r.html, report } satisfies AdapterPreview;
    }) as NonNullable<Adapter<typeof wechatMpSchema>['preview']>;

  return defineAdapter({
    key: 'wechat',
    label: LABEL,
    runtimes: opts.runtimes ?? [
      {
        runtime: 'electron',
        mode: 'automation',
        needs: ['session'],
        note: '第 1 层：存进公众号后台，由你在后台点「发表」',
      },
    ],
    contentTypes: ['article'],
    binding: wechatMpBinding,
    capabilities: { supportsUpdate: false, titleMax: 64, coverRatio: 2.35, needsLogin: true },
    schema: wechatMpSchema,
    preview: preview(bundledScript(WECHAT_MP_SITE_SCRIPT)),
    async publish({ doc, form, common, ctx, content }): Promise<PublishOutput> {
      ctx.emit({ type: 'progress', percent: 5, text: '检查公众号登录状态' });
      const run = await openSessionRun(ctx, 'wechat', LABEL, WECHAT_MP_SITE_SCRIPT, opts);
      const { script, client } = run;
      try {
        const wx = await wxSession(client, script);
        const r = renderWechatMp(doc, common, script, {
          ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
          ...opts.wechat,
        });
        const report: ReportItem[] = [...r.report];
        ctx.emit({ type: 'report', items: report });

        let seq = 0;
        // 先按 URL 转存（不用下载）；失败再由桌面端下载后上传到素材库。
        const upload = async (url: string) => {
          if (client.has('uploadImageByUrl')) {
            try {
              const res = await client.call('uploadImageByUrl', {
                vars: { token: wx.token, random: random() },
                data: { url, token: wx.token },
              });
              const cdn = typeof res.result.url === 'string' ? res.result.url : undefined;
              if (cdn) return cdn;
            } catch (e) {
              if (e instanceof PlatformSessionError && e.kind !== 'help') throw e;
            }
          }
          const res = await client.call('uploadImage', {
            vars: {
              token: wx.token,
              ticket: wx.ticket ?? '',
              userName: wx.userName ?? '',
              time: wx.time ?? String(Math.floor(Date.now() / 1000)),
              seq: seq++,
              random: random(),
            },
            files: { file: { kind: 'url', url } },
          });
          return typeof res.result.url === 'string' ? res.result.url : undefined;
        };
        const assetBase = opts.assetBase ?? opts.wechat?.assetBase;
        ctx.emit({ type: 'progress', percent: 15, text: '上传图片到公众号素材库' });
        const images = await rehostImages(r.images, upload, {
          label: '公众号素材库',
          ...(assetBase ? { assetBase } : {}),
          onProgress: (done, total) =>
            ctx.emit({
              type: 'progress',
              percent: 15 + Math.round((done / total) * 50),
              text: `上传图片 ${done}/${total}`,
            }),
        });
        report.push(
          ...images.report.map((i) =>
            i.kind === 'image.failed'
              ? {
                  ...i,
                  text: `${i.count} 张图片上传到公众号素材库失败，已保留原图链接（公众号里外部图片通常显示不出来，请在后台替换）`,
                }
              : i
          )
        );

        let cover: { url: string } | undefined;
        const coverSrc =
          common.cover && /^https?:\/\//.test(common.cover) ? common.cover : undefined;
        if (coverSrc) {
          const c = await rehostImages([coverSrc], upload, { label: '公众号素材库（封面）' });
          const url = c.map.get(coverSrc);
          if (url) cover = { url };
        }
        if (!cover)
          report.push({
            kind: 'cover.missing',
            text: '没有设置封面：发表前请在公众号后台选一张封面',
            level: 'notice',
          });
        ctx.emit({ type: 'report', items: report });

        const authorMax = script.limits?.authorMax ?? 16;
        const author = form.author ? truncateText(form.author, authorMax).value : '';
        const sourceUrl =
          form.source_url ??
          // SPEC-r12 §5.3: 「阅读原文」 is clicked by readers: the tracking short link when given
          (content?.kind === 'article' ? content.trackingUrl || content.canonicalUrl : undefined) ??
          '';
        if (sourceUrl)
          report.push({ kind: 'canonical.set', text: '「阅读原文」指向辰记原文', level: 'info' });

        ctx.emit({ type: 'progress', percent: 75, text: '存进公众号后台' });
        const saved = await client.call('saveAppmsg', {
          vars: { token: wx.token },
          data: {
            token: wx.token,
            random: random(),
            title: r.title,
            author,
            digest: r.digest,
            autoDigest: r.digest ? '0' : '1',
            content: replaceImageSrcs(r.html, images.map),
            sourceUrl,
            openComment: form.open_comment ? '1' : '0',
            ...(cover ? { coverUrl: cover.url, coverUrl235: cover.url } : {}),
          },
        });
        const id = String(saved.result.id ?? '');
        if (!id)
          throw new PlatformSessionError('help', '公众号后台没有返回图文 id', {
            helpUrl: script.urls.help,
          });
        const editUrl = fillTemplate(script.urls.edit!, { id, token: wx.token });

        report.push({ kind: 'handoff.pending', text: WECHAT_HANDOFF_TEXT, level: 'notice' });
        // 发布台（或单个窗口）里打开图文编辑页，不再填写：正文已经由接口存好，由你点「发表」。
        await handOffEditor(ctx, run, LABEL, { editorUrl: editUrl });
        ctx.emit({ type: 'progress', percent: 100, text: '已存进公众号后台' });
        return { url: editUrl, externalId: id, state: 'handoff', report };
      } catch (e) {
        if (
          e instanceof PlatformSessionError &&
          e.kind === 'relogin' &&
          e.message !== WECHAT_RELOGIN_TEXT
        )
          throw new PlatformSessionError('relogin', WECHAT_RELOGIN_TEXT, {
            helpUrl: script.urls.help,
          });
        throw e;
      }
    },
  });
}
