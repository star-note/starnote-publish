/**
 * Kit (formerly ConvertKit) API v4 (✅ developers.kit.com): base `https://api.kit.com/v4`, API key in `X-Kit-Api-Key`
 * (created under Settings → Developer, app.kit.com/account_settings/developer_settings; meant for one's own account).
 * `GET /account` → `{user: {email, id}, account: {id, name, primary_email_address, …}}`; `POST /broadcasts` creates a
 * broadcast (HTML `content`, `subject`, `description`, `preview_text`, `public` = also on the web feed,
 * `published_at`, `send_at` — `null` saves a draft, a timestamp schedules the send, `thumbnail_url` / `_alt`);
 * `PUT /broadcasts/{id}` replaces it (422 once sending started); `GET /broadcasts/{id}/stats` → `recipients`,
 * `open_rate`, `click_rate`, `emails_opened`, `total_clicks`, … Errors `{errors: ["…"]}`; 120 requests / 60 s per key.
 *
 * ⚠️ The docs disagree on drafts: the create page says `send_at: null`, the update page says `public: false`; we send
 * `send_at: null` and leave `public` to the form. `subscriber_filter` is listed as required but documented to default
 * to all subscribers when absent — we omit it. The broadcast's page in the Kit app (when `public_url` is null) is
 * `app.kit.com/campaigns/{id}/draft` by observation, not documented.
 *
 * Browser-safe: render + relay body only; 辰记's Python API holds the key and calls Kit (服务器代发).
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
  originNoteHtml,
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

export const KIT_API = 'https://api.kit.com/v4';

export const KIT_LIMITS = {
  /** ⚠️ 待核实：主题行上限文档未写，按 150 截断（邮件客户端显示得下的长度）。 */
  subjectMax: 150,
  /** ⚠️ 待核实：preview_text 上限文档未写，按 200。 */
  previewMax: 200,
} as const;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const convertkitSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** `draft`: saved in Kit, sent from there; `schedule`: Kit sends it at `send_at`. */
    send: z.enum(['draft', 'schedule']).default('draft').describe(t.send),
    send_at: z.string().trim().regex(ISO, t.isoTime).optional().describe(t.sendAt),
    /** Also list it on the Kit web newsletter feed (Creator Profile / landing pages). */
    public: z.boolean().default(false).describe(t.public),
    origin_note: z.boolean().default(true).describe(t.originNote),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    /** The broadcast id of an earlier publish: set it to update the (unsent) broadcast. */
    external_id: z.string().trim().regex(/^\d+$/, t.idDigits).optional().describe(t.externalId),
  });
});

export const convertkitSchema = convertkitSchemaFor('zh-CN');

export type ConvertkitForm = z.infer<typeof convertkitSchema>;
export type ConvertkitFormInput = z.input<typeof convertkitSchema>;

export const convertkitKeyFormFor = byLang((lang) =>
  z.object({
    api_key: z
      .string()
      .trim()
      .regex(/^\S{16,200}$/, msg(lang).key.apiKeyHint)
      .describe(msg(lang).key.apiKey),
  })
);

export const convertkitKeyForm = convertkitKeyFormFor('zh-CN');

export const convertkitBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'convertkit',
  fields: ['api_key'],
  form: convertkitKeyForm,
  formFor: convertkitKeyFormFor,
  createUrl: 'https://app.kit.com/account_settings/developer_settings',
  helpUrl: 'https://developers.kit.com/api-reference/authentication',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface ConvertkitBroadcastBody {
  broadcast: {
    subject: string;
    content: string;
    description: string;
    preview_text: string;
    public: boolean;
    send_at: string | null;
    published_at?: string;
    thumbnail_url?: string;
    thumbnail_alt?: string;
  };
}

export interface ConvertkitRendered {
  title: string;
  html: string;
  body: ConvertkitBroadcastBody;
  report: ReportItem[];
}

