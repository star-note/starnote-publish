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
import { byLang, defineAdapter, mediaReport, mergeReports } from '@starnote/publish-core';
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

import { msg } from './i18n';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  SdkLang,
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

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const ghostSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    status: z.enum(['published', 'draft']).default('published').describe(t.status),
    visibility: z.enum(['public', 'members', 'paid']).default('public').describe(t.visibility),
    featured: z.boolean().default(false).describe(t.featured),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]*$/, t.slugFormat)
      .optional()
      .describe(t.slug),
    /** true: images (and the cover) are uploaded to the Ghost site; false: linked from 辰记. */
    upload_images: z.boolean().default(true).describe(t.uploadImages),
    set_canonical: z.boolean().default(true).describe(t.setCanonical),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    external_id: z.string().trim().regex(OBJECT_ID, t.idFormat).optional().describe(t.externalId),
  });
});

export const ghostSchema = ghostSchemaFor('zh-CN');

export type GhostForm = z.infer<typeof ghostSchema>;
export type GhostFormInput = z.input<typeof ghostSchema>;

export interface GhostCredentials {
  /** Admin API URL (`https://example.ghost.io`, may include a subdirectory). */
  siteUrl: string;
  /** `id:secret` */
  adminKey: string;
}

export const ghostKeyFormFor = byLang((lang) => {
  const t = msg(lang).key;
  return z.object({
    site_url: z
      .string()
      .trim()
      .regex(/^(https?:\/\/)?[^\s/]+\.[^\s]+$/, t.siteUrlHint)
      .describe(t.siteUrl),
    admin_key: z.string().trim().regex(ADMIN_KEY, t.adminKeyFormat).describe(t.adminKey),
  });
});

export const ghostKeyForm = ghostKeyFormFor('zh-CN');

export const ghostBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'ghost',
  fields: ['site_url', 'admin_key'],
  form: ghostKeyForm,
  formFor: ghostKeyFormFor,
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
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
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): GhostRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
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
    'Ghost',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    GHOST_LIMITS.titleMax,
    'Ghost',
    lang
  );
  const excerpt = fitSummary(common.summary, GHOST_LIMITS.excerptMax, 'Ghost', lang);
  const tags = fitTags(common.tags, { max: GHOST_LIMITS.tags }, 'Ghost', lang);
  const canonical = canonicalOf(form, article, 'Ghost', lang);
  const cover = absolute(common.cover, opts.assetBase);
  const images = degraded.doc.images.filter((s) => /^https?:\/\//i.test(s));
  const report: ReportItem[] = [
    ...degraded.report,
    ...(form.upload_images
      ? images.length
        ? [
            {
              kind: 'image.rehosted',
              text: msg(lang).imagesWillUpload(images.length),
              count: images.length,
            },
          ]
        : []
      : linkedImagesReport(images.length, 'Ghost', lang)),
    ...title.report,
    ...excerpt.report,
    ...tags.report,
    ...canonical.report,
  ];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('ghost', 'Ghost', content, common, lang));
  if (form.status === 'draft')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: msg(lang).draftOnly,
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
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'ghost',
    label: 'Ghost',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: ghostBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: GHOST_LIMITS.titleMax },
    schema: ghostSchema,
    schemaFor: ghostSchemaFor,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderGhost(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'html',
        title: r.title,
        body: r.html,
        previewHtml: r.html,
        report: r.report,
      };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderGhost(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(ghostRelayBody(r, form), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderGhost(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.relaying });
        const res = await relayPublish(ctx, ref, ghostRelayBody(r, form), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
