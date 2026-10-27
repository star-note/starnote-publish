/**
 * Self-hosted WordPress: core REST API (`/wp-json/wp/v2/*`, or `/?rest_route=/wp/v2/*` on sites without
 * pretty permalinks) with an **Application Password** (WordPress 5.6+, Basic auth `username:app-password`;
 * core only enables it over HTTPS). Posts take HTML in `content` (Gutenberg shows it as a Classic block);
 * tags and categories are term ids, so tag names are looked up / created first; images can be uploaded to
 * the media library (`POST /wp/v2/media`, raw body + `Content-Disposition`).
 *
 * WordPress core has no canonical field: we add a 「首发于辰记」 note with the link at the end instead (SEO
 * plugins such as Yoast have their own meta keys; ⚠️ 待核实，未接入).
 *
 * WordPress.com (OAuth) is `@starnote/publish-wordpress-com`.
 */
import { defineAdapter, escapeHtml, mediaReport, mergeReports } from '@starnote/publish-core';
import {
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitTags,
  fitTitle,
  guard,
  linkedImagesReport,
  relayPublish,
  relayRequestOf,
  originLinkOf,
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

export const WORDPRESS_LIMITS = {
  /** ⚠️ WordPress 不限标签数，按 10 截断。 */
  tags: 10,
} as const;

export const wordpressSchema = z.object({
  status: z.enum(['publish', 'draft', 'pending']).default('publish').describe('发布方式'),
  /** Category ids on the site (`listWordpressCategories`); empty: the site's default category. */
  categories: z.array(z.number().int().positive()).default([]).describe('分类'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, '只能用小写字母、数字和 -')
    .optional()
    .describe('网址'),
  upload_images: z.boolean().default(true).describe('图片上传到媒体库'),
  /** Core has no canonical field: a 「首发于辰记」 line with the link closes the post instead. */
  origin_note: z.boolean().default(true).describe('文末注明首发于辰记'),
  set_canonical: z.boolean().default(true).describe('附原文链接'),
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  external_id: z
    .string()
    .trim()
    .regex(/^\d+$/, '文章 ID 是数字')
    .optional()
    .describe('已发布文章 ID'),
});

export type WordpressForm = z.infer<typeof wordpressSchema>;
export type WordpressFormInput = z.input<typeof wordpressSchema>;

export type WordpressRestStyle = 'pretty' | 'query';

export interface WordpressCredentials {
  siteUrl: string;
  username: string;
  /** Application Password (spaces allowed, as WordPress displays it). */
  appPassword: string;
  /** `pretty`: /wp-json/…; `query`: /?rest_route=/… (detected by `verifyWordpress`). Default pretty. */
  restStyle?: WordpressRestStyle;
}

export const wordpressPasswordForm = z.object({
  site_url: z
    .string()
    .trim()
    .regex(/^(https?:\/\/)?[^\s/]+\.[^\s]+$/, '请填写站点地址')
    .describe('站点地址'),
  username: z.string().trim().min(1, '请填写 WordPress 用户名').describe('用户名'),
  app_password: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4}( ?[A-Za-z0-9]{4}){5}$/, '应用密码是 24 位字母数字（可带空格）')
    .describe('应用密码'),
});

export const wordpressBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'wordpress',
  fields: ['site_url', 'username', 'app_password'],
  form: wordpressPasswordForm,
  instructions: [
    '在你的站点后台「用户 → 个人资料」底部的「应用密码」区，新建一个名为「辰记」的密码并复制',
    '填入站点地址、用户名和这串密码，点「测试连接」（站点需要 HTTPS，WordPress 才会启用应用密码）',
    '不用时在同一处撤销这个应用密码即可',
  ],
  selects: [{ id: 'categories', title: '默认分类' }],
};

export interface WordpressPostBody {
  title: string;
  content: string;
  status: 'publish' | 'draft' | 'pending';
  excerpt?: string;
  slug?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}

