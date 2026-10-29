/**
 * Qiita API v2 (✅ qiita.com/api/v2/docs, schema qiita.com/api/v2/schema): `POST /api/v2/items`,
 * `PATCH /api/v2/items/:item_id`, `GET /api/v2/authenticated_user`; `Authorization: Bearer <token>` with the
 * `write_qiita` (+ `read_qiita`) scope, issued at qiita.com/settings/applications. Body is Markdown; `title`, `body`
 * and `tags` (`[{name, versions}]`) are required; `private: true` = 限定共有記事 (the API has no draft). Tags: 1–5
 * (✅ help.qiita.com/ja/articles/qiita-tag「最大5個」, no `/`). Rate limit 1000 requests / hour per user.
 *
 * Browser-safe: render + relay body only; 辰记's Python API holds the token and calls Qiita (服务器代发).
 */
import {
  byLang,
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
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
  StatsContext,
  SdkLang,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const QIITA_API = 'https://qiita.com/api/v2';

export const QIITA_LIMITS = {
  /** ✅ help.qiita.com：タグは最大 5 個、最低 1 個 */
  tags: 5,
  /** ⚠️ 待核实：标题上限文档未写，按 255 截断。 */
  titleMax: 255,
  /** ⚠️ 待核实：标签字数上限文档未写，按 32。 */
  tagMax: 32,
} as const;

/** Item ids are 20 hex characters (✅ API docs: `"id": "c686397e4a0f4f11683d"`). */
const ITEM_ID = /^[0-9a-f]{20}$/;

/** Qiita tag name: no `/` (✅ help), spaces → `-` (⚠️ 社区经验：标签不能含空格). `null` when nothing is left. */
export function qiitaTag(tag: string): string | null {
  const t = tag
    .trim()
    .replace(/\//g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return t ? [...t].slice(0, QIITA_LIMITS.tagMax).join('') : null;
}

export const qiitaSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** true: 限定共有記事 (only people with the link can read it) — the API has no draft. */
    private: z.boolean().default(false).describe(t.private),
    /** Appends 「この記事は StarNote で最初に公開されました」 with the link (Qiita has no canonical field). */
    origin_note: z.boolean().default(true).describe(t.originNote),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    /** Post as an Organization member (the organization's URL name). */
    organization_url_name: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, t.orgRule)
      .optional()
      .describe(t.organization),
    /** The Qiita item id from an earlier publish: set it to update instead of creating. */
    external_id: z.string().trim().regex(ITEM_ID, t.itemId).optional().describe(t.externalId),
  });
});

export const qiitaSchema = qiitaSchemaFor('zh-CN');

export type QiitaForm = z.infer<typeof qiitaSchema>;
export type QiitaFormInput = z.input<typeof qiitaSchema>;

export const qiitaKeyFormFor = byLang((lang) => {
  const k = msg(lang).key;
  return z.object({
    token: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{40}$/i, k.tokenHint)
      .describe(k.token),
  });
});

export const qiitaKeyForm = qiitaKeyFormFor('zh-CN');

export const qiitaBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'qiita',
  fields: ['token'],
  form: qiitaKeyForm,
  formFor: qiitaKeyFormFor,
  scopes: ['read_qiita', 'write_qiita'],
  createUrl: 'https://qiita.com/settings/applications',
  helpUrl: 'https://qiita.com/api/v2/docs',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface QiitaTagBody {
  name: string;
  versions: string[];
}

export interface QiitaItemBody {
  item: {
    title: string;
    body: string;
    tags: QiitaTagBody[];
    private: boolean;
    organization_url_name?: string;
  };
}

export interface QiitaRendered {
  title: string;
  markdown: string;
  previewHtml: string;
  body: QiitaItemBody;
  report: ReportItem[];
}

