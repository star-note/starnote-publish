/**
 * Buttondown API (✅ docs.buttondown.com, OpenAPI docs.buttondown.com/openapi.json): base
 * `https://api.buttondown.com/v1`, `Authorization: Token <api key>` (the key is on buttondown.com/requests);
 * `X-API-Version: 2026-04-01` pins the version. `POST /emails` (`subject` required; `body` Markdown or HTML,
 * auto-detected — `<!-- buttondown-editor-mode: plaintext -->` forces Markdown; `status` `draft` | `scheduled` +
 * `publish_date` | `about_to_send` …; `description`, `slug`, `canonical_url`, `image`) → `Email {id, absolute_url,
 * status, …}`; `PATCH /emails/{id}` updates; `GET /newsletters` → `{results: [{id, name, username, …}]}`;
 * `GET /emails/{id}/analytics` → `recipients`, `opens`, `clicks`, `page_views_lifetime`, … Errors `{code?, detail}`;
 * 600 requests / minute.
 *
 * Safety: under API version 2026-04-01 the default status is `draft` and `about_to_send` needs the
 * `X-Buttondown-Live-Dangerously` header (changelog 「safer email API defaults」). 辰记 always sends `status` and never
 * sends `about_to_send`: drafts or scheduled emails only; the author presses send in Buttondown.
 * ⚠️ Whether `scheduled` also needs that header is not documented.
 *
 * Browser-safe: render + relay body only; 辰记's Python API holds the key and calls Buttondown (服务器代发).
 */
import { byLang, defineAdapter, mediaReport, mergeReports } from '@starnote/publish-core';
import {
  absoluteUrl,
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitSummary,
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
  SdkLang,
  StatsContext,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const BUTTONDOWN_API = 'https://api.buttondown.com/v1';
export const BUTTONDOWN_API_VERSION = '2026-04-01';
/** ✅ forces the Markdown editor mode (docs.buttondown.com/api-emails-create). */
export const BUTTONDOWN_MARKDOWN_MODE = '<!-- buttondown-editor-mode: plaintext -->';

export const BUTTONDOWN_LIMITS = {
  /** ⚠️ 待核实：subject / description 上限文档未写，按 200 / 300。 */
  subjectMax: 200,
  descriptionMax: 300,
} as const;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Email ids: UUIDs, or TypeIDs (`em_…`) since API version 2026-01-01. */
const EMAIL_ID = /^[A-Za-z0-9_-]{8,80}$/;

export const buttondownSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    status: z.enum(['draft', 'scheduled']).default('draft').describe(t.status),
    publish_date: z.string().trim().regex(ISO, t.isoTime).optional().describe(t.publishDate),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, t.slugRule)
      .optional()
      .describe(t.slug),
    set_canonical: z.boolean().default(true).describe(t.setCanonical),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    origin_note: z.boolean().default(false).describe(t.originNote),
    external_id: z.string().trim().regex(EMAIL_ID, t.emailId).optional().describe(t.externalId),
  });
});

export const buttondownSchema = buttondownSchemaFor('zh-CN');

export type ButtondownForm = z.infer<typeof buttondownSchema>;
export type ButtondownFormInput = z.input<typeof buttondownSchema>;

export const buttondownKeyFormFor = byLang((lang) => {
  const k = msg(lang).key;
  return z.object({
    api_key: z
      .string()
      .trim()
      .regex(/^\S{16,200}$/, k.apiKeyHint)
      .describe(k.apiKey),
  });
});

export const buttondownKeyForm = buttondownKeyFormFor('zh-CN');

export const buttondownBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'buttondown',
  fields: ['api_key'],
  form: buttondownKeyForm,
  formFor: buttondownKeyFormFor,
  createUrl: 'https://buttondown.com/requests',
  helpUrl: 'https://docs.buttondown.com/api-introduction',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface ButtondownEmailBody {
  email: {
    subject: string;
    body: string;
    status: 'draft' | 'scheduled';
    publish_date?: string;
    description?: string;
    slug?: string;
    canonical_url?: string;
    image?: string;
  };
}

export interface ButtondownRendered {
  title: string;
  markdown: string;
  previewHtml: string;
  body: ButtondownEmailBody;
  report: ReportItem[];
}