export interface WordpressRendered {
  title: string;
  html: string;
  /** `tags` are names here; the adapter turns them into ids. */
  post: Omit<WordpressPostBody, 'tags'>;
  tagNames: string[];
  images: string[];
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

/** Pure: HTML, post body, tag names and the predicted report. */
export function renderWordpress(
  doc: Doc,
  form: WordpressForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): WordpressRendered {
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
    'WordPress'
  );
  const title = fitTitle(common.title || article.doc.title || 'Untitled', undefined, 'WordPress');
  const tags = fitTags(common.tags, { max: WORDPRESS_LIMITS.tags }, 'WordPress');
  const canonical = canonicalOf(form, article, 'WordPress');
  const cover = absolute(common.cover, opts.assetBase);
  const images = degraded.doc.images.filter((s) => /^https?:\/\//i.test(s));

  let html = degraded.body;
  const report: ReportItem[] = [...degraded.report];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('wordpress', 'WordPress', content, common));
  if (canonical.url && form.origin_note) {
    const en = article.lang && !/^zh/i.test(article.lang);
    const origin = originLinkOf(form, article, canonical.url);
    const link = `<a href="${escapeHtml(origin)}">${en ? escapeHtml(origin) : '辰记'}</a>`;
    html += `\n<hr>\n<p><em>${en ? `Originally published at ${link}.` : `本文首发于${link}。`}</em></p>`;
    report.push({
      kind: 'canonical.note',
      text: 'WordPress 没有 canonical 字段，已在文末注明首发于辰记并附原文链接',
      detail: { url: canonical.url },
    });
  } else {
    report.push(...canonical.report.filter((i) => i.kind !== 'canonical.set'));
  }
  report.push(
    ...(form.upload_images
      ? images.length
        ? [
            {
              kind: 'image.rehosted',
              text: `${images.length} 张图片将上传到站点媒体库`,
              count: images.length,
            },
          ]
        : []
      : linkedImagesReport(images.length, 'WordPress')),
    ...title.report,
    ...tags.report
  );
  if (form.status !== 'publish')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text:
        form.status === 'pending'
          ? '提交为「待审」，由站点编辑审核后发布'
          : '以未公开状态保存到 WordPress',
    });

  return {
    title: title.title,
    html,
    tagNames: tags.tags,
    images,
    ...(cover ? { cover } : {}),
    post: {
      title: title.title,
      content: html,
      status: form.status,
      ...(common.summary ? { excerpt: common.summary } : {}),
      ...(form.slug ? { slug: form.slug } : {}),
      ...(form.categories.length ? { categories: form.categories } : {}),
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function wordpressRef(links?: ErrorLinks): PlatformRef {
  return { key: 'wordpress', label: 'WordPress', ...(links ? { links } : {}) };
}

/** `wp/v2/posts?x=1` on either REST style (`/wp-json/…`, or `/?rest_route=/…` without pretty permalinks). */
export function wordpressUrl(
  siteUrl: string,
  route: string,
  style: WordpressRestStyle = 'pretty'
): string {
  const site = siteUrl
    .trim()
    .replace(/^(?!https?:\/\/)/i, 'https://')
    .replace(/\/+$/, '');
  const [path = '', query] = route.replace(/^\/+/, '').split('?');
  if (style === 'query') return `${site}/?rest_route=/${path}${query ? `&${query}` : ''}`;
  return `${site}/wp-json/${path}${query ? `?${query}` : ''}`;
}

/**
 * What 辰记's API sends to a self-hosted WordPress, with `Authorization: Basic base64(username:app_password)`.
 * verify finds the REST root (pretty, else `?rest_route=`), checks `authentication['application-passwords']`
 * and reads `users/me?context=edit`.
 */
export const WORDPRESS_REQUESTS = {
  verifyRoot: { method: 'GET', url: '{site}/wp-json/', auth: 'none' },
  verifyUser: {
    method: 'GET',
    url: '{site}/wp-json/wp/v2/users/me?context=edit',
    auth: 'Basic <username:app_password>',
  },
  media: {
    method: 'POST',
    url: '{site}/wp-json/wp/v2/media',
    auth: 'Basic',
    body: 'raw bytes + Content-Disposition',
  },
  tags: { method: 'GET|POST', url: '{site}/wp-json/wp/v2/tags', auth: 'Basic', body: '{name}' },
  create: {
    method: 'POST',
    url: '{site}/wp-json/wp/v2/posts',
    auth: 'Basic',
    body: 'WordpressPostBody + tags ids',
  },
  update: {
    method: 'POST',
    url: '{site}/wp-json/wp/v2/posts/{id}',
    auth: 'Basic',
    body: 'WordpressPostBody + tags ids',
  },
} as const satisfies Record<string, RequestDescription>;

/**
 * What the browser posts to 辰记's API for WordPress: the post without tags, the tag names (the server looks
 * them up / creates them), and the images and cover to upload to the media library first.
 */
export interface WordpressRelayBody {
  post: Omit<WordpressPostBody, 'tags'>;
  tag_names: string[];
  images: string[];
  cover?: string;
}

export function wordpressRelayBody(r: WordpressRendered, form: WordpressForm): WordpressRelayBody {
  return {
    post: r.post,
    tag_names: r.tagNames,
    images: form.upload_images ? r.images : [],
    ...(form.upload_images && r.cover ? { cover: r.cover } : {}),
  };
}

/* ---------------- adapter ---------------- */

export interface WordpressAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop; 辰记's API adds the application password and sends it (服务器代发). */
export function createWordpressAdapter(
  opts: WordpressAdapterOptions = {}
): Adapter<typeof wordpressSchema> {
  const ref = wordpressRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'wordpress',
    label: 'WordPress',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: wordpressBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: wordpressSchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderWordpress(doc, form, common, content, renderOpts);
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
      const r = renderWordpress(doc, form, common, content, renderOpts);
      return relayRequestOf(wordpressRelayBody(r, form), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderWordpress(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '由服务器代发到 WordPress' });
        const res = await relayPublish(ctx, ref, wordpressRelayBody(r, form), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state:
            res.state ??
            (form.status === 'publish'
              ? 'published'
              : form.status === 'pending'
                ? 'pending-review'
                : 'draft'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
