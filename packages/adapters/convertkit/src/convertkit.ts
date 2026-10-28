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
import { defineAdapter, mediaReport, mergeReports } from '@starnote/publish-core';
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

export const convertkitSchema = z.object({
  /** `draft`: saved in Kit, sent from there; `schedule`: Kit sends it at `send_at`. */
  send: z.enum(['draft', 'schedule']).default('draft').describe('发送方式'),
  send_at: z
    .string()
    .trim()
    .regex(ISO, '请填写带时区的时间，如 2026-11-01T09:00:00+08:00')
    .optional()
    .describe('定时发送时间'),
  /** Also list it on the Kit web newsletter feed (Creator Profile / landing pages). */
  public: z.boolean().default(false).describe('同时发布到 Kit 网页'),
  origin_note: z.boolean().default(true).describe('文末注明原文'),
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  /** The broadcast id of an earlier publish: set it to update the (unsent) broadcast. */
  external_id: z
    .string()
    .trim()
    .regex(/^\d+$/, '广播 ID 是数字')
    .optional()
    .describe('已建广播 ID'),
});

export type ConvertkitForm = z.infer<typeof convertkitSchema>;
export type ConvertkitFormInput = z.input<typeof convertkitSchema>;

export const convertkitKeyForm = z.object({
  api_key: z
    .string()
    .trim()
    .regex(/^\S{16,200}$/, '请粘贴 Kit 设置 → Developer 里生成的 v4 API key')
    .describe('API key'),
});

export const convertkitBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'convertkit',
  fields: ['api_key'],
  form: convertkitKeyForm,
  createUrl: 'https://app.kit.com/account_settings/developer_settings',
  helpUrl: 'https://developers.kit.com/api-reference/authentication',
  instructions: [
    '打开 Kit 的 Settings → Developer，点「Add a new key」，起名「StarNote」',
    'Kit 只显示一次 key：立刻复制，粘贴到这里并点「测试连接」',
    '辰记默认把文章存为 Kit 的草稿（broadcast），由你在 Kit 里检查后发送；不用时在同一页删除 key',
  ],
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
  opts: { assetBase?: string } = {}
): ConvertkitRendered {
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
    'Kit'
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    KIT_LIMITS.subjectMax,
    'Kit'
  );
  const summary = fitSummary(common.summary, KIT_LIMITS.previewMax, 'Kit');
  const cover = absoluteUrl(common.cover, opts.assetBase);
  const report: ReportItem[] = [...mediaReport('convertkit', 'Kit', content, common)];
  let html = degraded.body;
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, 'Kit');
  if (form.origin_note && canonical.url) {
    html += originNoteHtml(originLinkOf(form, article, canonical.url), article.lang);
    report.push({ kind: 'origin.note', text: '邮件末尾注明首发于辰记并附原文链接' });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'Kit'),
    ...title.report,
    ...summary.report
  );
  const schedule = form.send === 'schedule' && form.send_at ? form.send_at : null;
  if (form.send === 'schedule' && !form.send_at)
    report.push({
      kind: 'schedule.missing',
      level: 'error',
      text: '定时发送需要填写发送时间',
    });
  report.push(
    schedule
      ? {
          kind: 'scheduled',
          level: 'notice',
          text: `Kit 将在 ${schedule} 发给订阅者（默认全部订阅者）`,
        }
      : { kind: 'draft.only', level: 'notice', text: '存为 Kit 草稿，在 Kit 里检查收件人后发送' }
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
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'convertkit',
    label: 'Kit',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: convertkitBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: KIT_LIMITS.subjectMax },
    schema: convertkitSchema,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchConvertkitStats(externalId, ctx);
    },
    preview(doc, form, common, content): AdapterPreview {
      const r = renderConvertkit(doc, form, common, content, renderOpts);
      return {
        format: 'html',
        title: r.title,
        body: r.html,
        previewHtml: r.html,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous }) {
      const r = renderConvertkit(doc, form, common, content, renderOpts);
      return relayRequestOf(convertkitRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderConvertkit(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '由服务器代发到 Kit' });
        const res = await relayPublish(ctx, ref, convertkitRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
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