/** Pure: the Markdown, the request body and the predicted report. */
export function renderQiita(
  doc: Doc,
  form: QiitaForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): QiitaRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const m = msg(lang);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'markdown',
      lang: article.lang,
      title: article.doc.title,
      // ✅ Qiita Markdown: `$…$` inline math and ```math blocks
      math: 'dollar',
      video: 'link',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'Qiita',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    QIITA_LIMITS.titleMax,
    'Qiita',
    lang
  );
  const tags = fitTags(common.tags, { max: QIITA_LIMITS.tags, normalize: qiitaTag }, 'Qiita', lang);
  const report: ReportItem[] = [...mediaReport('qiita', 'Qiita', content, common, lang)];
  let markdown = degraded.body;
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, 'Qiita', lang);
  if (form.origin_note && canonical.url) {
    markdown += originNoteMarkdown(originLinkOf(form, article, canonical.url), article.lang);
    report.push({
      kind: 'origin.note',
      text: m.originNote,
    });
  }
  if (!tags.tags.length)
    report.push({
      kind: 'tags.required',
      level: 'error',
      text: m.tagsRequired,
    });
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'Qiita', lang),
    ...title.report,
    ...tags.report
  );
  if (form.private)
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: m.private,
    });

  return {
    title: title.title,
    markdown,
    previewHtml: degraded.doc.portableHtml,
    body: {
      item: {
        title: title.title,
        body: markdown,
        tags: tags.tags.map((name) => ({ name, versions: [] })),
        private: form.private,
        ...(form.organization_url_name
          ? { organization_url_name: form.organization_url_name }
          : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function qiitaRef(links?: ErrorLinks): PlatformRef {
  return { key: 'qiita', label: 'Qiita', ...(links ? { links } : {}) };
}

/**
 * What 辰记's API sends to Qiita (`app/services/relay_platforms.py`): verify `GET /authenticated_user` → `{id, name,
 * profile_image_url}`; publish `POST /items`, update `PATCH /items/{id}`, both with `body.item` as is.
 */
export const QIITA_REQUESTS = {
  verify: {
    method: 'GET',
    url: `${QIITA_API}/authenticated_user`,
    auth: 'Authorization: Bearer <token>',
  },
  create: {
    method: 'POST',
    url: `${QIITA_API}/items`,
    auth: 'Authorization: Bearer <token>',
    body: 'QiitaItemBody.item',
  },
  update: {
    method: 'PATCH',
    url: `${QIITA_API}/items/{id}`,
    auth: 'Authorization: Bearer <token>',
    body: 'QiitaItemBody.item',
  },
} as const satisfies Record<string, RequestDescription>;

/** What the browser posts to 辰记's API for Qiita. */
export function qiitaRelayBody(r: QiitaRendered): QiitaItemBody {
  return r.body;
}

/**
 * ✅ `GET /api/v2/items/:item_id`: `likes_count`, `stocks_count`, `comments_count`, `page_views_count` (⚠️ the views
 * are only filled for the author's own items with a token — community reports, not the docs). A pasted link resolves
 * to the item id.
 */
export async function fetchQiitaStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const id = isUrlExternalId(externalId)
    ? parsePostUrl('qiita', externalId)?.externalId
    : externalId;
  if (!id || !ITEM_ID.test(id)) return null;
  const token = ctx.credential?.access_token ?? ctx.credential?.api_key;
  const item = await readJson<Record<string, unknown>>(
    ctx,
    qiitaRef(),
    `${QIITA_API}/items/${id}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }
  );
  if (!item) return null;
  return stats('official-api', {
    views: num(item.page_views_count),
    likes: num(item.likes_count),
    comments: num(item.comments_count),
    favorites: num(item.stocks_count),
  });
}

/* ---------------- adapter ---------------- */

export interface QiitaAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/qiita`). */
export function createQiitaAdapter(opts: QiitaAdapterOptions = {}): Adapter<typeof qiitaSchema> {
  const ref = qiitaRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'qiita',
    label: 'Qiita',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: qiitaBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: QIITA_LIMITS.titleMax },
    schema: qiitaSchema,
    schemaFor: qiitaSchemaFor,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchQiitaStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderQiita(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderQiita(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(qiitaRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderQiita(doc, form, common, content, renderOpts(ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: msg(ctx.lang).relaying });
        const res = await relayPublish(ctx, ref, qiitaRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: msg(ctx.lang).done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
