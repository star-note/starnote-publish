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
import {
  byLang,
  defineAdapter,
  escapeHtml,
  mediaReport,
  mergeReports,
} from '@starnote/publish-core';
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

export const WORDPRESS_LIMITS = {
  /** ⚠️ WordPress 不限标签数，按 10 截断。 */
  tags: 10,
} as const;

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const wordpressSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    status: z.enum(['publish', 'draft', 'pending']).default('publish').describe(t.status),
    /** Category ids on the site (`listWordpressCategories`); empty: the site's default category. */
    categories: z.array(z.number().int().positive()).default([]).describe(t.categories),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]*$/, t.slugFormat)
      .optional()
      .describe(t.slug),
    upload_images: z.boolean().default(true).describe(t.uploadImages),
    /** Core has no canonical field: a 「首发于辰记」 line with the link closes the post instead. */
    origin_note: z.boolean().default(true).describe(t.originNote),
    set_canonical: z.boolean().default(true).describe(t.setCanonical),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    external_id: z.string().trim().regex(/^\d+$/, t.idDigits).optional().describe(t.externalId),
  });
});

export const wordpressSchema = wordpressSchemaFor('zh-CN');

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

export const wordpressPasswordFormFor = byLang((lang) => {
  const t = msg(lang).key;
  return z.object({
    site_url: z
      .string()
      .trim()
      .regex(/^(https?:\/\/)?[^\s/]+\.[^\s]+$/, t.siteUrlRequired)
      .describe(t.siteUrl),
    username: z.string().trim().min(1, t.usernameRequired).describe(t.username),
    app_password: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{4}( ?[A-Za-z0-9]{4}){5}$/, t.appPasswordFormat)
      .describe(t.appPassword),
  });
});

export const wordpressPasswordForm = wordpressPasswordFormFor('zh-CN');

export const wordpressBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'wordpress',
  fields: ['site_url', 'username', 'app_password'],
  form: wordpressPasswordForm,
  formFor: wordpressPasswordFormFor,
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
  // the title in other languages: `msg(lang).selectCategories` (exported as `wordpressMessages`)
  selects: [{ id: 'categories', title: msg('zh-CN').selectCategories }],
  selectsFor: (lang) => [{ id: 'categories', title: msg(lang).selectCategories }],
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
  /** `lang` (SPEC-r14 B5): language of the report (not of the closing line). Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): WordpressRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const t = msg(lang);
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
    'WordPress',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    undefined,
    'WordPress',
    lang
  );
  const tags = fitTags(common.tags, { max: WORDPRESS_LIMITS.tags }, 'WordPress', lang);
  const canonical = canonicalOf(form, article, 'WordPress', lang);
  const cover = absolute(common.cover, opts.assetBase);
  const images = degraded.doc.images.filter((s) => /^https?:\/\//i.test(s));

  let html = degraded.body;
  const report: ReportItem[] = [...degraded.report];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('wordpress', 'WordPress', content, common, lang));
  if (canonical.url && form.origin_note) {
    const en = article.lang && !/^zh/i.test(article.lang);
    const origin = originLinkOf(form, article, canonical.url);
    const link = `<a href="${escapeHtml(origin)}">${en ? escapeHtml(origin) : '辰记'}</a>`;
    html += `\n<hr>\n<p><em>${en ? `Originally published at ${link}.` : `本文首发于${link}。`}</em></p>`;
    report.push({
      kind: 'canonical.note',
      text: t.originNoted,
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
              text: t.imagesWillUpload(images.length),
              count: images.length,
            },
          ]
        : []
      : linkedImagesReport(images.length, 'WordPress', lang)),
    ...title.report,
    ...tags.report
  );
  if (form.status !== 'publish')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: form.status === 'pending' ? t.pending : t.draftOnly,
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
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'wordpress',
    label: 'WordPress',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: wordpressBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: wordpressSchema,
    schemaFor: wordpressSchemaFor,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderWordpress(doc, form, common, content, renderOpts(popts?.lang));
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
      const r = renderWordpress(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(wordpressRelayBody(r, form), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderWordpress(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.relaying });
        const res = await relayPublish(ctx, ref, wordpressRelayBody(r, form), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
