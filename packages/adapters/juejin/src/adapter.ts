/**
 * 页面操作层级（SPEC-r8「风控与真人化」）：默认 `draft`（SPEC-r15 §2）——用掘金网页自己的草稿接口建好草稿：标题、
 * Markdown（图片已转存）、分类、标签、50–100 字摘要、封面都填好（用户没选的由辰记预填，见 fields.ts），再在发布台里打开
 * 这篇草稿，你在掘金的发布弹窗里看到的已经是填好的，检查后点「发布」。草稿接口失败时退回 `prefill`：打开空白编辑器、
 * 预填标题和正文，分类、标签、摘要在弹窗里由你选。`review` / `publish` 是原有路径，保持原样。
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

import { guessJuejinCategory, tagKeywords } from './fields';
import { msg } from './i18n';
import { renderJuejin, withImages } from './render';
import { juejinSchema, juejinSchemaFor } from './schema';
import bundledSigned from './site-script.signed.json';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  PlatformStats,
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
    capabilities: { supportsUpdate: false, titleMax: 80, needsLogin: true },
    schema: juejinSchema,
    schemaFor: juejinSchemaFor,
    // 阅读、点赞、评论、收藏：掘金公开的文章详情接口，不需要登录（SPEC-r11 §7）
    statsRequires: 'none',
    fetchStats(externalId, ctx) {
      return fetchJuejinStats(externalId, ctx);
    },
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

      /** 默认：草稿接口建好草稿（全部字段填好），再在发布台里打开这篇草稿。 */
      const draftHandoff = async (): Promise<PublishOutput> => {
        const filled: string[] = [];
        let csrf = '';
        if (client.has('csrfToken'))
          csrf = String((await client.call('csrfToken')).result.token ?? '');
        const vars = { csrf };
        // 分类：表单选的，否则按内容猜（fields.ts）
        let categoryId = form.category_id;
        if (!categoryId && client.has('categories')) {
          const guess = guessJuejinCategory({ title: r.title, tags: common.tags, text: doc.text });
          const list = (await client.call('categories')).result.list;
          const hit = (Array.isArray(list) ? list : []).find(
            (c: any) => String(c.category_name ?? c.category?.category_name ?? '') === guess
          );
          if (hit) {
            categoryId = String(hit.category_id ?? hit.category?.category_id);
            filled.push(t.filledCategory(guess));
          }
        }
        // 标签：表单选的，否则用笔记标签 / 分类名在掘金标签库里搜，预填 1 个
        let tags = tagIds;
        if (!tags.length && client.has('searchTags')) {
          const guess = guessJuejinCategory({ title: r.title, tags: common.tags, text: doc.text });
          for (const keyword of tagKeywords(common.tags, guess)) {
            const list = (await client.call('searchTags', { vars, data: { keyword } })).result.list;
            const first = (Array.isArray(list) ? list : [])[0] as any;
            if (first) {
              tags = [String(first.tag_id)];
              filled.push(t.filledTag(String(first.tag?.tag_name ?? first.tag_name ?? keyword)));
              break;
            }
          }
        }
        filled.push(t.filledBrief([...r.brief].length));
        const fields = {
          title: r.title,
          categoryId: categoryId ?? '0',
          tagIds: tags,
          brief: r.brief,
        };
        ctx.emit({ type: 'progress', percent: 15, text: t.creating });
        const created = await client.call('createDraft', {
          vars,
          data: { ...fields, markdown: '' },
        });
        const id = String(created.result.id ?? '');
        if (!id)
          throw new PlatformSessionError('help', t.noArticleId, {
            helpUrl: script.urls.help,
            ...L,
          });
        const upload = async (url: string) => {
          const v = (await client.call('uploadImageByUrl', { vars, data: { url } })).result.url;
          return typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined;
        };
        const assetBase = opts.assetBase ? { assetBase: opts.assetBase } : {};
        let map = new Map<string, string>();
        if (r.images.length && client.has('uploadImageByUrl')) {
          ctx.emit({ type: 'progress', percent: 30, text: t.rehosting });
          const res = await rehostImages(r.images, upload, {
            label: name,
            ...L,
            ...assetBase,
            onProgress: (done, total) =>
              ctx.emit({
                type: 'progress',
                percent: 30 + Math.round((done / total) * 35),
                text: t.rehostProgress(done, total),
              }),
          });
          map = res.map;
          report.push(...res.report);
        }
        let cover: string | undefined;
        if (common.cover && client.has('uploadImageByUrl')) {
          cover = (
            await rehostImages([common.cover], upload, { label: t.cover(name), ...L, ...assetBase })
          ).map.get(common.cover);
          if (cover) filled.push(t.filledCover);
          else report.push({ kind: 'cover.failed', text: t.coverFailed, level: 'warn' });
        }
        ctx.emit({ type: 'progress', percent: 70, text: t.writingBody });
        await client.call('updateDraft', {
          vars,
          data: { id, ...fields, markdown: withImages(r, map), ...(cover ? { cover } : {}) },
        });
        report.push({ kind: 'fields.prefilled', text: t.fieldsPrefilled(filled), level: 'info' });
        ctx.emit({ type: 'progress', percent: 85, text: t.openingEditor });
        const editUrl = fillTemplate(script.urls.edit!, { id });
        const res = await handOffEditor(ctx, run, LABEL, { editorUrl: editUrl });
        report.push(...handoffReport(res, name, lang), {
          kind: 'handoff.pending',
          text: t.draftReady,
          level: 'notice',
        });
        ctx.emit({ type: 'progress', percent: 100, text: t.waitingPublish });
        return { url: editUrl, externalId: id, state: 'handoff', report };
      };

      if (form.mode === 'draft') {
        try {
          return await draftHandoff();
        } catch (e) {
          if (ctx.signal?.aborted) throw e;
          // 草稿接口不可用（改版、风控）：退回预填编辑器，分类、标签、摘要由用户在弹窗里选
          report.push({ kind: 'draft.fallback', text: t.draftFallback, level: 'notice' });
        }
      }

      if (form.mode === 'draft' || form.mode === 'prefill') {
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

/** 掘金文章的公开数据（阅读、点赞、评论、收藏）。`externalId` 是文章 id（`juejin.cn/post/<id>`）。 */
export async function fetchJuejinStats(
  externalId: string,
  ctx: { fetch?: typeof fetch; signal?: AbortSignal }
): Promise<PlatformStats | null> {
  const f = ctx.fetch ?? fetch;
  if (!/^\d+$/.test(externalId)) return null;
  const res = await f('https://api.juejin.cn/content_api/v1/article/detail?aid=2608', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ article_id: externalId }),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    err_no?: number;
    data?: { article_info?: Record<string, unknown> };
  };
  const info = json.err_no === 0 ? json.data?.article_info : undefined;
  if (!info) return null;
  const n = (k: string) => (typeof info[k] === 'number' ? (info[k] as number) : undefined);
  const out: PlatformStats = { fetchedAt: new Date().toISOString(), source: 'public' };
  const views = n('view_count');
  const likes = n('digg_count');
  const comments = n('comment_count');
  const favorites = n('collect_count');
  if (views !== undefined) out.views = views;
  if (likes !== undefined) out.likes = likes;
  if (comments !== undefined) out.comments = comments;
  if (favorites !== undefined) out.favorites = favorites;
  return out;
}
