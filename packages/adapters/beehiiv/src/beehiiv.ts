/**
 * beehiiv API v2 (✅ developers.beehiiv.com): base `https://api.beehiiv.com/v2`, `Authorization: Bearer <api key>`.
 * `POST /publications/{publicationId}/posts` — 「available to publications on the Pro and Enterprise plans」 — takes
 * `title` + raw HTML `body_content` (wrapped in an HTML snippet block; `<style>` / `<link>` stripped), `subtitle`,
 * `status` (`draft` default | `confirmed` = publish now or at `scheduled_at`; drafts cannot be scheduled),
 * `content_tags`, `thumbnail_image_url`; answers 201 `{data: {id: "post_…", preview_url}}` and finishes creating in
 * the background. `PATCH …/posts/{postId}` updates (status only draft → confirmed). `GET /publications/{id}` →
 * `{data: {id: "pub_…", name}}`; `GET …/posts/{id}?expand=stats` → `stats.email` (recipients, open_rate,
 * click_rate, …) and `stats.web` (views, clicks). Errors `{status, statusText, errors: [{message, code}]}`; rate limit
 * by plan (Pro 500 / min).
 *
 * ⚠️ Where the API key is created (Settings → Integrations → API) comes from third-party guides — beehiiv's own
 * 「Create an API key」 page could not be read. Recipients default to the free tier (web + email).
 *
 * Browser-safe: render + relay body only; 辰记's Python API holds the key and calls beehiiv (服务器代发).
 */
import { byLang, defineAdapter, mediaReport, mergeReports } from '@starnote/publish-core';
import {
  absoluteUrl,
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitSummary,
  fitTags,
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

export const BEEHIIV_API = 'https://api.beehiiv.com/v2';

export const BEEHIIV_LIMITS = {
  /** ⚠️ 待核实：标题 / 副标题上限文档未写，按 250 / 250。 */
  titleMax: 250,
  subtitleMax: 250,
  /** ⚠️ 待核实：content_tags 数量文档未写，按 10。 */
  tags: 10,
} as const;

export const BEEHIIV_PUBLICATION = /^pub_[0-9a-f-]{36}$/;
const POST_ID = /^post_[0-9a-f-]{36}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const beehiivSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /**
     * `draft`: saved in beehiiv; `confirmed`: published to the web and sent to the subscribers right away;
     * `schedule`: confirmed with `scheduled_at`.
     */
    status: z.enum(['draft', 'confirmed', 'schedule']).default('draft').describe(t.status),
    scheduled_at: z.string().trim().regex(ISO, t.isoTime).optional().describe(t.scheduledAt),
    origin_note: z.boolean().default(true).describe(t.originNote),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    external_id: z.string().trim().regex(POST_ID, t.postId).optional().describe(t.externalId),
  });
});

export const beehiivSchema = beehiivSchemaFor('zh-CN');

export type BeehiivForm = z.infer<typeof beehiivSchema>;
export type BeehiivFormInput = z.input<typeof beehiivSchema>;

export const beehiivKeyFormFor = byLang((lang) => {
  const k = msg(lang).key;
  return z.object({
    api_key: z
      .string()
      .trim()
      .regex(/^\S{20,200}$/, k.apiKeyHint)
      .describe(k.apiKey),
    publication_id: z
      .string()
      .trim()
      .regex(BEEHIIV_PUBLICATION, k.publicationHint)
      .describe(k.publication),
  });
});

export const beehiivKeyForm = beehiivKeyFormFor('zh-CN');

export const beehiivBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'beehiiv',
  fields: ['api_key', 'publication_id'],
  form: beehiivKeyForm,
  formFor: beehiivKeyFormFor,
  // ⚠️ Settings → Integrations → API（第三方集成文档的说法）
  createUrl: 'https://app.beehiiv.com/settings/integrations',
  helpUrl: 'https://developers.beehiiv.com/api-reference/posts/create',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface BeehiivPostBody {
  post: {
    title: string;
    body_content: string;
    status: 'draft' | 'confirmed';
    subtitle?: string;
    scheduled_at?: string;
    content_tags?: string[];
    thumbnail_image_url?: string;
  };
}

export interface BeehiivRendered {
  title: string;
  html: string;
  body: BeehiivPostBody;
  report: ReportItem[];
}

