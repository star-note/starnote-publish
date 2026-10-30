/**
 * 博客园 (cnblogs) over MetaWeblog with a personal access token (✅ 令牌页原文「个人访问令牌可用于 Open API，VSCode 插件，
 * MetaWeblog 客户端」): `https://rpc.cnblogs.com/metaweblog/{blog_app}`, user name = login name, password = the token.
 * The body is Markdown (`[Markdown]` in `categories`); personal categories are `[随笔分类]名称`, the front page is
 * `[发布至博客园首页]`. Stats come from the Open API (`api.cnblogs.com`, read-only, Bearer token).
 *
 * Browser-safe: render + relay body only; 辰记's Python API holds the token and makes the XML-RPC calls (服务器代发).
 */
import {
  byLang,
  defineAdapter,
  isUrlExternalId,
  localizedLabel,
  mediaReport,
  mergeReports,
  normalizePostUrl,
} from '@starnote/publish-core';
import {
  articleOf,
  CLIENT_RELAY,
  degradeArticle,
  fitSummary,
  fitTags,
  fitTitle,
  guard,
  num,
  originLinkOf,
  originNoteMarkdown,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
} from '@starnote/publish-kit';
import { z } from 'zod';

import { msg } from './i18n';

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
  SdkLang,
  StatsContext,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

const LABEL = '博客园';
export const CNBLOGS_RPC = 'https://rpc.cnblogs.com/metaweblog';
export const CNBLOGS_OPEN_API = 'https://api.cnblogs.com';

export const CNBLOGS_LIMITS = {
  /** 注册表规则 `title.max` */
  titleMax: 100,
  /** 注册表规则 `summary.max` */
  excerptMax: 300,
  /** ⚠️ 待实测：网页编辑器没写上限，按 10 个收 */
  tags: 10,
  /** ⚠️ 待实测 */
  categories: 5,
} as const;

/** `categories` entries with a meaning on 博客园 (⚠️ 公开资料，待实测). */
export const CNBLOGS_MARKDOWN = '[Markdown]';
export const CNBLOGS_HOME = '[发布至博客园首页]';
export const cnblogsCategory = (name: string) => `[随笔分类]${name}`;

/** The form in a language (SPEC-r14 B5). */
export const cnblogsSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** false: saved as a draft on 博客园 (MetaWeblog `publish = false`). */
    published: z.boolean().default(true).describe(t.published),
    /** Personal categories (随笔分类): created on 博客园 when missing. */
    categories: z
      .array(z.string().trim().min(1).max(50))
      .max(CNBLOGS_LIMITS.categories, t.categoriesMax)
      .default([])
      .describe(t.categories),
    /** 投首页 is reviewed by 博客园: the user's choice, off by default. */
    home: z.boolean().default(false).describe(t.home),
    /** 博客园 has no canonical field: an optional 「本文首发于辰记」 line instead. */
    origin_note: z.boolean().default(false).describe(t.originNote),
    /** The 博客园 post id from an earlier publish: set it to update instead of creating. */
    external_id: z.string().trim().regex(/^\d+$/, t.idDigits).optional().describe(t.externalId),
  });
});

export const cnblogsSchema = cnblogsSchemaFor('zh-CN');

export type CnblogsForm = z.infer<typeof cnblogsSchema>;
export type CnblogsFormInput = z.input<typeof cnblogsSchema>;

export const cnblogsKeyFormFor = byLang((lang) => {
  const k = msg(lang).key;
  return z.object({
    blog_app: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{2,50}$/, k.blogAppHint)
      .describe(k.blogApp),
    username: z.string().trim().min(1, k.usernameHint).describe(k.username),
    token: z.string().trim().min(16, k.tokenHint).describe(k.token),
  });
});

export const cnblogsKeyForm = cnblogsKeyFormFor('zh-CN');

export const cnblogsBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'cnblogs',
  fields: ['blog_app', 'username', 'token'],
  form: cnblogsKeyForm,
  formFor: cnblogsKeyFormFor,
  createUrl: 'https://account.cnblogs.com/settings/tokens',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

