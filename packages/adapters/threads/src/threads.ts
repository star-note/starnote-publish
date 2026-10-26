/**
 * Threads (Threads API ✅ developers.facebook.com/docs/threads, SPEC-r11 §10): a link post, published in three
 * stages (SPEC-r11 §2):
 *
 * 1. `POST /{threads-user-id}/threads` creates a container: `media_type: 'TEXT'` with `link_attachment` (the link
 *    card), or `IMAGE` with `image_url` (the link then goes in the text);
 * 2. `GET /{container-id}?fields=status` until `FINISHED` (Meta suggests waiting about 30 s ⚠️);
 * 3. `POST /{threads-user-id}/threads_publish` with `creation_id`; the post's link comes from its `permalink` field.
 *
 * 辰记's API (or the desktop's local relay) runs each step: `publish` returns `state: 'processing'` with `pending`
 * (`{ container_id, … }`), the publisher polls `checkStatus` (`/check`) and calls `finalize` (`/finalize`, keyed
 * `finalize:threads:{container_id}`) once. Bound with OAuth (`threads_basic, threads_content_publish,
 * threads_manage_insights`), short-lived token exchanged for a 60-day one (`th_exchange_token`), renewed with
 * `th_refresh_token`. Text ≤ 500 characters (emoji by UTF-8 bytes ✅).
 *
 * Not bound: the existing threads intent hand-off (`@starnote/publish-share`).
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  cardOf,
  credentialOf,
  fitPost,
  guard,
  helpError,
  missingLinkReport,
  newPostReport,
  num,
  readJson,
  relayCheck,
  relayFinalize,
  relayPublish,
  relayRequestOf,
  stats,
  threadsLength,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
import { z } from 'zod';

import type {
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

export const THREADS_GRAPH = 'https://graph.threads.net/v1.0';

export const THREADS_LIMITS = {
  /** ✅ 500 characters, emoji by UTF-8 bytes. */
  textMax: 500,
  /** ⚠️ 待核实：每帖只识别 1 个话题标签。 */
  maxTags: 1,
} as const;

/** ⚠️ Meta 建议建容器后平均等 30 秒再发布；每 10 秒查一次。 */
export const THREADS_POLL = { intervalSec: 10, timeoutSec: 600 } as const;

const URL_RE = /^https?:\/\/\S+$/;

export const threadsSchema = z.object({
  text: z.string().trim().max(2000).optional().describe('帖子文案'),
  link: z
    .string()
    .trim()
    .regex(URL_RE, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  /** Off (default): a text post with the link card. On: the cover as an image post, the link in the text. */
  with_cover: z.boolean().default(false).describe('发封面图（链接写进文案）'),
});

export type ThreadsForm = z.infer<typeof threadsSchema>;
export type ThreadsFormInput = z.input<typeof threadsSchema>;

export const threadsBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'threads',
  scopes: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
  helpUrl: 'https://www.threads.net/',
  instructions: [
    '点「用 Threads 授权」，在 Threads 页面允许辰记代你发帖、读取帖子数据',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '授权 60 天有效，辰记会自动续期；不用时到 Threads「设置 → 账户 → 网站权限」移除辰记',
  ],
};

/** The container request (`POST /{user}/threads`) without the token. */
export type ThreadsContainerBody =
  | {
      media_type: 'TEXT';
      text: string;
      link_attachment?: string;
    }
  | {
      media_type: 'IMAGE';
      image_url: string;
      text: string;
      alt_text?: string;
    };

export interface ThreadsRendered {
  text: string;
  body: ThreadsContainerBody;
  report: ReportItem[];
}

export function renderThreads(
  doc: Doc,
  form: ThreadsForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): ThreadsRendered {
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  const image = form.with_cover ? card.cover : undefined;
  const allTags = form.include_tags ? card.tags : [];
  const fit = fitPost({
    head: card.text ?? card.title,
    ...(form.include_summary && !card.text ? { summary: card.summary } : {}),
    tags: allTags.slice(0, THREADS_LIMITS.maxTags),
    // a text post shows the link as its card; an image post needs it in the text
    ...(image && card.link ? { link: card.link } : {}),
    limit: THREADS_LIMITS.textMax,
    count: threadsLength,
  });
  if (fit.truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `Threads 最多 ${THREADS_LIMITS.textMax} 字（emoji 按字节计），已截短`,
    });
  if (allTags.length > fit.tags.length)
    report.push({
      kind: 'tags.trimmed',
      text: `Threads 每帖只带 ${THREADS_LIMITS.maxTags} 个话题`,
      count: allTags.length - fit.tags.length,
    });
  if (card.link)
    report.push({
      kind: 'link.card',
      text: image ? '以图片帖发出，原文链接写在文案里' : '以链接卡片发出',
      detail: { url: card.link },
    });
  else report.push(missingLinkReport('Threads'));
  report.push({
    kind: 'processing',
    text: 'Threads 先建容器、处理完再发布，通常要等半分钟左右',
  });
  const body: ThreadsContainerBody = image
    ? {
        media_type: 'IMAGE',
        image_url: image,
        text: fit.text,
        ...(common.coverAlt ? { alt_text: common.coverAlt } : {}),
      }
    : {
        media_type: 'TEXT',
        text: fit.text,
        ...(card.link ? { link_attachment: card.link } : {}),
      };
  return { text: fit.text, body, report };
}

