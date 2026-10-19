/**
 * 页面操作层级（SPEC-r8「风控与真人化」）：默认第 3 层——图片走知乎网页接口转存（第 1 层），再在发布台里打开知乎编辑器，
 * 填标题、粘贴正文，由你点「发布」。`review` / `publish` 是原有的第 1 层路径，保持原样。
 */
import {
  asSessionPage,
  bundledScript,
  defineAdapter,
  fillTemplate,
  HANDOFF_FILLED_TEXT,
  handOffEditor,
  handoffReport,
  openSessionRun,
  PlatformSessionError,
  rehostImages,
} from '@starnote/publish-core';

import { renderZhihu, withImages } from './render';
import { zhihuSchema } from './schema';
import bundledSigned from './site-script.signed.json';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  PublishOutput,
  ReportItem,
  RuntimeSupport,
  SessionAdapterOptions,
  SignedSiteScript,
  SiteScript,
} from '@starnote/publish-core';
import type { ZhihuForm } from './schema';

export const ZHIHU_SITE_SCRIPT = bundledSigned as SignedSiteScript;
const LABEL = '知乎';

/** Desktop login state, kept only in `persist:pub-zhihu-<accountId>`. */
export const zhihuBinding: BindingSpec = {
  kind: 'cookie',
  store: 'desktop',
  helpUrl: 'https://www.zhihu.com/creator',
  instructions: [
    '在辰记桌面端点「在桌面端登录知乎」',
    '在弹出的知乎登录页里用任意方式登录（扫码、短信、密码均可，验证码由你本人完成）',
    '登录成功后窗口自动关闭，登录状态只保存在这台电脑上',
  ],
  checkEvery: 6 * 3600,
  desktopSession: bundledScript(ZHIHU_SITE_SCRIPT).session!,
};

export interface ZhihuAdapterOptions extends SessionAdapterOptions {
  runtimes?: RuntimeSupport[];
  /** Trace id for the publish call (default `<ms>,<random uuid>`). */
  traceId?: () => string;
}

function randomUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

function previewOf(script: SiteScript) {
  return (
    doc: Parameters<NonNullable<Adapter['preview']>>[0],
    _form: ZhihuForm,
    common: Parameters<NonNullable<Adapter['preview']>>[2] = {}
  ): AdapterPreview => {
    const r = renderZhihu(doc, common, script);
    const report = [...r.report];
    if (r.images.length)
      report.push({
        kind: 'image.rehosted',
        text: `${r.images.length} 张图片会上传到知乎`,
        count: r.images.length,
        level: 'info',
      });
    return { format: 'html', title: r.title, body: r.html, report };
  };
}

