/**
 * DEV (Forem API v1, ✅ developers.forem.com/api/v1): `POST /api/articles`, `PUT /api/articles/{id}`,
 * `GET /api/users/me`; auth header `api-key`. Body is Markdown (with liquid tags), up to 4 tags,
 * `canonical_url` back to the 辰记 original. Browser-safe: render + relay body only; 辰记's Python API holds the key and calls DEV (服务器代发).
 */
import {
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  normalizePostUrl,
} from '@starnote/publish-core';
import {
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitSummary,
  fitTags,
  fitTitle,
  guard,
  linkedImagesReport,
  num,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
  originLinkOf,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PlatformStats,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  StatsContext,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const DEVTO_API = 'https://dev.to/api';
/** Forem asks clients to pin the API version with this Accept header. */
export const DEVTO_ACCEPT = 'application/vnd.forem.api-v1+json';

export const DEVTO_LIMITS = {
  /** ✅ 「A comma-separated list of tags (up to 4 tags)」 */
  tags: 4,
  /** ⚠️ 待核实：Forem 模型校验 title ≤ 128（文档未写，源码经验值）。 */
  titleMax: 128,
  /** ⚠️ 待核实：description 用于卡片摘要，按 150 截断（文档未写）。 */
  descriptionMax: 150,
} as const;

/** DEV tags: lowercase alphanumerics only (no spaces, hyphens or non-ASCII) — ⚠️ 社区经验，文档未写字符集。 */
export function devtoTag(tag: string): string | null {
  const t = tag.toLowerCase().replace(/[^a-z0-9]/g, '');
  return t ? t.slice(0, 30) : null;
}

export const devtoSchema = z.object({
  /** false: saved as an unpublished draft on DEV (✅ `published` defaults to false there). */
  published: z.boolean().default(true).describe('直接公开'),
  series: z.string().trim().max(100, '系列名最多 100 字').optional().describe('系列'),
  set_canonical: z.boolean().default(true).describe('设置原文链接'),
  /** Defaults to the 辰记 original. */
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  /** Appends 「Originally published at …」 to the body. */
  origin_note: z.boolean().default(false).describe('文末注明原文'),
  organization_id: z.number().int().positive().optional().describe('组织 ID'),
  /** The DEV article id from an earlier publish: set it to update instead of creating. */
  external_id: z
    .string()
    .trim()
    .regex(/^\d+$/, '文章 ID 是数字')
    .optional()
    .describe('已发布文章 ID'),
});

export type DevtoForm = z.infer<typeof devtoSchema>;
export type DevtoFormInput = z.input<typeof devtoSchema>;

export interface DevtoCredentials {
  apiKey: string;
}

export const devtoKeyForm = z.object({
  api_key: z.string().trim().min(16, '请粘贴 DEV 设置页生成的 API key').describe('API key'),
});

export const devtoBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'devto',
  fields: ['api_key'],
  form: devtoKeyForm,
  createUrl: 'https://dev.to/settings/extensions',
  instructions: [
    '打开 DEV 的 Settings → Extensions，在 DEV Community API Keys 填一个名字（如 StarNote）生成 key',
    '复制 key，粘贴到这里并点「测试连接」',
    '不用时在同一页删除这个 key，绑定立即失效',
  ],
};

export interface DevtoArticleBody {
  article: {
    title: string;
    body_markdown: string;
    published: boolean;
    tags: string;
    canonical_url?: string;
    description?: string;
    main_image?: string;
    series?: string;
    organization_id?: number;
  };
}

export interface DevtoRendered {
  title: string;
  markdown: string;
  previewHtml: string;
  body: DevtoArticleBody;
  report: ReportItem[];
}

export interface DevtoRenderOptions {
  /** Resolves relative image / cover URLs. */
  assetBase?: string;
}