/** Pure: the Markdown, the request body and the predicted report. */
export function renderButtondown(
  doc: Doc,
  form: ButtondownForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): ButtondownRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const m = msg(lang);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'markdown',
      lang: article.lang,
      title: article.doc.title,
      math: 'source',
      video: 'link',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'Buttondown',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    BUTTONDOWN_LIMITS.subjectMax,
    'Buttondown',
    lang
  );
  const summary = fitSummary(common.summary, BUTTONDOWN_LIMITS.descriptionMax, 'Buttondown', lang);
  const canonical = canonicalOf(form, article, 'Buttondown', lang);
  const cover = absoluteUrl(common.cover, opts.assetBase);
  const report: ReportItem[] = [...mediaReport('buttondown', 'Buttondown', content, common, lang)];
  let markdown = degraded.body;
  if (form.origin_note && canonical.url) {
    markdown += originNoteMarkdown(originLinkOf(form, article, canonical.url), article.lang);
    report.push({ kind: 'origin.note', text: m.originNote });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'Buttondown', lang),
    ...title.report,
    ...summary.report,
    ...canonical.report
  );
  const scheduled = form.status === 'scheduled';
  if (scheduled && !form.publish_date)
    report.push({ kind: 'schedule.missing', level: 'error', text: m.scheduleMissing });
  report.push(
    scheduled
      ? {
          kind: 'scheduled',
          level: 'notice',
          text: m.scheduled(form.publish_date),
        }
      : {
          kind: 'draft.only',
          level: 'notice',
          text: m.draftOnly,
        }
  );

  return {
    title: title.title,
    markdown,
    previewHtml: degraded.doc.portableHtml,
    body: {
      email: {
        subject: title.title,
        body: `${BUTTONDOWN_MARKDOWN_MODE}\n${markdown}`,
        status: form.status,
        ...(scheduled && form.publish_date ? { publish_date: form.publish_date } : {}),
        ...(summary.summary ? { description: summary.summary } : {}),
        ...(form.slug ? { slug: form.slug } : {}),
        ...(canonical.url ? { canonical_url: canonical.url } : {}),
        ...(cover ? { image: cover } : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function buttondownRef(links?: ErrorLinks): PlatformRef {
  return { key: 'buttondown', label: 'Buttondown', ...(links ? { links } : {}) };
}

/** What 辰记's API sends to Buttondown (`app/services/relay_platforms.py`): `body.email` as is. */
export const BUTTONDOWN_REQUESTS = {
  verify: {
    method: 'GET',
    url: `${BUTTONDOWN_API}/newsletters`,
    auth: 'Authorization: Token <api_key>',
  },
  create: {
    method: 'POST',
    url: `${BUTTONDOWN_API}/emails`,
    auth: 'Authorization: Token <api_key>',
    body: 'ButtondownEmailBody.email',
  },
  update: {
    method: 'PATCH',
    url: `${BUTTONDOWN_API}/emails/{id}`,
    auth: 'Authorization: Token <api_key>',
    body: 'ButtondownEmailBody.email',
  },
} as const satisfies Record<string, RequestDescription>;

export function buttondownRelayBody(r: ButtondownRendered): ButtondownEmailBody {
  return r.body;
}

/** ✅ `GET /emails/{id}/analytics`: archive views, unique opens and clicks (null until the email was sent). */
export async function fetchButtondownStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  if (!EMAIL_ID.test(externalId)) return null;
  const key = ctx.credential?.api_key;
  const a = await readJson<Record<string, unknown>>(
    ctx,
    buttondownRef(),
    `${BUTTONDOWN_API}/emails/${externalId}/analytics`,
    {
      headers: {
        'X-API-Version': BUTTONDOWN_API_VERSION,
        ...(key ? { Authorization: `Token ${key}` } : {}),
      },
    }
  );
  if (!a) return null;
  const extra: Record<string, number> = {};
  for (const k of ['recipients', 'clicks', 'unsubscriptions']) {
    const v = num(a[k]);
    if (v !== undefined) extra[k] = v;
  }
  return stats('official-api', {
    views: num(a.page_views_lifetime),
    reads: num(a.opens),
    comments: num(a.comments),
    extra,
  });
}

/* ---------------- adapter ---------------- */

export interface ButtondownAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/buttondown`). */
export function createButtondownAdapter(
  opts: ButtondownAdapterOptions = {}
): Adapter<typeof buttondownSchema> {
  const ref = buttondownRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'buttondown',
    label: 'Buttondown',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: buttondownBinding,
    capabilities: {
      supportsUpdate: true,
      needsLogin: true,
      titleMax: BUTTONDOWN_LIMITS.subjectMax,
    },
    schema: buttondownSchema,
    schemaFor: buttondownSchemaFor,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchButtondownStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderButtondown(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderButtondown(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(buttondownRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderButtondown(doc, form, common, content, renderOpts(ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: msg(ctx.lang).relaying });
        const res = await relayPublish(ctx, ref, buttondownRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: msg(ctx.lang).done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.status === 'scheduled' ? 'published' : 'draft'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
