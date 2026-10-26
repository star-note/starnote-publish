/**
 * Ghost Admin API (✅ docs.ghost.org/admin-api): a Custom Integration's Admin API Key `id:secret` signs a
 * short-lived HS256 JWT (`kid` = id, `aud` = `/admin/`, `exp` ≤ 5 min, secret hex-decoded), sent as
 * `Authorization: Ghost <jwt>` with `Accept-Version`. Posts go to `POST /ghost/api/admin/posts/?source=html`
 * (Ghost converts the HTML to Lexical); updates are `PUT /posts/{id}/` and need the current `updated_at`
 * (collision detection); images go to `POST /images/upload/` (multipart `file`, `purpose`, `ref`).
 *
 * Browser-safe: render + relay body only. The key never reaches the browser: 辰记's Python API signs the JWT and
 * calls Ghost (服务器代发).
 */
import { defineAdapter, mediaReport, mergeReports } from '@starnote/publish-core';
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
  relayPublish,
  relayRequestOf,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

/** Lowest Admin API version we rely on (`Accept-Version`). */
export const GHOST_ACCEPT_VERSION = 'v5.0';

export const GHOST_LIMITS = {
  /** Ghost's posts.title column (varchar 255). */
  titleMax: 255,
  /** Ghost validation: custom_excerpt ≤ 300. */
  excerptMax: 300,
  /** ⚠️ 待核实：标签数量 Ghost 不限，按 10 截断避免标签泛滥。 */
  tags: 10,
} as const;

const ADMIN_KEY = /^[a-f0-9]{24}:[a-f0-9]{64}$/i;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const ghostSchema = z.object({
  status: z.enum(['published', 'draft']).default('published').describe('发布方式'),
  visibility: z.enum(['public', 'members', 'paid']).default('public').describe('可见范围'),
  featured: z.boolean().default(false).describe('精选'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, '只能用小写字母、数字和 -')
    .optional()
    .describe('网址'),
  /** true: images (and the cover) are uploaded to the Ghost site; false: linked from 辰记. */
  upload_images: z.boolean().default(true).describe('图片上传到 Ghost'),
  set_canonical: z.boolean().default(true).describe('设置原文链接'),
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  external_id: z
    .string()
    .trim()
    .regex(OBJECT_ID, '文章 ID 是 24 位十六进制')
    .optional()
    .describe('已发布文章 ID'),
});

export type GhostForm = z.infer<typeof ghostSchema>;
export type GhostFormInput = z.input<typeof ghostSchema>;

export interface GhostCredentials {
  /** Admin API URL (`https://example.ghost.io`, may include a subdirectory). */
  siteUrl: string;
  /** `id:secret` */
  adminKey: string;
}

export const ghostKeyForm = z.object({
  site_url: z
    .string()
    .trim()
    .regex(
      /^(https?:\/\/)?[^\s/]+\.[^\s]+$/,
      '请填写 Ghost 站点地址（Integration 页显示的 API URL）'
    )
    .describe('站点地址'),
  admin_key: z
    .string()
    .trim()
    .regex(ADMIN_KEY, 'Admin API Key 的格式是「24 位 id:64 位密钥」')
    .describe('Admin API Key'),
});

export const ghostBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'ghost',
  fields: ['site_url', 'admin_key'],
  form: ghostKeyForm,
  instructions: [
    '进入 Ghost 后台 → Settings → Integrations，新建 Custom Integration，起名「辰记」',
    '复制 API URL 和 Admin API Key，粘贴到这里并点「测试连接」',
    '在 Ghost 后台删除这个集成，密钥立刻作废',
  ],
};

export interface GhostPostBody {
  title: string;
  html: string;
  status: 'published' | 'draft';
  visibility: 'public' | 'members' | 'paid';
  featured: boolean;
  tags: string[];
  slug?: string;
  custom_excerpt?: string;
  feature_image?: string;
  canonical_url?: string;
  updated_at?: string;
}