function absolute(url: string | undefined, base?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base || !/^\/|^\.\.?\//.test(url)) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

/** Pure: the Markdown, the request body and the predicted report. */
export function renderDevto(
  doc: Doc,
  form: DevtoForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: DevtoRenderOptions = {}
): DevtoRendered {
  const article = articleOf(doc, content);
  const rawTitle = common.title || article.doc.title || 'Untitled';
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'markdown',
      lang: article.lang,
      title: article.doc.title,
      math: 'devto-liquid',
      video: 'devto-liquid',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'DEV'
  );
  const title = fitTitle(rawTitle, DEVTO_LIMITS.titleMax, 'DEV');
  const summary = fitSummary(common.summary, DEVTO_LIMITS.descriptionMax, 'DEV');
  const tags = fitTags(common.tags, { max: DEVTO_LIMITS.tags, normalize: devtoTag }, 'DEV');
  const canonical = canonicalOf(form, article, 'DEV');
  const cover = absolute(common.cover, opts.assetBase);

  let markdown = degraded.body;
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('devto', 'DEV', content, common));
  if (form.origin_note && canonical.url) {
    const origin = originLinkOf(form, article, canonical.url);
    markdown += `\n\n---\n\n*Originally published at [${origin}](${origin}).*`;
    report.push({ kind: 'origin.note', text: '文末加上「Originally published at」原文链接' });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'DEV'),
    ...title.report,
    ...summary.report,
    ...tags.report,
    ...canonical.report
  );
  if (!form.published)
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: '以未公开状态保存到 DEV，检查后在 DEV 上点 Publish',
    });

  return {
    title: title.title,
    markdown,
    previewHtml: degraded.doc.portableHtml,
    body: {
      article: {
        title: title.title,
        body_markdown: markdown,
        published: form.published,
        tags: tags.tags.join(','),
        ...(canonical.url ? { canonical_url: canonical.url } : {}),
        ...(summary.summary ? { description: summary.summary } : {}),
        ...(cover ? { main_image: cover } : {}),
        ...(form.series ? { series: form.series } : {}),
        ...(form.organization_id ? { organization_id: form.organization_id } : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function devtoRef(links?: ErrorLinks): PlatformRef {
  return { key: 'devto', label: 'DEV', ...(links ? { links } : {}) };
}

/**
 * What 辰记's API sends to DEV (`app/services/relay_platforms.py`); the browser never holds the key.
 * verify: `GET /api/users/me` → `{id, username, name}`; publish: `POST /api/articles`, update: `PUT /api/articles/{id}`,
 * both with the relay body as is.
 */
export const DEVTO_REQUESTS = {
  verify: {
    method: 'GET',
    url: `${DEVTO_API}/users/me`,
    auth: 'api-key: <api_key>',
    accept: DEVTO_ACCEPT,
  },
  create: {
    method: 'POST',
    url: `${DEVTO_API}/articles`,
    auth: 'api-key: <api_key>',
    body: 'DevtoArticleBody',
  },
  update: {
    method: 'PUT',
    url: `${DEVTO_API}/articles/{id}`,
    auth: 'api-key: <api_key>',
    body: 'DevtoArticleBody',
  },
} as const satisfies Record<string, RequestDescription>;

/** What the browser posts to 辰记's API for DEV: the Forem request body as is. */
export function devtoRelayBody(r: DevtoRendered): DevtoArticleBody {
  return r.body;
}

/**
 * SPEC-r11 §7 ✅ `GET /api/articles/me/all` (`api-key`; the desktop's fetch adds it when the context has none):
 * page views, reactions and comments of the article with this id — or, for a pasted-back link (SPEC-r12 §1.1), with
 * this URL. ⚠️ 只取第一页 1000 篇。
 */
export async function fetchDevtoStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const key = ctx.credential?.api_key;
  const list = await readJson<Array<Record<string, unknown>>>(
    ctx,
    devtoRef(),
    `${DEVTO_API}/articles/me/all?per_page=1000`,
    { headers: { Accept: DEVTO_ACCEPT, ...(key ? { 'api-key': key } : {}) } }
  );
  const byUrl = isUrlExternalId(externalId) ? normalizePostUrl(externalId) : null;
  const a = list?.find((x) =>
    byUrl
      ? typeof x.url === 'string' && normalizePostUrl(x.url) === byUrl
      : String(x.id) === String(externalId)
  );
  if (!a) return null;
  return stats('official-api', {
    views: num(a.page_views_count),
    likes: num(a.public_reactions_count ?? a.positive_reactions_count),
    comments: num(a.comments_count),
  });
}

/* ---------------- adapter ---------------- */

export interface DevtoAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/**
 * Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/devto`), which
 * holds the key (服务器代发).
 */
export function createDevtoAdapter(opts: DevtoAdapterOptions = {}): Adapter<typeof devtoSchema> {
  const ref = devtoRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'devto',
    label: 'DEV',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: devtoBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: DEVTO_LIMITS.titleMax },
    schema: devtoSchema,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchDevtoStats(externalId, ctx);
    },
    preview(doc, form, common, content): AdapterPreview {
      const r = renderDevto(doc, form, common, content, renderOpts);
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous }) {
      const r = renderDevto(doc, form, common, content, renderOpts);
      return relayRequestOf(devtoRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderDevto(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '由服务器代发到 DEV' });
        const res = await relayPublish(ctx, ref, devtoRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.published ? 'published' : 'draft'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
