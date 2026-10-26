/**
 * Blogger (Blogger API v3 ✅ developers.google.com/blogger/docs/3.0): `POST /blogs/{blogId}/posts?isDraft=`,
 * `PUT /blogs/{blogId}/posts/{postId}`, `POST /blogs/{blogId}/posts/{postId}/publish`. Bound with Google OAuth 2.0
 * (scope `https://www.googleapis.com/auth/blogger` ✅). HTML body, labels from the tags, no canonical field (a
 * 「首发于辰记」 line closes the post), images stay 辰记 links (the API has no upload ⚠️ 待核实：文档没有上传接口).
 *
 * Browser-safe: render + relay body. Who sends it: the desktop main process with the token kept on the machine,
 * 辰记's API with the token the web page holds in memory (`credential`, never stored), or 辰记's API with its
 * encrypted copy when 「云端代发」 is on.
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  absoluteUrl,
  articleOf,
  canonicalOf,
  credentialOf,
  degradeArticle,
  fitTags,
  fitTitle,
  guard,
  linkedImagesReport,
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

export const BLOGGER_API = 'https://www.googleapis.com/blogger/v3';
export const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger';

export const BLOGGER_LIMITS = {
  /** ⚠️ 待核实：Blogger 后台单篇标签总长约 200 字符，API 文档未写；按 20 个截断。 */
  labels: 20,
  /** ⚠️ 待核实：单个标签长度。 */
  labelMax: 50,
} as const;

export const bloggerSchema = z.object({
  /** The blog to publish to (from the binding's list); absent: the one picked when binding. */
  blog_id: z.string().trim().regex(/^\d+$/, '博客 ID 是数字').optional().describe('博客'),
  status: z.enum(['publish', 'draft']).default('publish').describe('发布方式'),
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

export type BloggerForm = z.infer<typeof bloggerSchema>;
export type BloggerFormInput = z.input<typeof bloggerSchema>;

export const bloggerBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'google',
  scopes: [BLOGGER_SCOPE],
  helpUrl: 'https://www.blogger.com/',
  instructions: [
    '点「用 Google 授权」，在 Google 页面选择账号并允许辰记管理你的 Blogger 博客',
    '回到辰记后选择要发布到的博客',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到 Google 账号「第三方应用和服务」里移除辰记',
  ],
  selects: [{ id: 'blog_id', title: '发布到哪个博客' }],
};

export interface BloggerPostBody {
  kind: 'blogger#post';
  title: string;
  content: string;
  labels?: string[];
}

/** What is relayed (server / desktop check it against the same whitelist). */
export interface BloggerRelayBody {
  blog_id?: string;
  is_draft: boolean;
  post: BloggerPostBody;
}

export interface BloggerRendered {
  title: string;
  html: string;
  body: BloggerRelayBody;
  report: ReportItem[];
}

/** Pure: HTML, relay body and the predicted report. */
export function renderBlogger(
  doc: Doc,
  form: BloggerForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): BloggerRendered {
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
    'Blogger'
  );
  const title = fitTitle(common.title || article.doc.title || 'Untitled', undefined, 'Blogger');
  const labels = fitTags(
    common.tags,
    {
      max: BLOGGER_LIMITS.labels,
      normalize: (t) => t.trim().slice(0, BLOGGER_LIMITS.labelMax) || null,
    },
    'Blogger'
  );
  const canonical = canonicalOf(form, article, 'Blogger');

  let html = degraded.body;
  const report: ReportItem[] = [...degraded.report];
  const cover = absoluteUrl(common.cover, opts.assetBase);
  if (cover) {
    html = `<p><img src="${cover.replace(/"/g, '&quot;')}" alt=""></p>\n${html}`;
    report.push({ kind: 'cover.inline', text: 'Blogger 没有封面字段，封面图放在正文开头' });
  }
  if (canonical.url && form.origin_note) {
    html += originNoteHtml(canonical.url, article.lang);
    report.push({
      kind: 'canonical.note',
      text: 'Blogger 没有 canonical 字段，已在文末注明首发于辰记并附原文链接',
      detail: { url: canonical.url },
    });
  } else {
    report.push(...canonical.report.filter((i) => i.kind !== 'canonical.set'));
  }
  report.push(
    ...linkedImagesReport(degraded.doc.images.length + (cover ? 1 : 0), 'Blogger'),
    ...title.report,
    ...labels.report
  );
  if (form.status === 'draft')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: '保存为 Blogger 草稿，检查后在 Blogger 后台发布',
    });

  return {
    title: title.title,
    html,
    body: {
      ...(form.blog_id ? { blog_id: form.blog_id } : {}),
      is_draft: form.status === 'draft',
      post: {
        kind: 'blogger#post',
        title: title.title,
        content: html,
        ...(labels.tags.length ? { labels: labels.tags } : {}),
      },
    },
    report,
  };
}

export function bloggerRef(links?: ErrorLinks): PlatformRef {
  return { key: 'blogger', label: 'Blogger', ...(links ? { links } : {}) };
}

/** The official requests the senders (desktop main / 辰记's API) make with `Authorization: Bearer <token>`. */
export const BLOGGER_REQUESTS = {
  account: { method: 'GET', url: `${BLOGGER_API}/users/self`, auth: 'Bearer <access_token>' },
  blogs: { method: 'GET', url: `${BLOGGER_API}/users/self/blogs`, auth: 'Bearer <access_token>' },
  create: {
    method: 'POST',
    url: `${BLOGGER_API}/blogs/{blogId}/posts?isDraft={is_draft}`,
    auth: 'Bearer <access_token>',
    body: 'BloggerPostBody',
  },
  update: {
    method: 'PUT',
    url: `${BLOGGER_API}/blogs/{blogId}/posts/{postId}`,
    auth: 'Bearer <access_token>',
    body: 'BloggerPostBody',
  },
  publishDraft: {
    method: 'POST',
    url: `${BLOGGER_API}/blogs/{blogId}/posts/{postId}/publish`,
    auth: 'Bearer <access_token>',
  },
} as const satisfies Record<string, RequestDescription>;

export interface BloggerAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  /** Web: the token the page holds in memory (`MemoryCredentialStore.credentialFor`). */
  credential?: CredentialSource;
}

export function createBloggerAdapter(
  opts: BloggerAdapterOptions = {}
): Adapter<typeof bloggerSchema> {
  const ref = bloggerRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'blogger',
    label: 'Blogger',
    runtimes: opts.runtimes ?? platformMeta('blogger')!.runtimes,
    contentTypes: ['article'],
    binding: bloggerBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: bloggerSchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderBlogger(doc, form, common, content, renderOpts);
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
      const r = renderBlogger(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderBlogger(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '发布到 Blogger' });
        const credential = await credentialOf(opts.credential, 'blogger', ctx);
        const res = await relayPublish(ctx, ref, r.body, form.external_id, { credential });
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.status === 'draft' ? 'draft' : 'published'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