export interface GhostRendered {
  title: string;
  html: string;
  post: GhostPostBody;
  /** Absolute image URLs in the body (to rehost). */
  images: string[];
  /** The cover, absolute. */
  cover?: string;
  report: ReportItem[];
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

/** Pure: the HTML, the post body (images still linked) and the predicted report. */
export function renderGhost(
  doc: Doc,
  form: GhostForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): GhostRendered {
  const article = articleOf(doc, content);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'html',
      lang: article.lang,
      title: article.doc.title,
      math: 'source',
      video: 'link',
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'Ghost'
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    GHOST_LIMITS.titleMax,
    'Ghost'
  );
  const excerpt = fitSummary(common.summary, GHOST_LIMITS.excerptMax, 'Ghost');
  const tags = fitTags(common.tags, { max: GHOST_LIMITS.tags }, 'Ghost');
  const canonical = canonicalOf(form, article, 'Ghost');
  const cover = absolute(common.cover, opts.assetBase);
  const images = degraded.doc.images.filter((s) => /^https?:\/\//i.test(s));
  const report: ReportItem[] = [
    ...degraded.report,
    ...(form.upload_images
      ? images.length
        ? [
            {
              kind: 'image.rehosted',
              text: `${images.length} 张图片将上传到 Ghost 站点`,
              count: images.length,
            },
          ]
        : []
      : linkedImagesReport(images.length, 'Ghost')),
    ...title.report,
    ...excerpt.report,
    ...tags.report,
    ...canonical.report,
  ];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('ghost', 'Ghost', content, common));
  if (form.status === 'draft')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: '以未公开状态保存到 Ghost，检查后在 Ghost 后台发布',
    });
  return {
    title: title.title,
    html: degraded.body,
    images,
    ...(cover ? { cover } : {}),
    post: {
      title: title.title,
      html: degraded.body,
      status: form.status,
      visibility: form.visibility,
      featured: form.featured,
      tags: tags.tags,
      ...(form.slug ? { slug: form.slug } : {}),
      ...(excerpt.summary ? { custom_excerpt: excerpt.summary } : {}),
      ...(cover ? { feature_image: cover } : {}),
      ...(canonical.url ? { canonical_url: canonical.url } : {}),
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function ghostRef(links?: ErrorLinks): PlatformRef {
  return { key: 'ghost', label: 'Ghost', ...(links ? { links } : {}) };
}

/** `https://site/blog` → `https://site/blog/ghost/api/admin/<path>` */
export function ghostAdminUrl(siteUrl: string, path: string): string {
  const site = siteUrl
    .trim()
    .replace(/^(?!https?:\/\/)/i, 'https://')
    .replace(/\/+$/, '');
  return `${site}/ghost/api/admin/${path.replace(/^\/+/, '')}`;
}

/**
 * What 辰记's API sends to Ghost. The Admin API Key never leaves the server: it signs a 5-minute HS256 JWT
 * (`kid` = key id, `aud` = `/admin/`, hex-decoded secret) per request, `Authorization: Ghost <jwt>`.
 */
export const GHOST_REQUESTS = {
  verifySite: { method: 'GET', url: '{site}/ghost/api/admin/site/', auth: 'none (Accept-Version)' },
  verifyKey: {
    method: 'GET',
    url: '{site}/ghost/api/admin/posts/?limit=1&fields=id',
    auth: 'Ghost <jwt>',
  },
  upload: {
    method: 'POST',
    url: '{site}/ghost/api/admin/images/upload/',
    auth: 'Ghost <jwt>',
    body: 'multipart file, purpose=image, ref',
  },
  create: {
    method: 'POST',
    url: '{site}/ghost/api/admin/posts/?source=html',
    auth: 'Ghost <jwt>',
    body: '{posts: [GhostPostBody]}',
  },
  update: {
    method: 'PUT',
    url: '{site}/ghost/api/admin/posts/{id}/?source=html',
    auth: 'Ghost <jwt>',
    body: '{posts: [GhostPostBody + updated_at]}',
  },
} as const satisfies Record<string, RequestDescription>;

/**
 * What the browser posts to 辰记's API for Ghost: the post (html source, images still on 辰记) plus the images
 * and cover the server should upload to the site first (`images/upload/`), rewriting `src` and `feature_image`.
 */
export interface GhostRelayBody {
  post: GhostPostBody;
  images: string[];
  cover?: string;
}

export function ghostRelayBody(r: GhostRendered, form: GhostForm): GhostRelayBody {
  return {
    post: r.post,
    images: form.upload_images ? r.images : [],
    ...(form.upload_images && r.cover ? { cover: r.cover } : {}),
  };
}

/* ---------------- adapter ---------------- */

export interface GhostAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop; 辰记's API signs the JWT, uploads images and sends it (服务器代发). */
export function createGhostAdapter(opts: GhostAdapterOptions = {}): Adapter<typeof ghostSchema> {
  const ref = ghostRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'ghost',
    label: 'Ghost',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: ghostBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: GHOST_LIMITS.titleMax },
    schema: ghostSchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderGhost(doc, form, common, content, renderOpts);
      return {
        format: 'html',
        title: r.title,
        body: r.html,
        previewHtml: r.html,
        report: r.report,
      };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous }) {
      const r = renderGhost(doc, form, common, content, renderOpts);
      return relayRequestOf(ghostRelayBody(r, form), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderGhost(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '由服务器代发到 Ghost' });
        const res = await relayPublish(ctx, ref, ghostRelayBody(r, form), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.status === 'published' ? 'published' : 'draft'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
