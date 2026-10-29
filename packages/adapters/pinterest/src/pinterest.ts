/**
 * Pinterest (API v5 ✅ developers.pinterest.com/docs/api/v5, SPEC-r11 §10): a Pin with the cover image and the link
 * back to 辰记. Bound with OAuth (`boards:read, pins:read, pins:write, user_accounts:read`); the user picks a board
 * when binding (kept as `account.meta.board_id`). 辰记's API sends `POST /v5/pins { board_id, title, description,
 * link, alt_text, media_source: { source_type: 'image_url', url } }`; `PINTEREST_API_BASE` (env) switches to the
 * sandbox (`https://api-sandbox.pinterest.com`).
 *
 * ⚠️ An app on the Trial tier creates Pins only its owner can see; Standard access needs Pinterest's review.
 *
 * Not bound: the existing pin/create button hand-off (`@starnote/publish-share`).
 */
import {
  byLang,
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
  platformMeta,
} from '@starnote/publish-core';
import {
  cardOf,
  codePoints,
  credentialOf,
  fitPost,
  guard,
  helpError,
  missingLinkReport,
  newPostReport,
  refIn,
  num,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
  truncate,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
import { z } from 'zod';

import { msg } from './i18n';

import type {
  AccountRef,
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PlatformStats,
  PublishContent,
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
  SdkLang,
  StatsContext,
} from '@starnote/publish-core';
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';

export const PINTEREST_API = 'https://api.pinterest.com';

export const PINTEREST_LIMITS = {
  /** ✅ Pin title up to 100 characters. */
  titleMax: 100,
  /** ⚠️ 待核实：description 500（v5 文档写 800；分享按钮的经验值 500，取小的）。 */
  descriptionMax: 500,
  /** ✅ alt_text up to 500 characters. */
  altMax: 500,
  maxTags: 3,
  /** ⚠️ analytics: start_date at most 90 days back. */
  analyticsDays: 90,
} as const;

const URL_RE = /^https?:\/\/\S+$/;

/** The form in a language (SPEC-r14 B5). */
export const pinterestSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** Default: the board picked when binding (`account.meta.board_id`). */
    board_id: z
      .string()
      .trim()
      .regex(/^\d{1,30}$/, t.boardDigits)
      .optional()
      .describe(t.board),
    /** Your own description instead of the summary. */
    text: z.string().trim().max(2000).optional().describe(t.text),
    link: z.string().trim().regex(URL_RE, t.httpUrl).optional().describe(t.link),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    include_tags: z.boolean().default(true).describe(t.includeTags),
    alt_text: z.string().trim().max(PINTEREST_LIMITS.altMax).optional().describe(t.altText),
  });
});

export const pinterestSchema = pinterestSchemaFor('zh-CN');

export type PinterestForm = z.infer<typeof pinterestSchema>;
export type PinterestFormInput = z.input<typeof pinterestSchema>;

export const pinterestBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'pinterest',
  scopes: ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'],
  selects: [{ id: 'board', title: msg('zh-CN').selectBoard }],
  selectsFor: (lang) => [{ id: 'board', title: msg(lang).selectBoard }],
  helpUrl: 'https://www.pinterest.com/',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

/** `POST /v5/pins` body (without the token). */
export interface PinterestPinBody {
  board_id: string;
  title: string;
  description: string;
  link?: string;
  alt_text?: string;
  media_source: { source_type: 'image_url'; url: string };
}

export interface PinterestRendered {
  body: PinterestPinBody;
  report: ReportItem[];
}

