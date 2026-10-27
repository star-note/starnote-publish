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
  num,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
  truncate,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
import { z } from 'zod';

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

export const pinterestSchema = z.object({
  /** Default: the board picked when binding (`account.meta.board_id`). */
  board_id: z
    .string()
    .trim()
    .regex(/^\d{1,30}$/, '画板 ID 是数字')
    .optional()
    .describe('画板'),
  /** Your own description instead of the summary. */
  text: z.string().trim().max(2000).optional().describe('描述'),
  link: z
    .string()
    .trim()
    .regex(URL_RE, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  alt_text: z.string().trim().max(PINTEREST_LIMITS.altMax).optional().describe('图片描述'),
});

export type PinterestForm = z.infer<typeof pinterestSchema>;
export type PinterestFormInput = z.input<typeof pinterestSchema>;

export const pinterestBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'pinterest',
  scopes: ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'],
  selects: [{ id: 'board', title: '选择要发到的画板' }],
  helpUrl: 'https://www.pinterest.com/',
  instructions: [
    '点「用 Pinterest 授权」，在 Pinterest 页面允许辰记创建 Pin、读取画板',
    '回到辰记选择默认画板（发布时也可以换）',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面；打开「云端代发」才会存到辰记服务器',
    '不用时到 Pinterest「设置 → 安全与登录 → 已连接的应用」移除辰记',
  ],
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
  opts: { assetBase?: string; account?: AccountRef } = {}
): PinterestRendered {
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('pinterest', 'Pinterest', content, common));
  const image = card.images.find((u) => /^https:\/\//i.test(u));
  if (!image) throw new Error('Pinterest 的 Pin 需要一张 https 图片：给笔记加封面后再试');
  const board = boardOf(form, opts.account);
  if (!board)
    throw new Error('还没有选择画板：在绑定 Pinterest 时选择默认画板，或在表单里填写画板');
  const rawTitle = card.title || card.text || '';
  const title = truncate(rawTitle, PINTEREST_LIMITS.titleMax);
  if (title !== rawTitle)
    report.push({
      kind: 'title.truncated',
      text: `Pin 标题最多 ${PINTEREST_LIMITS.titleMax} 字，已截短`,
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
      text: `Pin 描述最多 ${PINTEREST_LIMITS.descriptionMax} 字，已截短`,
    });
  if (image !== card.cover)
    report.push({
      kind: 'cover.fallback',
      level: 'notice',
      text: '没有封面图，用正文第一张图做 Pin 图片',
    });
  if (card.link)
    report.push({ kind: 'link.card', text: '点开 Pin 会跳到辰记原文', detail: { url: card.link } });
  else report.push(missingLinkReport('Pinterest'));
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
  opts: { assetBase?: string } = {}
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('pinterest', doc, form, common, content, opts);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('pinterest', input);
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
    maxConcurrent: 2,
    statsRequires: 'token',
    preview(doc, form, common, content): AdapterPreview {
      try {
        // the board is only known with the account: preview with a stand-in
        const r = renderPinterest(
          doc,
          { ...form, board_id: form.board_id ?? '0' },
          common,
          content,
          renderOpts
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
    renderRequest({ doc, form, common, content, account }) {
      const r = renderPinterest(doc, form, common, content, {
        ...renderOpts,
        ...(account ? { account } : {}),
      });
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content }) {
      return pinterestHandoff(doc, form, common, content, renderOpts);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        let r: PinterestRendered;
        try {
          r = renderPinterest(doc, form, common, content, {
            ...renderOpts,
            ...(ctx.account ? { account: ctx.account } : {}),
          });
        } catch (e) {
          throw helpError(ref, (e as Error).message, { code: 'invalid' });
        }
        if (codePoints(r.body.title) === 0 && !r.body.description)
          throw helpError(ref, 'Pin 没有标题和描述', { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '在 Pinterest 建 Pin' });
        const credential = await credentialOf(opts.credential, 'pinterest', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
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
