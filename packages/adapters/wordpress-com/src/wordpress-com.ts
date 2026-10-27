/**
 * WordPress.com (REST API v1.1 ✅ developer.wordpress.com/docs/api): `POST /rest/v1.1/sites/{site}/posts/new`,
 * `POST /rest/v1.1/sites/{site}/posts/{ID}`; tags and categories are comma-separated **names** (✅ the API creates
 * missing ones), so no term lookups. Bound with OAuth2 (✅ `public-api.wordpress.com/oauth2/authorize` / `token`;
 * the default token is for one site, `blog_id` / `blog_url` come with it ✅). Self-hosted WordPress is
 * `@starnote/publish-wordpress` (Application Password).
 *
 * HTML body; no canonical field (a 「首发于辰记」 line closes the post); images stay 辰记 links; the cover becomes the
 * first image of the body (`featured_image` takes an existing attachment id only ✅).
 *
 * Browser-safe: render + relay body; the desktop main process (token on the machine) or 辰记's API (page-memory
 * `credential`, or the 「云端代发」 copy) sends it.
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  absoluteUrl,
  articleOf,
  canonicalOf,
  credentialOf,
  degradeArticle,
  fitSummary,
  fitTags,
  fitTitle,
  guard,
  linkedImagesReport,
  originLinkOf,
  originNoteHtml,
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
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';

export const WPCOM_API = 'https://public-api.wordpress.com/rest/v1.1';

export const WPCOM_LIMITS = {
  /** ⚠️ WordPress 不限标签数，按 10 截断（与自建站一致）。 */
  tags: 10,
  excerptMax: 300,
} as const;

/** Tags / categories go as a comma-separated list: a comma inside a name would split it. */
function termName(t: string): string | null {
  const n = t.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return n || null;
}

export const wordpressComSchema = z.object({
  /** The site (from the binding); absent: the one the token was issued for. */
  site_id: z.string().trim().regex(/^\d+$/, '站点 ID 是数字').optional().describe('站点'),
  status: z
    .enum(['publish', 'draft', 'pending', 'private'])
    .default('publish')
    .describe('发布方式'),
  /** Category names; missing ones are created. */
  categories: z.array(z.string().trim().min(1).max(100)).max(10).default([]).describe('分类'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, '只能用小写字母、数字和 -')
    .optional()
    .describe('网址'),
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

export type WordpressComForm = z.infer<typeof wordpressComSchema>;
export type WordpressComFormInput = z.input<typeof wordpressComSchema>;

export const wordpressComBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'wordpress.com',
  helpUrl: 'https://wordpress.com/',
  instructions: [
    '点「用 WordPress.com 授权」，登录后选择要授权的站点并允许',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到 WordPress.com「账户设置 → 已连接的应用」断开辰记',
  ],
  selects: [{ id: 'site_id', title: '发布到哪个站点' }],
};

export interface WordpressComPostBody {
  title: string;
  content: string;
  status: 'publish' | 'draft' | 'pending' | 'private';
  excerpt?: string;
  tags?: string;
  categories?: string;
  format?: 'standard';
  slug?: string;
}

export interface WordpressComRelayBody {
  site_id?: string;
  post: WordpressComPostBody;
}

export interface WordpressComRendered {
  title: string;
  html: string;
  body: WordpressComRelayBody;
  report: ReportItem[];
}

export function renderWordpressCom(
  doc: Doc,
  form: WordpressComForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): WordpressComRendered {
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
    'WordPress.com'
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    undefined,
    'WordPress.com'
  );
  const tags = fitTags(
    common.tags,
    { max: WPCOM_LIMITS.tags, normalize: termName },
    'WordPress.com'
  );
  const summary = fitSummary(common.summary, WPCOM_LIMITS.excerptMax, 'WordPress.com');
  const canonical = canonicalOf(form, article, 'WordPress.com');
  const categories = form.categories.map(termName).filter((c): c is string => !!c);

  let html = degraded.body;
  const report: ReportItem[] = [...degraded.report];
  const cover = absoluteUrl(common.cover, opts.assetBase);
  if (cover) {
    html = `<p><img src="${cover.replace(/"/g, '&quot;')}" alt=""></p>\n${html}`;
    report.push({
      kind: 'cover.inline',
      text: 'WordPress.com 的特色图片只能选媒体库里已有的图片，封面图放在正文开头',
    });
  }
  if (canonical.url && form.origin_note) {
    html += originNoteHtml(originLinkOf(form, article, canonical.url), article.lang);
    report.push({
      kind: 'canonical.note',
      text: 'WordPress.com 没有 canonical 字段，已在文末注明首发于辰记并附原文链接',
      detail: { url: canonical.url },
    });
  } else {
    report.push(...canonical.report.filter((i) => i.kind !== 'canonical.set'));
  }
  report.push(
    ...linkedImagesReport(degraded.doc.images.length + (cover ? 1 : 0), 'WordPress.com'),
    ...title.report,
    ...summary.report,
    ...tags.report
  );
  if (form.status !== 'publish')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text:
        form.status === 'pending'
          ? '提交为「待审」，由站点编辑审核后发布'
          : form.status === 'private'
            ? '以私密文章发布，只有站点管理员和编辑能看到'
            : '保存为 WordPress.com 草稿',
    });

  return {
    title: title.title,
    html,
    body: {
      ...(form.site_id ? { site_id: form.site_id } : {}),
      post: {
        title: title.title,
        content: html,
        status: form.status,
        format: 'standard',
        ...(summary.summary ? { excerpt: summary.summary } : {}),
        ...(tags.tags.length ? { tags: tags.tags.join(',') } : {}),
        ...(categories.length ? { categories: categories.join(',') } : {}),
        ...(form.slug ? { slug: form.slug } : {}),
      },
    },
    report,
  };
}

export function wordpressComRef(links?: ErrorLinks): PlatformRef {
  return { key: 'wordpress-com', label: 'WordPress.com', ...(links ? { links } : {}) };
}

export const WORDPRESS_COM_REQUESTS = {
  account: { method: 'GET', url: `${WPCOM_API}/me`, auth: 'Bearer <access_token>' },
  site: { method: 'GET', url: `${WPCOM_API}/sites/{site}`, auth: 'Bearer <access_token>' },
  create: {
    method: 'POST',
    url: `${WPCOM_API}/sites/{site}/posts/new`,
    auth: 'Bearer <access_token>',
    body: 'WordpressComPostBody',
  },
  update: {
    method: 'POST',
    url: `${WPCOM_API}/sites/{site}/posts/{ID}`,
    auth: 'Bearer <access_token>',
    body: 'WordpressComPostBody',
  },
} as const satisfies Record<string, RequestDescription>;

export interface WordpressComAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  /** Web: the token the page holds in memory. */
  credential?: CredentialSource;
}

export function createWordpressComAdapter(
  opts: WordpressComAdapterOptions = {}
): Adapter<typeof wordpressComSchema> {
  const ref = wordpressComRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'wordpress-com',
    label: 'WordPress.com',
    runtimes: opts.runtimes ?? platformMeta('wordpress-com')!.runtimes,
    contentTypes: ['article'],
    binding: wordpressComBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: wordpressComSchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderWordpressCom(doc, form, common, content, renderOpts);
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
      const r = renderWordpressCom(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderWordpressCom(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '发布到 WordPress.com' });
        const credential = await credentialOf(opts.credential, 'wordpress-com', ctx);
        const res = await relayPublish(ctx, ref, r.body, form.external_id, { credential });
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state:
            res.state ??
            (form.status === 'publish' || form.status === 'private'
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