function boardOf(form: PinterestForm, account?: AccountRef): string | undefined {
  const meta = account?.meta ?? {};
  const v = form.board_id ?? meta.board_id ?? meta.target_id;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

/** Pure: the Pin. Throws without an image or a board. */
export function renderPinterest(
  doc: Doc,
  form: PinterestForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; account?: AccountRef; lang?: SdkLang } = {}
): PinterestRendered {
  const lang = opts.lang;
  const t = msg(lang);
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('pinterest', 'Pinterest', content, common, lang));
  const image = card.images.find((u) => /^https:\/\//i.test(u));
  if (!image) throw new Error(t.needsImage);
  const board = boardOf(form, opts.account);
  if (!board) throw new Error(t.needsBoard);
  const rawTitle = card.title || card.text || '';
  const title = truncate(rawTitle, PINTEREST_LIMITS.titleMax);
  if (title !== rawTitle)
    report.push({
      kind: 'title.truncated',
      text: t.titleTruncated(PINTEREST_LIMITS.titleMax),
    });
  const allTags = form.include_tags ? card.tags : [];
  const fit = fitPost({
    head: card.text ?? (form.include_summary ? card.summary : ''),
    tags: allTags.slice(0, PINTEREST_LIMITS.maxTags),
    limit: PINTEREST_LIMITS.descriptionMax,
  });
  if (fit.truncated)
    report.push({
      kind: 'summary.truncated',
      text: t.descriptionTruncated(PINTEREST_LIMITS.descriptionMax),
    });
  if (image !== card.cover)
    report.push({
      kind: 'cover.fallback',
      level: 'notice',
      text: t.coverFallback,
    });
  if (card.link) report.push({ kind: 'link.card', text: t.linkCard, detail: { url: card.link } });
  else report.push(missingLinkReport('Pinterest', lang));
  const alt = form.alt_text || common.coverAlt;
  return {
    body: {
      board_id: board,
      title,
      description: fit.text,
      ...(card.link ? { link: card.link } : {}),
      ...(alt ? { alt_text: truncate(alt, PINTEREST_LIMITS.altMax) } : {}),
      media_source: { source_type: 'image_url', url: image },
    },
    report,
  };
}

export function pinterestRef(links?: ErrorLinks): PlatformRef {
  return { key: 'pinterest', label: 'Pinterest', ...(links ? { links } : {}) };
}