/** Pure: the HTML, the request body and the predicted report. */
export function renderBeehiiv(
  doc: Doc,
  form: BeehiivForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; lang?: SdkLang } = {}
): BeehiivRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const m = msg(lang);
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
    'beehiiv',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    BEEHIIV_LIMITS.titleMax,
    'beehiiv',
    lang
  );
  const subtitle = fitSummary(common.summary, BEEHIIV_LIMITS.subtitleMax, 'beehiiv', lang);
  const tags = fitTags(common.tags, { max: BEEHIIV_LIMITS.tags }, 'beehiiv', lang);
  const cover = absoluteUrl(common.cover, opts.assetBase);
  const report: ReportItem[] = [...mediaReport('beehiiv', 'beehiiv', content, common, lang)];
  let html = degraded.body;
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, 'beehiiv', lang);
  if (form.origin_note && canonical.url) {
    html += originNoteHtml(originLinkOf(form, article, canonical.url), article.lang);
    report.push({ kind: 'origin.note', text: m.originNote });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'beehiiv', lang),
    ...title.report,
    ...subtitle.report,
    ...tags.report
  );
  const scheduledAt = form.status === 'schedule' ? form.scheduled_at : undefined;
  if (form.status === 'schedule' && !scheduledAt)
    report.push({ kind: 'schedule.missing', level: 'error', text: m.scheduleMissing });
  report.push(
    form.status === 'draft'
      ? { kind: 'draft.only', level: 'notice', text: m.draftOnly }
      : scheduledAt
        ? {
            kind: 'scheduled',
            level: 'notice',
            text: m.scheduled(scheduledAt),
          }
        : { kind: 'sent.now', level: 'warn', text: m.sentNow }
  );

  return {
    title: title.title,
    html,
    body: {
      post: {
        title: title.title,
        body_content: html,
        status: form.status === 'draft' ? 'draft' : 'confirmed',
        ...(subtitle.summary ? { subtitle: subtitle.summary } : {}),
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
        ...(tags.tags.length ? { content_tags: tags.tags } : {}),
        ...(cover ? { thumbnail_image_url: cover } : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function beehiivRef(links?: ErrorLinks): PlatformRef {
  return { key: 'beehiiv', label: 'beehiiv', ...(links ? { links } : {}) };
}

/** What 辰记's API sends to beehiiv (`app/services/relay_platforms.py`): `body.post` as is. */
export const BEEHIIV_REQUESTS = {
  verify: {
    method: 'GET',
    url: `${BEEHIIV_API}/publications/{publication_id}`,
    auth: 'Authorization: Bearer <api_key>',
  },
  create: {
    method: 'POST',
    url: `${BEEHIIV_API}/publications/{publication_id}/posts`,
    auth: 'Authorization: Bearer <api_key>',
    body: 'BeehiivPostBody.post',
  },
  update: {
    method: 'PATCH',
    url: `${BEEHIIV_API}/publications/{publication_id}/posts/{id}`,
    auth: 'Authorization: Bearer <api_key>',
    body: 'BeehiivPostBody.post',
  },
} as const satisfies Record<string, RequestDescription>;

export function beehiivRelayBody(r: BeehiivRendered): BeehiivPostBody {
  return r.body;
}

/**
 * ✅ `GET …/posts/{id}?expand=stats` (needs the publication: the desktop's fetch takes it from the account, the server
 * reads it from the stored credential): web views, email opens and clicks.
 */
export async function fetchBeehiivStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const pub = ctx.account?.meta?.publication_id;
  if (!POST_ID.test(externalId) || typeof pub !== 'string' || !BEEHIIV_PUBLICATION.test(pub))
    return null;
  const key = ctx.credential?.api_key;
  const res = await readJson<{ data?: { stats?: { email?: any; web?: any } } }>(
    ctx,
    beehiivRef(),
    `${BEEHIIV_API}/publications/${pub}/posts/${externalId}?expand=stats`,
    { headers: key ? { Authorization: `Bearer ${key}` } : {} }
  );
  const s = res?.data?.stats;
  if (!s) return null;
  const extra: Record<string, number> = {};
  for (const [k, v] of [
    ['recipients', s.email?.recipients],
    ['open_rate', s.email?.open_rate],
    ['click_rate', s.email?.click_rate],
    ['web_clicks', s.web?.clicks],
  ] as const) {
    const n = num(v);
    if (n !== undefined) extra[k] = n;
  }
  return stats('official-api', {
    views: num(s.web?.views),
    reads: num(s.email?.unique_opens),
    extra,
  });
}

/* ---------------- adapter ---------------- */

export interface BeehiivAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/beehiiv`). */
export function createBeehiivAdapter(
  opts: BeehiivAdapterOptions = {}
): Adapter<typeof beehiivSchema> {
  const ref = beehiivRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'beehiiv',
    label: 'beehiiv',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: beehiivBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: BEEHIIV_LIMITS.titleMax },
    schema: beehiivSchema,
    schemaFor: beehiivSchemaFor,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchBeehiivStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderBeehiiv(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'html',
        title: r.title,
        body: r.html,
        previewHtml: r.html,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderBeehiiv(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(beehiivRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderBeehiiv(doc, form, common, content, renderOpts(ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: msg(ctx.lang).relaying });
        const res = await relayPublish(ctx, ref, beehiivRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: msg(ctx.lang).done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (r.body.post.status === 'draft' ? 'draft' : 'published'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
