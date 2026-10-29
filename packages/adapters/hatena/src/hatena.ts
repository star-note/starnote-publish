/**
 * はてなブログ AtomPub (✅ developer.hatena.ne.jp/ja/documents/blog/apis/atom): root
 * `https://blog.hatena.ne.jp/{hatena_id}/{blog_id}/atom` (service document: the blog title), collection `…/atom/entry`
 * (POST → 201 + entry), member `…/atom/entry/{entry_id}` (PUT → 200). Auth: Basic (Hatena ID : API キー) over HTTPS,
 * or WSSE; the API key is in the blog's 詳細設定 → AtomPub. Entry: `title`, `author/name`, `content`, `updated`,
 * `category term` (0..n), `app:control/app:draft` (yes = 下書き), `hatenablog:scheduled` (yes + a future `updated` on a
 * draft = 予約投稿), `hatenablog:custom-url`. The body is read in the blog's own 編集モード (見たまま = HTML, Markdown,
 * はてな記法) — the `content@type` does not switch it, so the form names the mode the blog uses.
 *
 * Browser-safe: render + relay body (JSON); 辰记's Python API writes the Atom XML, adds Basic auth and sends it.
 * ⚠️ Not in the docs: title / body size limits, whether PUT can turn a published entry back into a draft, a page-view
 * API (none documented: no stats).
 */
import {
  byLang,
  defineAdapter,
  localizedLabel,
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
  originLinkOf,
  originNoteHtml,
  originNoteMarkdown,
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

export const HATENA_BLOG_API = 'https://blog.hatena.ne.jp';

export const HATENA_LIMITS = {
  /** ⚠️ 待核实：标题上限文档未写，按 200 截断。 */
  titleMax: 200,
  /** ⚠️ 待核实：カテゴリ数量文档未写，按 10 个截断。 */
  categories: 10,
} as const;

/** ⚠️ Hatena ID: 3–32 letters, digits, `-` and `_`, starting with a letter (はてな ID 规则，文档未在 AtomPub 页写明). */
export const HATENA_ID = /^[A-Za-z][A-Za-z0-9_-]{1,30}[A-Za-z0-9]$/;
/** The blog ID is the blog's domain (`example.hatenablog.com`; for a custom domain the original one, shown in 詳細設定). */
export const HATENA_BLOG_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const hatenaSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** The blog's 編集モード (設定 → 基本設定): the body is written in it. */
    syntax: z.enum(['markdown', 'html']).default('markdown').describe(t.syntax),
    /** true: 下書き. */
    draft: z.boolean().default(false).describe(t.draft),
    /** ISO 8601 with offset: saved as a draft that はてなブログ publishes at that time (予約投稿). */
    schedule_at: z.string().trim().regex(ISO, t.isoTime).optional().describe(t.scheduleAt),
    /** The entry's URL path after `/entry/` (custom URL). */
    custom_url: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9/_-]{1,100}$/, t.pathRule)
      .optional()
      .describe(t.customPath),
    origin_note: z.boolean().default(true).describe(t.originNote),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    /** The entry id of an earlier publish (the last segment of its member URI). */
    // ⚠️ entry ids seen in the docs' examples are digits; any URL-safe id is accepted
    external_id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, t.entryId)
      .optional()
      .describe(t.externalId),
  });
});

export const hatenaSchema = hatenaSchemaFor('zh-CN');

export type HatenaForm = z.infer<typeof hatenaSchema>;
export type HatenaFormInput = z.input<typeof hatenaSchema>;

export const hatenaKeyFormFor = byLang((lang) => {
  const k = msg(lang).key;
  return z.object({
    hatena_id: z.string().trim().regex(HATENA_ID, k.hatenaIdHint).describe(k.hatenaId),
    blog_id: z.string().trim().toLowerCase().regex(HATENA_BLOG_ID, k.blogIdHint).describe(k.blogId),
    api_key: z.string().trim().min(8, k.apiKeyHint).max(64).describe(k.apiKey),
  });
});

export const hatenaKeyForm = hatenaKeyFormFor('zh-CN');

export const hatenaBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'hatena',
  fields: ['hatena_id', 'blog_id', 'api_key'],
  form: hatenaKeyForm,
  formFor: hatenaKeyFormFor,
  helpUrl: 'https://developer.hatena.ne.jp/ja/documents/blog/apis/atom',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface HatenaEntryBody {
  entry: {
    title: string;
    content: string;
    categories: string[];
    draft: boolean;
    /** With `draft` and `updated` in the future: 予約投稿. */
    scheduled?: boolean;
    updated?: string;
    custom_url?: string;
  };
}

