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
  handoffFilledText,
  handoffReport,
  localizedLabel,
  openSessionRun,
  PlatformSessionError,
  rehostImages,
  sessionPartition,
} from '@starnote/publish-core';

import { msg } from './i18n';
import { renderJuejin, withImages } from './render';
import { juejinSchema, juejinSchemaFor } from './schema';
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
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
  checkEvery: 6 * 3600,
  desktopSession: bundledScript(JUEJIN_SITE_SCRIPT).session!,
};

export interface JuejinAdapterOptions extends SessionAdapterOptions {
  runtimes?: RuntimeSupport[];
}

/** 掘金 over the desktop session: CSRF token → draft → images → body → publish (掘金 then reviews it). */
export function createJuejinAdapter(opts: JuejinAdapterOptions = {}): Adapter<typeof juejinSchema> {
  const preview = (script: SiteScript) =>
    ((doc, form, common = {}, _content, popts) => {
      const r = renderJuejin(doc, common, script, (form as { brief?: string }).brief, popts?.lang);
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
        note: msg('zh-CN').runtimeNote,
        notes: { 'zh-TW': msg('zh-TW').runtimeNote, en: msg('en').runtimeNote },
      },
    ],
    contentTypes: ['article'],
    binding: juejinBinding,
    capabilities: { supportsUpdate: false, titleMax: 100, needsLogin: true },
    schema: juejinSchema,
    schemaFor: juejinSchemaFor,
    preview: preview(bundledScript(JUEJIN_SITE_SCRIPT)),
    async publish({ doc, form, common, ctx }): Promise<PublishOutput> {
      const lang = ctx.lang;
      const t = msg(lang);
      const name = localizedLabel('juejin', LABEL, lang);
      const L = lang ? { lang } : {};
      ctx.emit({ type: 'progress', percent: 5, text: t.readScript });
      const run = await openSessionRun(ctx, 'juejin', LABEL, JUEJIN_SITE_SCRIPT, opts);
      const { script, client } = run;
      const r = renderJuejin(doc, common, script, form.brief, lang);
      const report: ReportItem[] = [...r.report];
      const tagsMax = script.limits?.tagsMax ?? 3;
      const tagIds = (form.tag_ids ?? []).slice(0, tagsMax);
      if (tagIds.length < (form.tag_ids ?? []).length)
        report.push({
          kind: 'tags.trimmed',
          text: t.tagsTrimmed(tagsMax),
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
          ctx.emit({ type: 'progress', percent: 20, text: t.rehosting });
          images = await rehostImages(
            r.images,
            async (url) => {
              const v = (
                await client.call('uploadImageByUrl', { vars: { csrf: csrfToken }, data: { url } })
              ).result.url;
              return typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined;
            },
            {
              label: name,
              ...L,
              ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
              onProgress: (done, total) =>
                ctx.emit({
                  type: 'progress',
                  percent: 20 + Math.round((done / total) * 50),
                  text: t.rehostProgress(done, total),
                }),
            }
          );
        }
        report.push(...images.report);
        report.push({
          kind: 'fields.manual',
          text: t.fieldsManual(r.brief),
          level: 'notice',
        });
        ctx.emit({ type: 'progress', percent: 80, text: t.openingEditor });
        const editorUrl = script.urls.write!;
        const res = await handOffEditor(ctx, run, LABEL, {
          editorUrl,
          prefill: { title: r.title, text: withImages(r, images.map) },
        });
        report.push(...handoffReport(res, name, lang), {
          kind: 'handoff.pending',
          text: lang ? handoffFilledText(lang) : HANDOFF_FILLED_TEXT,
          level: 'notice',
        });
        ctx.emit({ type: 'progress', percent: 100, text: t.waitingPublish });
        return { url: editorUrl, state: 'handoff', report };
      }

      let csrf = '';
      if (client.has('csrfToken')) {
        csrf = String((await client.call('csrfToken')).result.token ?? '');
        if (!csrf) ctx.emit({ type: 'log', level: 'warn', text: t.noCsrf });
      }
      const vars = { csrf };
      const fields = {
        title: r.title,
        categoryId: form.category_id ?? '0',
        tagIds,
        brief: r.brief,
      };

      ctx.emit({ type: 'progress', percent: 15, text: t.creating });
      const created = await client.call('createDraft', { vars, data: { ...fields, markdown: '' } });
      const id = String(created.result.id ?? '');
      if (!id)
        throw new PlatformSessionError('help', t.noArticleId, {
          helpUrl: script.urls.help,
          ...L,
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
        ctx.emit({ type: 'progress', percent: 25, text: t.rehosting });
        const res = await rehostImages(r.images, upload, {
          label: name,
          ...L,
          ...assetBase,
          onProgress: (done, total) =>
            ctx.emit({
              type: 'progress',
              percent: 25 + Math.round((done / total) * 35),
              text: t.rehostProgress(done, total),
            }),
        });
        map = res.map;
        report.push(...res.report);
      } else if (r.images.length) {
        report.push({
          kind: 'image.failed',
          text: t.imagesKept(r.images.length),
          count: r.images.length,
          level: 'warn',
        });
      }
      let cover: string | undefined;
      if (common.cover && canUpload) {
        cover = (
          await rehostImages([common.cover], upload, {
            label: t.cover(name),
            ...L,
            ...assetBase,
          })
        ).map.get(common.cover);
        if (!cover)
          report.push({
            kind: 'cover.failed',
            text: t.coverFailed,
            level: 'warn',
          });
      }
      ctx.emit({ type: 'report', items: report });

      ctx.emit({ type: 'progress', percent: 65, text: t.writingBody });
      await client.call('updateDraft', {
        vars,
        data: { id, ...fields, markdown: withImages(r, map), ...(cover ? { cover } : {}) },
      });

      if (form.mode === 'review') {
        report.push({
          kind: 'handoff.pending',
          text: t.reviewInEditor,
          level: 'notice',
        });
        const page = ctx.page ? asSessionPage(await ctx.page(run.partition)) : null;
        if (page) {
          await page.goto(editUrl);
          await page.show();
        }
        return { url: editUrl, externalId: id, state: 'handoff', report };
      }

      ctx.emit({ type: 'progress', percent: 85, text: t.submitting });
      const published = await client.call('publish', { vars, data: { draftId: id } });
      const articleId = String(published.result.articleId ?? '');
      if (!articleId || articleId === '0')
        throw new PlatformSessionError('help', t.noArticleId, {
          helpUrl: script.urls.help,
          ...L,
        });
      report.push({
        kind: 'review.pending',
        text: t.reviewPending,
        level: 'info',
      });
      ctx.emit({ type: 'progress', percent: 100, text: t.submitted });
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
