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
import { byLang, defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
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
  originLinkOf,
  originNoteHtml,
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

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const bloggerSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** The blog to publish to (from the binding's list); absent: the one picked when binding. */
    blog_id: z.string().trim().regex(/^\d+$/, t.blogIdDigits).optional().describe(t.blog),
    status: z.enum(['publish', 'draft']).default('publish').describe(t.status),
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

export const bloggerSchema = bloggerSchemaFor('zh-CN');

export type BloggerForm = z.infer<typeof bloggerSchema>;
export type BloggerFormInput = z.input<typeof bloggerSchema>;

export const bloggerBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'google',
  scopes: [BLOGGER_SCOPE],
  helpUrl: 'https://www.blogger.com/',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
  // the title in other languages: `msg(lang).selectBlog` (exported as `bloggerMessages`)
  selects: [{ id: 'blog_id', title: msg('zh-CN').selectBlog }],
  selectsFor: (lang) => [{ id: 'blog_id', title: msg(lang).selectBlog }],
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
  /** `lang` (SPEC-r14 B5): language of the report (not of the closing line). Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): BloggerRendered {
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
    'Blogger',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    undefined,
    'Blogger',
    lang
  );
  const labels = fitTags(
    common.tags,
    {
      max: BLOGGER_LIMITS.labels,
      normalize: (tag) => tag.trim().slice(0, BLOGGER_LIMITS.labelMax) || null,
    },
    'Blogger',
    lang
  );
  const canonical = canonicalOf(form, article, 'Blogger', lang);

  let html = degraded.body;
  const report: ReportItem[] = [...degraded.report];
  const cover = absoluteUrl(common.cover, opts.assetBase);
  if (cover) {
    html = `<p><img src="${cover.replace(/"/g, '&quot;')}" alt=""></p>\n${html}`;
    report.push({ kind: 'cover.inline', text: t.coverInline });
  }
  if (canonical.url && form.origin_note) {
    html += originNoteHtml(originLinkOf(form, article, canonical.url), article.lang);
    report.push({
      kind: 'canonical.note',
      text: t.originNoted,
      detail: { url: canonical.url },
    });
  } else {
    report.push(...canonical.report.filter((i) => i.kind !== 'canonical.set'));
  }
  report.push(
    ...linkedImagesReport(degraded.doc.images.length + (cover ? 1 : 0), 'Blogger', lang),
    ...title.report,
    ...labels.report
  );
  if (form.status === 'draft')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: t.draftOnly,
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
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'blogger',
    label: 'Blogger',
    runtimes: opts.runtimes ?? platformMeta('blogger')!.runtimes,
    contentTypes: ['article'],
    binding: bloggerBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: bloggerSchema,
    schemaFor: bloggerSchemaFor,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderBlogger(doc, form, common, content, renderOpts(popts?.lang));
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
      const r = renderBlogger(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderBlogger(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.publishing });
        const credential = await credentialOf(opts.credential, 'blogger', ctx);
        const res = await relayPublish(ctx, ref, r.body, form.external_id, { credential });
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