export interface HatenaRendered {
  title: string;
  content: string;
  format: 'markdown' | 'html';
  previewHtml: string;
  body: HatenaEntryBody;
  report: ReportItem[];
}

/** Pure: the body in the blog's syntax, the relay body and the predicted report. */
export function renderHatena(
  doc: Doc,
  form: HatenaForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): HatenaRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const m = msg(lang);
  const name = localizedLabel('hatena', 'はてなブログ', lang);
  const html = form.syntax === 'html';
  const degraded = degradeArticle(
    article.doc,
    {
      target: html ? 'html' : 'markdown',
      lang: article.lang,
      title: article.doc.title,
      // ⚠️ はてなブログ writes TeX as [tex:…] (MathJax); `$…$` is kept as source here
      math: html ? 'source' : 'dollar',
      video: 'link',
      stripHighlight: !html,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    name,
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    HATENA_LIMITS.titleMax,
    name,
    lang
  );
  const categories = fitTags(common.tags, { max: HATENA_LIMITS.categories }, name, lang);
  const report: ReportItem[] = [...mediaReport('hatena', 'はてなブログ', content, common, lang)];
  let body = degraded.body;
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, name, lang);
  if (form.origin_note && canonical.url) {
    const url = originLinkOf(form, article, canonical.url);
    body += html ? originNoteHtml(url, article.lang) : originNoteMarkdown(url, article.lang);
    report.push({ kind: 'origin.note', text: m.originNote });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, name, lang),
    ...title.report,
    ...categories.report,
    {
      kind: 'syntax.mode',
      level: 'notice',
      text: html ? m.syntaxHtml : m.syntaxMarkdown,
    }
  );
  const scheduled = !!form.schedule_at;
  if (scheduled)
    report.push({
      kind: 'scheduled',
      level: 'notice',
      text: m.scheduled(form.schedule_at),
    });
  else if (form.draft)
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: m.draftOnly,
    });

  return {
    title: title.title,
    content: body,
    format: html ? 'html' : 'markdown',
    previewHtml: degraded.doc.portableHtml,
    body: {
      entry: {
        title: title.title,
        content: body,
        categories: categories.tags,
        draft: form.draft || scheduled,
        ...(scheduled ? { scheduled: true, updated: form.schedule_at } : {}),
        ...(form.custom_url ? { custom_url: form.custom_url } : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function hatenaRef(links?: ErrorLinks): PlatformRef {
  return { key: 'hatena', label: 'はてなブログ', ...(links ? { links } : {}) };
}

/**
 * What 辰记's API sends (`app/services/relay_platforms.py`): verify `GET …/atom` (service document); publish `POST
 * …/atom/entry`, update `PUT …/atom/entry/{entry_id}`, both an Atom entry written from `body.entry`.
 */
export const HATENA_REQUESTS = {
  verify: {
    method: 'GET',
    url: `${HATENA_BLOG_API}/{hatena_id}/{blog_id}/atom`,
    auth: 'Authorization: Basic base64(<hatena_id>:<api_key>)',
    accept: 'application/atomsvc+xml',
  },
  create: {
    method: 'POST',
    url: `${HATENA_BLOG_API}/{hatena_id}/{blog_id}/atom/entry`,
    auth: 'Authorization: Basic base64(<hatena_id>:<api_key>)',
    body: 'Atom entry XML from HatenaEntryBody.entry',
  },
  update: {
    method: 'PUT',
    url: `${HATENA_BLOG_API}/{hatena_id}/{blog_id}/atom/entry/{id}`,
    auth: 'Authorization: Basic base64(<hatena_id>:<api_key>)',
    body: 'Atom entry XML from HatenaEntryBody.entry',
  },
} as const satisfies Record<string, RequestDescription>;

export function hatenaRelayBody(r: HatenaRendered): HatenaEntryBody {
  return r.body;
}

/* ---------------- adapter ---------------- */

export interface HatenaAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/hatena`). */
export function createHatenaAdapter(opts: HatenaAdapterOptions = {}): Adapter<typeof hatenaSchema> {
  const ref = hatenaRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'hatena',
    label: 'はてなブログ',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: hatenaBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: HATENA_LIMITS.titleMax },
    schema: hatenaSchema,
    schemaFor: hatenaSchemaFor,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderHatena(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: r.format,
        title: r.title,
        body: r.content,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderHatena(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(hatenaRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderHatena(doc, form, common, content, renderOpts(ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: msg(ctx.lang).relaying });
        const res = await relayPublish(ctx, ref, hatenaRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: msg(ctx.lang).done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (r.body.entry.draft ? 'draft' : 'published'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