export function threadsRef(links?: ErrorLinks): PlatformRef {
  return { key: 'threads', label: 'Threads', ...(links ? { links } : {}) };
}

export const THREADS_REQUESTS = {
  me: {
    method: 'GET',
    url: `${THREADS_GRAPH}/me?fields=id,username,threads_profile_picture_url`,
    auth: 'Bearer <access_token>',
  },
  container: {
    method: 'POST',
    url: `${THREADS_GRAPH}/{threads-user-id}/threads`,
    auth: 'Bearer <access_token>',
    body: 'ThreadsContainerBody → { id } (pending.container_id)',
  },
  status: {
    method: 'GET',
    url: `${THREADS_GRAPH}/{container-id}?fields=status,error_message`,
    auth: 'Bearer <access_token>',
    body: 'status: IN_PROGRESS | FINISHED (→ ready) | PUBLISHED (→ completed) | ERROR | EXPIRED',
  },
  publish: {
    method: 'POST',
    url: `${THREADS_GRAPH}/{threads-user-id}/threads_publish`,
    auth: 'Bearer <access_token>',
    body: 'creation_id=<container-id> → { id }; then GET /{id}?fields=permalink',
  },
  insights: {
    method: 'GET',
    url: `${THREADS_GRAPH}/{media-id}/insights?metric=views,likes,replies,reposts,quotes,shares`,
    auth: 'Bearer <access_token> (threads_manage_insights)',
  },
  exchange: {
    method: 'GET',
    url: 'https://graph.threads.net/access_token?grant_type=th_exchange_token',
    auth: 'client_secret + short-lived token',
  },
  refresh: {
    method: 'GET',
    url: 'https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token',
    auth: 'long-lived token',
  },
} as const satisfies Record<string, RequestDescription>;

/**
 * SPEC-r11 §7 ⚠️ `GET /{media-id}/insights` (needs `threads_manage_insights`): views, likes, replies, reposts,
 * quotes, shares. Each metric is `{ name, values: [{ value }] }` or `{ name, total_value: { value } }`.
 */
export async function fetchThreadsStats(
  externalId: string,
  ctx: StatsContext,
  graph: string = THREADS_GRAPH
): Promise<PlatformStats | null> {
  const token = ctx.credential?.access_token;
  const data = await readJson<{
    data?: Array<{
      name?: string;
      values?: Array<{ value?: unknown }>;
      total_value?: { value?: unknown };
    }>;
  }>(
    ctx,
    threadsRef(),
    `${graph}/${encodeURIComponent(externalId)}/insights?metric=views,likes,replies,reposts,quotes,shares`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {}
  );
  if (!data?.data) return null;
  const m: Record<string, number | undefined> = {};
  for (const it of data.data) {
    if (!it.name) continue;
    m[it.name] = num(it.total_value?.value ?? it.values?.at(-1)?.value);
  }
  const shareParts = [m.reposts, m.quotes, m.shares].filter((n): n is number => n !== undefined);
  return stats('official-api', {
    views: m.views,
    likes: m.likes,
    comments: m.replies,
    ...(shareParts.length ? { shares: shareParts.reduce((a, b) => a + b, 0) } : {}),
    extra: Object.fromEntries(
      (['reposts', 'quotes', 'shares'] as const)
        .filter((k) => m[k] !== undefined)
        .map((k) => [k, m[k]!])
    ),
  });
}

export function threadsHandoff(
  doc: Doc,
  form: ThreadsForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: { assetBase?: string } = {}
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('threads', doc, form, common, content, opts);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('threads', input);
  return { handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText }, report: r.report };
}

export interface ThreadsAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
  /** Override the polling (tests). */
  poll?: { intervalSec?: number; timeoutSec?: number };
}

export function createThreadsAdapter(
  opts: ThreadsAdapterOptions = {}
): Adapter<typeof threadsSchema> {
  const ref = threadsRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'threads',
    label: 'Threads',
    runtimes: opts.runtimes ?? platformMeta('threads')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: threadsBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: threadsSchema,
    maxConcurrent: 2,
    pollIntervalSec: opts.poll?.intervalSec ?? THREADS_POLL.intervalSec,
    pollTimeoutSec: opts.poll?.timeoutSec ?? THREADS_POLL.timeoutSec,
    statsRequires: 'token',
    preview(doc, form, common, content): AdapterPreview {
      const r = renderThreads(doc, form, common, content, renderOpts);
      return { format: 'text', title: common?.title || doc.title, body: r.text, report: r.report };
    },
    renderRequest({ doc, form, common, content }) {
      const r = renderThreads(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content }) {
      return threadsHandoff(doc, form, common, content, renderOpts);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderThreads(doc, form, common, content, renderOpts);
        if (!r.text.trim() && r.body.media_type === 'TEXT')
          throw helpError(ref, '帖子是空的', { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 30, text: '在 Threads 建帖子容器' });
        const credential = await credentialOf(opts.credential, 'threads', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        const report = mergeReports(r.report, res.report);
        if (res.state === 'processing')
          return { url: res.url, state: 'processing' as const, pending: res.pending, report };
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report,
        };
      });
    },
    checkStatus(pending, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'threads', ctx);
        return relayCheck(ctx, ref, pending, { credential });
      });
    },
    finalize(pending, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'threads', ctx);
        return relayFinalize(ctx, ref, pending, { credential });
      });
    },
    fetchStats(externalId, ctx) {
      return fetchThreadsStats(externalId, ctx);
    },
  });
}
