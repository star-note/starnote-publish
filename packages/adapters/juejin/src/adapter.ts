/**
 * 页面操作层级（SPEC-r8「风控与真人化」）：默认第 3 层——图片走掘金网页接口转存（第 1 层），再在发布台里打开掘金编辑器，
 * 填标题、粘贴 Markdown，分类、标签、摘要在掘金的发布弹窗里由你选，再点「发布」。`review` / `publish` 是原有路径，保持原样。
 */
import {
  asSessionPage,
  bundledScript,
  createSessionClient,
  defineAdapter,
  fillTemplate,
  HANDOFF_FILLED_TEXT,
  handOffEditor,
  handoffReport,
  openSessionRun,
  PlatformSessionError,
  rehostImages,
  sessionPartition,
} from '@starnote/publish-core';

import { renderJuejin, withImages } from './render';
import { juejinSchema } from './schema';
import bundledSigned from './site-script.signed.json';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  PublishOutput,
  ReportItem,
  RuntimeSupport,
  SessionAdapterOptions,
  SessionFetch,
  SignedSiteScript,
  SiteScript,
} from '@starnote/publish-core';

export const JUEJIN_SITE_SCRIPT = bundledSigned as SignedSiteScript;
const LABEL = '掘金';

export const juejinBinding: BindingSpec = {
  kind: 'cookie',
  store: 'desktop',
  helpUrl: 'https://juejin.cn/creator/home',
  instructions: [
    '在辰记桌面端点「在桌面端登录掘金」',
    '在弹出的掘金登录页里用任意方式登录，验证码由你本人完成',
    '登录成功后窗口自动关闭，登录状态只保存在这台电脑上',
  ],
  checkEvery: 6 * 3600,
  desktopSession: bundledScript(JUEJIN_SITE_SCRIPT).session!,
};

export interface JuejinAdapterOptions extends SessionAdapterOptions {
  runtimes?: RuntimeSupport[];
}