/** Pure: the email HTML, the request body and the predicted report. */
export function renderConvertkit(
  doc: Doc,
  form: ConvertkitForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): ConvertkitRendered {
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
    'Kit',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    KIT_LIMITS.subjectMax,
    'Kit',
    lang
  );
  const summary = fitSummary(common.summary, KIT_LIMITS.previewMax, 'Kit', lang);
  const cover = absoluteUrl(common.cover, opts.assetBase);
  const report: ReportItem[] = [...mediaReport('convertkit', 'Kit', content, common, lang)];
  let html = degraded.body;
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, 'Kit', lang);
  if (form.origin_note && canonical.url) {
    html += originNoteHtml(originLinkOf(form, article, canonical.url), article.lang);
    report.push({ kind: 'origin.note', text: t.originNote });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'Kit', lang),
    ...title.report,
    ...summary.report
  );
  const schedule = form.send === 'schedule' && form.send_at ? form.send_at : null;
  if (form.send === 'schedule' && !form.send_at)
    report.push({
      kind: 'schedule.missing',
      level: 'error',
      text: t.scheduleMissing,
    });
  report.push(
    schedule
      ? {
          kind: 'scheduled',
          level: 'notice',
          text: t.scheduled(schedule),
        }
      : { kind: 'draft.only', level: 'notice', text: t.draftOnly }
  );

  return {
    title: title.title,
    html,
    body: {
      broadcast: {
        subject: title.title,
        content: html,
        description: summary.summary ?? '',
        preview_text: summary.summary ?? '',
        public: form.public,
        send_at: schedule,
        ...(form.public && article.publishedAt ? { published_at: article.publishedAt } : {}),
        ...(cover ? { thumbnail_url: cover, thumbnail_alt: common.coverAlt || title.title } : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function convertkitRef(links?: ErrorLinks): PlatformRef {
  return { key: 'convertkit', label: 'Kit', ...(links ? { links } : {}) };
}

/** What 辰记's API sends to Kit (`app/services/relay_platforms.py`): `body.broadcast` as is. */
export const CONVERTKIT_REQUESTS = {
  verify: { method: 'GET', url: `${KIT_API}/account`, auth: 'X-Kit-Api-Key: <api_key>' },
  create: {
    method: 'POST',
    url: `${KIT_API}/broadcasts`,
    auth: 'X-Kit-Api-Key: <api_key>',
    body: 'ConvertkitBroadcastBody.broadcast',
  },
  update: {
    method: 'PUT',
    url: `${KIT_API}/broadcasts/{id}`,
    auth: 'X-Kit-Api-Key: <api_key>',
    body: 'ConvertkitBroadcastBody.broadcast',
  },
} as const satisfies Record<string, RequestDescription>;

export function convertkitRelayBody(r: ConvertkitRendered): ConvertkitBroadcastBody {
  return r.body;
}

/** ✅ `GET /broadcasts/{id}/stats`: recipients, opens, clicks (rates in `extra`). */
export async function fetchConvertkitStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  if (!/^\d+$/.test(externalId)) return null;
  const key = ctx.credential?.api_key;
  const res = await readJson<{ broadcast?: { stats?: Record<string, unknown> } }>(
    ctx,
    convertkitRef(),
    `${KIT_API}/broadcasts/${externalId}/stats`,
    { headers: key ? { 'X-Kit-Api-Key': key } : {} }
  );
  const s = res?.broadcast?.stats;
  if (!s) return null;
  const extra: Record<string, number> = {};
  for (const k of ['recipients', 'open_rate', 'click_rate', 'unsubscribes', 'total_clicks']) {
    const v = num(s[k]);
    if (v !== undefined) extra[k] = v;
  }
  return stats('official-api', { reads: num(s.emails_opened), extra });
}

/* ---------------- adapter ---------------- */

export interface ConvertkitAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/convertkit`). */
export function createConvertkitAdapter(
  opts: ConvertkitAdapterOptions = {}
): Adapter<typeof convertkitSchema> {
  const ref = convertkitRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'convertkit',
    label: 'Kit',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: convertkitBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: KIT_LIMITS.subjectMax },
    schema: convertkitSchema,
    schemaFor: convertkitSchemaFor,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchConvertkitStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderConvertkit(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'html',
        title: r.title,
        body: r.html,
        previewHtml: r.html,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderConvertkit(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(convertkitRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderConvertkit(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.relaying });
        const res = await relayPublish(ctx, ref, convertkitRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (r.body.broadcast.send_at ? 'published' : 'draft'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