/** 知乎 over the desktop session: draft → images → body → topics → publish (or hand-off to the editor). */
export function createZhihuAdapter(opts: ZhihuAdapterOptions = {}): Adapter<typeof zhihuSchema> {
  return defineAdapter({
    key: 'zhihu',
    label: LABEL,
    runtimes: opts.runtimes ?? [
      {
        runtime: 'electron',
        mode: 'automation',
        needs: ['session'],
        note: '第 1 层：平台网页自己的接口',
      },
    ],
    contentTypes: ['article'],
    binding: zhihuBinding,
    capabilities: { supportsUpdate: false, titleMax: 100, needsLogin: true },
    schema: zhihuSchema,
    prefill(doc, ctx) {
      const topics = [...(ctx.tags ?? []), ...(ctx.keywords ?? [])].filter(Boolean).slice(0, 3);
      return topics.length ? { topics } : {};
    },
    preview: previewOf(bundledScript(ZHIHU_SITE_SCRIPT)),
    async publish({ doc, form, common, ctx }): Promise<PublishOutput> {
      ctx.emit({ type: 'progress', percent: 5, text: '读取知乎站点脚本' });
      const run = await openSessionRun(ctx, 'zhihu', LABEL, ZHIHU_SITE_SCRIPT, opts);
      const { script, client } = run;
      const r = renderZhihu(doc, common, script);
      const report: ReportItem[] = [...r.report];
      ctx.emit({ type: 'report', items: report });

      if (form.mode === 'prefill') {
        // 默认：图片先转存到知乎（第 1 层），再在发布台里打开编辑器预填，由你点「发布」（第 3 层）。
        const upload = async (url: string) =>
          String((await client.call('uploadImageByUrl', { data: { url } })).result.url ?? '') ||
          undefined;
        ctx.emit({ type: 'progress', percent: 20, text: '上传图片到知乎' });
        const images = await rehostImages(r.images, upload, {
          label: LABEL,
          ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
          onProgress: (done, total) =>
            ctx.emit({
              type: 'progress',
              percent: 20 + Math.round((done / total) * 50),
              text: `上传图片 ${done}/${total}`,
            }),
        });
        report.push(...images.report);
        if (common.cover)
          report.push({ kind: 'cover.manual', text: '封面请在知乎编辑器里设置', level: 'notice' });
        if (form.topics.length)
          report.push({
            kind: 'tags.manual',
            text: `发布时请选择话题：${form.topics.join('、')}`,
            level: 'notice',
          });
        ctx.emit({ type: 'progress', percent: 80, text: '打开知乎编辑器并填好内容' });
        const editorUrl = script.urls.write!;
        const res = await handOffEditor(ctx, run, LABEL, {
          editorUrl,
          prefill: { title: r.title, html: withImages(r, images.map, script), text: doc.text },
        });
        report.push(...handoffReport(res, LABEL), {
          kind: 'handoff.pending',
          text: HANDOFF_FILLED_TEXT,
          level: 'notice',
        });
        ctx.emit({ type: 'progress', percent: 100, text: '等你在窗口中发布' });
        return { url: editorUrl, state: 'handoff', report };
      }

      ctx.emit({ type: 'progress', percent: 15, text: '在知乎创建文章' });
      const created = await client.call('createDraft', { data: { title: r.title, html: '' } });
      const id = String(created.result.id ?? '');
      if (!id)
        throw new PlatformSessionError('help', '知乎没有返回文章 id', {
          helpUrl: script.urls.help,
        });
      const editUrl = fillTemplate(script.urls.edit!, { id });

      const upload = async (url: string) =>
        String((await client.call('uploadImageByUrl', { data: { url } })).result.url ?? '') ||
        undefined;
      ctx.emit({ type: 'progress', percent: 25, text: '上传图片到知乎' });
      const images = await rehostImages(r.images, upload, {
        label: LABEL,
        ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
        onProgress: (done, total) =>
          ctx.emit({
            type: 'progress',
            percent: 25 + Math.round((done / total) * 35),
            text: `上传图片 ${done}/${total}`,
          }),
      });
      report.push(...images.report);
      let cover: string | undefined;
      if (common.cover) {
        const c = await rehostImages([common.cover], upload, {
          label: `${LABEL}（封面）`,
          ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
        });
        cover = c.map.get(common.cover);
        if (!cover)
          report.push({
            kind: 'cover.failed',
            text: '封面上传失败，文章没有设置封面',
            level: 'warn',
          });
      }
      ctx.emit({ type: 'report', items: report });

      ctx.emit({ type: 'progress', percent: 65, text: '写入正文' });
      await client.call('updateDraft', {
        vars: { id },
        data: {
          title: r.title,
          html: withImages(r, images.map, script),
          ...(cover ? { cover } : {}),
        },
      });

      const topics: string[] = [];
      for (const keyword of form.topics.slice(0, script.limits?.topicsMax ?? 3)) {
        const found = await client.call('searchTopics', { vars: { keyword } });
        const topic = found.result.first as Record<string, unknown> | undefined;
        if (!topic) continue;
        await client.call('attachTopic', { vars: { id }, data: topic });
        topics.push(String(found.result.firstName ?? keyword));
      }
      if (form.topics.length && topics.length < form.topics.length)
        report.push({
          kind: 'tags.mapped',
          text: `话题按知乎话题库匹配：${topics.join('、') || '没有匹配到'}`,
          level: 'notice',
          samples: form.topics,
        });

      const handoff = async (why: string): Promise<PublishOutput> => {
        report.push({ kind: 'handoff.pending', text: why, level: 'notice' });
        const page = ctx.page ? asSessionPage(await ctx.page(run.partition)) : null;
        if (page) {
          await page.goto(editUrl);
          await page.show();
        }
        return { url: editUrl, externalId: id, state: 'handoff', report };
      };

      if (form.mode === 'review')
        return handoff('文章已写入知乎编辑器，请检查后在编辑器里点「发布」');
      if (!topics.length)
        return handoff(
          '知乎发布前需要选择至少一个话题：文章已写入知乎编辑器，请选好话题后点「发布」'
        );

      ctx.emit({ type: 'progress', percent: 85, text: '发布到知乎' });
      try {
        await client.call('publish', {
          data: { draftId: id, traceId: opts.traceId?.() ?? `${Date.now()},${randomUuid()}` },
        });
      } catch (e) {
        if (e instanceof PlatformSessionError && e.kind === 'help')
          return handoff(
            `知乎没有接受自动发布（${e.message}）：文章已写入编辑器，请在编辑器里点「发布」`
          );
        throw e;
      }
      ctx.emit({ type: 'progress', percent: 100, text: '已发布' });
      return {
        url: fillTemplate(script.urls.article!, { id }),
        externalId: id,
        state: 'published',
        report,
      };
    },
  });
}