/** MetaWeblog `Post` (the fields we set; `dateCreated` is set by the server at send time). */
export interface CnblogsPost {
  title: string;
  /** Markdown. */
  description: string;
  categories: string[];
  /** Tags, comma-separated. */
  mt_keywords: string;
  mt_excerpt?: string;
}

/**
 * What the browser posts to 辰记's API for 博客园: the post, whether to publish (false = draft), and the images the
 * server uploads first (`metaWeblog.newMediaObject`), rewriting their URLs in `description`.
 */
export interface CnblogsRelayBody {
  post: CnblogsPost;
  publish: boolean;
  images: string[];
}

export interface CnblogsRendered {
  title: string;
  markdown: string;
  previewHtml: string;
  post: CnblogsPost;
  images: string[];
  report: ReportItem[];
}

export interface CnblogsRenderOptions {
  /** Resolves relative image URLs. */
  assetBase?: string;
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang;
}

/** Pure: the Markdown, the MetaWeblog post and the predicted report. */
export function renderCnblogs(
  doc: Doc,
  form: CnblogsForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: CnblogsRenderOptions = {}
): CnblogsRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const t = msg(lang);
  const name = localizedLabel('cnblogs', LABEL, lang);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'markdown',
      lang: article.lang,
      title: article.doc.title,
      // 博客园的 Markdown 支持 MathJax（`$…$`）
      math: 'dollar',
      video: 'link',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    name,
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || '无标题',
    CNBLOGS_LIMITS.titleMax,
    name,
    lang
  );
  const excerpt = fitSummary(common.summary, CNBLOGS_LIMITS.excerptMax, name, lang);
  const tags = fitTags(common.tags, { max: CNBLOGS_LIMITS.tags }, name, lang);
  const images = degraded.doc.images.filter((s) => /^https?:\/\//i.test(s));

  let markdown = degraded.body;
  const report: ReportItem[] = [{ kind: 'format.markdown', text: t.markdown }];
  report.push(...mediaReport('cnblogs', LABEL, content, common, lang));
  const canonical = article.canonicalUrl;
  if (form.origin_note && canonical) {
    markdown += originNoteMarkdown(originLinkOf({}, article, canonical), article.lang);
    report.push({ kind: 'origin.note', text: t.originNote });
  }
  if (images.length)
    report.push({
      kind: 'image.rehosted',
      text: t.imagesWillUpload(images.length),
      count: images.length,
    });
  report.push(...degraded.report, ...title.report, ...excerpt.report, ...tags.report);
  if (form.home) report.push({ kind: 'home.submitted', level: 'notice', text: t.home });
  if (!form.published) report.push({ kind: 'draft.only', level: 'notice', text: t.draftOnly });
  report.push({ kind: 'rules.tech-only', level: 'info', text: t.techOnly });

  const categories = [
    CNBLOGS_MARKDOWN,
    ...[...new Set(form.categories)].map(cnblogsCategory),
    ...(form.home ? [CNBLOGS_HOME] : []),
  ];
  return {
    title: title.title,
    markdown,
    previewHtml: degraded.doc.portableHtml,
    images,
    post: {
      title: title.title,
      description: markdown,
      categories,
      mt_keywords: tags.tags.join(','),
      ...(excerpt.summary ? { mt_excerpt: excerpt.summary } : {}),
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function cnblogsRef(links?: ErrorLinks): PlatformRef {
  return { key: 'cnblogs', label: LABEL, ...(links ? { links } : {}) };
}

/**
 * What 辰记's API sends to 博客园 (`app/services/relay_platforms.py`); the browser never holds the token. XML-RPC
 * (`text/xml`) to `{CNBLOGS_RPC}/{blog_app}` with `username` = login name and `password` = the token:
 * - verify: `blogger.getUsersBlogs(appKey, username, password)` → `[{blogid, url, blogName}]`;
 * - images: `metaWeblog.newMediaObject(blogid, username, password, {name, type, bits})` → `{url}`, then rewrite;
 * - personal categories missing on the blog: `wp.newCategory(blogid, username, password, {name})`;
 * - publish: `metaWeblog.newPost(blogid, username, password, post + dateCreated, publish)` → postid;
 * - update: `metaWeblog.editPost(postid, username, password, post + dateCreated, publish)`.
 * The post URL is `https://www.cnblogs.com/{blog_app}/p/{postid}`.
 */
export const CNBLOGS_REQUESTS = {
  verify: {
    method: 'POST',
    url: `${CNBLOGS_RPC}/{blog_app}`,
    auth: 'XML-RPC blogger.getUsersBlogs(username, password=<token>)',
  },
  image: {
    method: 'POST',
    url: `${CNBLOGS_RPC}/{blog_app}`,
    auth: 'XML-RPC metaWeblog.newMediaObject(blogid, username, password=<token>, FileData)',
  },
  create: {
    method: 'POST',
    url: `${CNBLOGS_RPC}/{blog_app}`,
    auth: 'XML-RPC metaWeblog.newPost(blogid, username, password=<token>, Post, publish)',
    body: 'CnblogsRelayBody',
  },
  update: {
    method: 'POST',
    url: `${CNBLOGS_RPC}/{blog_app}`,
    auth: 'XML-RPC metaWeblog.editPost(postid, username, password=<token>, Post, publish)',
    body: 'CnblogsRelayBody',
  },
  stats: {
    method: 'GET',
    url: `${CNBLOGS_OPEN_API}/api/blogs/{blog_app}/posts?pageIndex=1`,
    auth: 'Authorization: Bearer <token>',
  },
} as const satisfies Record<string, RequestDescription>;

export function cnblogsRelayBody(r: CnblogsRendered, form: CnblogsForm): CnblogsRelayBody {
  return { post: r.post, publish: form.published, images: r.images };
}

/** `www.cnblogs.com/{blog_app}/…` → `blog_app`. */
function blogAppOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = /^https?:\/\/(?:www\.)?cnblogs\.com\/([A-Za-z0-9_-]+)\//i.exec(url);
  return m?.[1];
}

/**
 * SPEC-r11 §7 ⚠️ 待实测 `GET /api/blogs/{blog_app}/posts?pageIndex=1` (Bearer = the personal access token; the
 * desktop's fetch adds it when the context has none): views, comments and 推荐 of the post with this id, or with this
 * URL for a pasted-back link. Only the first page (the latest posts).
 */
export async function fetchCnblogsStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const byUrl = isUrlExternalId(externalId) ? normalizePostUrl(externalId) : null;
  const blogApp = ctx.credential?.blog_app || blogAppOf(byUrl ?? undefined) || blogAppOf(ctx.url);
  if (!blogApp) return null;
  const token = ctx.credential?.access_token;
  const list = await readJson<Array<Record<string, unknown>>>(
    ctx,
    cnblogsRef(),
    `${CNBLOGS_OPEN_API}/api/blogs/${encodeURIComponent(blogApp)}/posts?pageIndex=1`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  const p = list?.find((x) =>
    byUrl
      ? typeof x.Url === 'string' && normalizePostUrl(x.Url) === byUrl
      : String(x.Id) === String(externalId)
  );
  if (!p) return null;
  return stats('official-api', {
    views: num(p.ViewCount),
    comments: num(p.CommentCount),
    likes: num(p.DiggCount),
  });
}

/* ---------------- adapter ---------------- */

export interface CnblogsAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/**
 * Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/cnblogs`), which
 * holds the token (服务器代发).
 */
export function createCnblogsAdapter(
  opts: CnblogsAdapterOptions = {}
): Adapter<typeof cnblogsSchema> {
  const ref = cnblogsRef(opts.links);
  const renderOpts = (lang?: SdkLang): CnblogsRenderOptions => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'cnblogs',
    label: LABEL,
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: cnblogsBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: CNBLOGS_LIMITS.titleMax },
    schema: cnblogsSchema,
    schemaFor: cnblogsSchemaFor,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchCnblogsStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderCnblogs(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderCnblogs(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(cnblogsRelayBody(r, form), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderCnblogs(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.relaying });
        const res = await relayPublish(ctx, ref, cnblogsRelayBody(r, form), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