/** 掘金 over the desktop session: CSRF token → draft → images → body → publish (掘金 then reviews it). */
export function createJuejinAdapter(opts: JuejinAdapterOptions = {}): Adapter<typeof juejinSchema> {
  const preview = (script: SiteScript) =>
    ((doc, form, common = {}) => {
      const r = renderJuejin(doc, common, script, (form as { brief?: string }).brief);
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        report: r.report,
      } satisfies AdapterPreview;
    }) as NonNullable<Adapter<typeof juejinSchema>['preview']>;

  return defineAdapter({
    key: 'juejin',
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
    binding: juejinBinding,
    capabilities: { supportsUpdate: false, titleMax: 100, needsLogin: true },
    schema: juejinSchema,
    preview: preview(bundledScript(JUEJIN_SITE_SCRIPT)),
    async publish({ doc, form, common, ctx }): Promise<PublishOutput> {
      ctx.emit({ type: 'progress', percent: 5, text: '读取掘金站点脚本' });
      const run = await openSessionRun(ctx, 'juejin', LABEL, JUEJIN_SITE_SCRIPT, opts);
      const { script, client } = run;
      const r = renderJuejin(doc, common, script, form.brief);
      const report: ReportItem[] = [...r.report];
      const tagsMax = script.limits?.tagsMax ?? 3;
      const tagIds = (form.tag_ids ?? []).slice(0, tagsMax);
      if (tagIds.length < (form.tag_ids ?? []).length)
        report.push({
          kind: 'tags.trimmed',
          text: `掘金最多 ${tagsMax} 个标签，多出的已去掉`,
          level: 'notice',
        });
      ctx.emit({ type: 'report', items: report });

      if (form.mode === 'prefill') {
        // 默认：图片先转存（第 1 层，接口不可用时保留原链接），再在发布台里预填掘金编辑器，由你点「发布」（第 3 层）。
        let csrfToken = '';
        if (client.has('csrfToken'))
          csrfToken = String((await client.call('csrfToken')).result.token ?? '');
        let images = { map: new Map<string, string>(), report: [] as ReportItem[] };
        if (r.images.length && client.has('uploadImageByUrl')) {
          ctx.emit({ type: 'progress', percent: 20, text: '转存图片到掘金' });
          images = await rehostImages(
            r.images,
            async (url) => {
              const v = (
                await client.call('uploadImageByUrl', { vars: { csrf: csrfToken }, data: { url } })
              ).result.url;
              return typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined;
            },
            {
              label: LABEL,
              ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
              onProgress: (done, total) =>
                ctx.emit({
                  type: 'progress',
                  percent: 20 + Math.round((done / total) * 50),
                  text: `转存图片 ${done}/${total}`,
                }),
            }
          );
        }
        report.push(...images.report);
        report.push({
          kind: 'fields.manual',
          text: `发布时请在掘金弹窗里选分类和标签，摘要可用：${r.brief}`,
          level: 'notice',
        });
        ctx.emit({ type: 'progress', percent: 80, text: '打开掘金编辑器并填好内容' });
        const editorUrl = script.urls.write!;
        const res = await handOffEditor(ctx, run, LABEL, {
          editorUrl,
          prefill: { title: r.title, text: withImages(r, images.map) },
        });
        report.push(...handoffReport(res, LABEL), {
          kind: 'handoff.pending',
          text: HANDOFF_FILLED_TEXT,
          level: 'notice',
        });
        ctx.emit({ type: 'progress', percent: 100, text: '等你在窗口中发布' });
        return { url: editorUrl, state: 'handoff', report };
      }

      let csrf = '';
      if (client.has('csrfToken')) {
        csrf = String((await client.call('csrfToken')).result.token ?? '');
        if (!csrf)
          ctx.emit({ type: 'log', level: 'warn', text: '没有拿到掘金的 CSRF token，继续尝试' });
      }
      const vars = { csrf };
      const fields = {
        title: r.title,
        categoryId: form.category_id ?? '0',
        tagIds,
        brief: r.brief,
      };

      ctx.emit({ type: 'progress', percent: 15, text: '在掘金创建文章' });
      const created = await client.call('createDraft', { vars, data: { ...fields, markdown: '' } });
      const id = String(created.result.id ?? '');
      if (!id)
        throw new PlatformSessionError('help', '掘金没有返回文章 id', {
          helpUrl: script.urls.help,
        });
      const editUrl = fillTemplate(script.urls.edit!, { id });

      const canUpload = client.has('uploadImageByUrl');
      const upload = async (url: string) => {
        const v = (await client.call('uploadImageByUrl', { vars, data: { url } })).result.url;
        return typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined;
      };
      const assetBase = opts.assetBase ? { assetBase: opts.assetBase } : {};
      let map = new Map<string, string>();
      if (r.images.length && canUpload) {
        ctx.emit({ type: 'progress', percent: 25, text: '转存图片到掘金' });
        const res = await rehostImages(r.images, upload, {
          label: LABEL,
          ...assetBase,
          onProgress: (done, total) =>
            ctx.emit({
              type: 'progress',
              percent: 25 + Math.round((done / total) * 35),
              text: `转存图片 ${done}/${total}`,
            }),
        });
        map = res.map;
        report.push(...res.report);
      } else if (r.images.length) {
        report.push({
          kind: 'image.failed',
          text: `${r.images.length} 张图片暂时不能转存到掘金，已保留原图链接`,
          count: r.images.length,
          level: 'warn',
        });
      }
      let cover: string | undefined;
      if (common.cover && canUpload) {
        cover = (
          await rehostImages([common.cover], upload, { label: `${LABEL}（封面）`, ...assetBase })
        ).map.get(common.cover);
        if (!cover)
          report.push({
            kind: 'cover.failed',
            text: '封面转存失败，文章没有设置封面',
            level: 'warn',
          });
      }
      ctx.emit({ type: 'report', items: report });

      ctx.emit({ type: 'progress', percent: 65, text: '写入正文' });
      await client.call('updateDraft', {
        vars,
        data: { id, ...fields, markdown: withImages(r, map), ...(cover ? { cover } : {}) },
      });

      if (form.mode === 'review') {
        report.push({
          kind: 'handoff.pending',
          text: '文章已写入掘金编辑器，请检查后点「发布」',
          level: 'notice',
        });
        const page = ctx.page ? asSessionPage(await ctx.page(run.partition)) : null;
        if (page) {
          await page.goto(editUrl);
          await page.show();
        }
        return { url: editUrl, externalId: id, state: 'handoff', report };
      }

      ctx.emit({ type: 'progress', percent: 85, text: '提交发布' });
      const published = await client.call('publish', { vars, data: { draftId: id } });
      const articleId = String(published.result.articleId ?? '');
      if (!articleId || articleId === '0')
        throw new PlatformSessionError('help', '掘金没有返回文章 id', {
          helpUrl: script.urls.help,
        });
      report.push({
        kind: 'review.pending',
        text: '掘金会先审核，审核通过后文章才对外可见',
        level: 'info',
      });
      ctx.emit({ type: 'progress', percent: 100, text: '已提交，等待掘金审核' });
      return {
        url: fillTemplate(script.urls.article!, { id: articleId }),
        externalId: articleId,
        state: 'pending-review',
        report,
      };
    },
  });
}

/** 掘金分类（发布表单的必填项），用账号的会话读取。 */
export async function juejinCategories(
  sessionFetch: SessionFetch,
  accountId: string,
  script: SiteScript = bundledScript(JUEJIN_SITE_SCRIPT)
): Promise<Array<{ id: string; name: string }>> {
  const client = createSessionClient({
    script,
    partition: sessionPartition('juejin', accountId),
    sessionFetch,
    label: LABEL,
  });
  const list = (await client.call('categories')).result.list;
  return (Array.isArray(list) ? list : []).map((c: any) => ({
    id: String(c.category_id),
    name: String(c.category_name ?? c.category?.category_name ?? ''),
  }));
}

/** 按关键词搜索掘金标签。 */
export async function juejinSearchTags(
  sessionFetch: SessionFetch,
  accountId: string,
  keyword: string,
  script: SiteScript = bundledScript(JUEJIN_SITE_SCRIPT)
): Promise<Array<{ id: string; name: string }>> {
  const client = createSessionClient({
    script,
    partition: sessionPartition('juejin', accountId),
    sessionFetch,
    label: LABEL,
  });
  let csrf = '';
  if (client.has('csrfToken')) csrf = String((await client.call('csrfToken')).result.token ?? '');
  const list = (await client.call('searchTags', { vars: { csrf }, data: { keyword } })).result.list;
  return (Array.isArray(list) ? list : []).map((t: any) => ({
    id: String(t.tag_id),
    name: String(t.tag?.tag_name ?? t.tag_name ?? ''),
  }));
}