export const PINTEREST_REQUESTS = {
  account: {
    method: 'GET',
    url: '${PINTEREST_API_BASE}/v5/user_account',
    auth: 'Bearer <access_token>',
  },
  boards: { method: 'GET', url: '${PINTEREST_API_BASE}/v5/boards', auth: 'Bearer <access_token>' },
  create: {
    method: 'POST',
    url: '${PINTEREST_API_BASE}/v5/pins',
    auth: 'Bearer <access_token>',
    body: 'PinterestPinBody → { id }; link https://www.pinterest.com/pin/{id}/',
  },
  analytics: {
    method: 'GET',
    url: '${PINTEREST_API_BASE}/v5/pins/{id}/analytics?start_date&end_date&metric_types=IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK',
    auth: 'Bearer <access_token>',
  },
} as const satisfies Record<string, RequestDescription>;

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * SPEC-r11 §7 ⚠️ `GET /v5/pins/{id}/analytics` (Pin owner's token): impressions → views, saves → favorites, clicks in
 * `extra`. The window is the last 90 days (the API's maximum ⚠️), or since `publishedAt` when later.
 */
export async function fetchPinterestStats(
  externalId: string,
  ctx: StatsContext & { publishedAt?: string },
  apiBase: string = PINTEREST_API,
  now: number = Date.now()
): Promise<PlatformStats | null> {
  // a pasted-back link (SPEC-r12 §1.1) gives its Pin id; a link that names none: no stats
  if (isUrlExternalId(externalId)) {
    const id = parsePostUrl('pinterest', externalId)?.externalId;
    return id ? fetchPinterestStats(id, ctx, apiBase, now) : null;
  }
  const token = ctx.credential?.access_token;
  const from = Math.max(
    now - (PINTEREST_LIMITS.analyticsDays - 1) * 86_400_000,
    ctx.publishedAt ? Date.parse(ctx.publishedAt) || 0 : 0
  );
  const q = new URLSearchParams({
    start_date: day(from),
    end_date: day(now),
    metric_types: 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK',
  });
  const data = await readJson<{
    all?: { summary_metrics?: Record<string, unknown>; lifetime_metrics?: Record<string, unknown> };
  }>(
    ctx,
    pinterestRef(),
    `${apiBase.replace(/\/$/, '')}/v5/pins/${encodeURIComponent(externalId)}/analytics?${q}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {}
  );
  const m = data?.all?.summary_metrics ?? data?.all?.lifetime_metrics;
  if (!m) return null;
  const clicks = num(m.PIN_CLICK);
  const outbound = num(m.OUTBOUND_CLICK);
  return stats('official-api', {
    views: num(m.IMPRESSION),
    favorites: num(m.SAVE),
    extra: {
      ...(clicks !== undefined ? { pin_clicks: clicks } : {}),
      ...(outbound !== undefined ? { outbound_clicks: outbound } : {}),
    },
  });
}

export function pinterestHandoff(
  doc: Doc,
  form: PinterestForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: { assetBase?: string } = {},
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('pinterest', doc, form, common, content, opts, lang);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('pinterest', input, lang);
  return { handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText }, report: r.report };
}

export interface PinterestAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
  /** Stats reads (`PINTEREST_API_BASE` on the server). */
  apiBase?: string;
}

export function createPinterestAdapter(
  opts: PinterestAdapterOptions = {}
): Adapter<typeof pinterestSchema> {
  const ref = pinterestRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'pinterest',
    label: 'Pinterest',
    runtimes: opts.runtimes ?? platformMeta('pinterest')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['article', 'short-text'],
    binding: pinterestBinding,
    capabilities: { supportsUpdate: false, needsLogin: true, titleMax: PINTEREST_LIMITS.titleMax },
    schema: pinterestSchema,
    schemaFor: pinterestSchemaFor,
    maxConcurrent: 2,
    statsRequires: 'token',
    preview(doc, form, common, content, popts): AdapterPreview {
      try {
        // the board is only known with the account: preview with a stand-in
        const r = renderPinterest(
          doc,
          { ...form, board_id: form.board_id ?? '0' },
          common,
          content,
          { ...renderOpts, ...(popts?.lang ? { lang: popts.lang } : {}) }
        );
        return {
          format: 'text',
          title: r.body.title,
          body: r.body.description,
          url: r.body.media_source.url,
          report: r.report,
        };
      } catch (e) {
        return {
          format: 'text',
          title: common?.title || doc.title,
          body: '',
          report: [{ kind: 'pin.invalid', level: 'warn', text: (e as Error).message }],
        };
      }
    },
    renderRequest({ doc, form, common, content, account, lang }) {
      const r = renderPinterest(doc, form, common, content, {
        ...renderOpts,
        ...(account ? { account } : {}),
        ...(lang ? { lang } : {}),
      });
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content, lang }) {
      return pinterestHandoff(doc, form, common, content, renderOpts, lang);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        let r: PinterestRendered;
        const t = msg(ctx.lang);
        const lref = refIn(ref, ctx.lang);
        try {
          r = renderPinterest(doc, form, common, content, {
            ...renderOpts,
            ...(ctx.account ? { account: ctx.account } : {}),
            ...(ctx.lang ? { lang: ctx.lang } : {}),
          });
        } catch (e) {
          throw helpError(lref, (e as Error).message, { code: 'invalid' });
        }
        if (codePoints(r.body.title) === 0 && !r.body.description)
          throw helpError(lref, t.empty, { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous, ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.creating });
        const credential = await credentialOf(opts.credential, 'pinterest', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(r.report, res.report),
        };
      });
    },
    fetchStats(externalId, ctx) {
      return fetchPinterestStats(externalId, ctx, opts.apiBase);
    },
  });
}
