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
 * SPEC-r12 §2: `linkPlacement: 'first_comment'` drops `link_attachment` (and the link in an image post's text); after
 * `finalize` the link follows as a reply — the relay's `…/comment` creates a `TEXT` container with
 * `reply_to_id = {media id}` and publishes it (two steps, no polling).
 *
 * Not bound: the existing threads intent hand-off (`@starnote/publish-share`).
 */
import {
  byLang,
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
  platformMeta,
  shortcodeOf,
} from '@starnote/publish-core';
import {
  cardOf,
  credentialOf,
  fitPost,
  guard,
  helpError,
  linkPlacementField,
  missingLinkReport,
  newPostReport,
  num,
  placeLink,
  refIn,
  readJson,
  relayCheck,
  relayFinalize,
  relayFollowUp,
  relayPublish,
  relayRequestOf,
  stats,
  threadsLength,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
import { z } from 'zod';

import { msg } from './i18n';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  FollowUpInput,
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

/** The form in a language (SPEC-r14 B5). */
export const threadsSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    text: z.string().trim().max(2000).optional().describe(t.text),
    link: z.string().trim().regex(URL_RE, t.httpUrl).optional().describe(t.link),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    include_tags: z.boolean().default(true).describe(t.includeTags),
    /** Off (default): a text post with the link card. On: the cover as an image post, the link in the text. */
    with_cover: z.boolean().default(false).describe(t.withCover),
    /** SPEC-r12 §2: the link as the card (or in an image post's text), or as the author's first reply. */
    linkPlacement: linkPlacementField('threads', lang),
  });
});

export const threadsSchema = threadsSchemaFor('zh-CN');

export type ThreadsForm = z.infer<typeof threadsSchema>;
export type ThreadsFormInput = z.input<typeof threadsSchema>;

export const threadsBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'threads',
  scopes: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
  helpUrl: 'https://www.threads.net/',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
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
  /** `linkPlacement: 'first_comment'`: the reply carrying the link. */
  followUp?: FollowUpInput;
}

export function renderThreads(
  doc: Doc,
  form: ThreadsForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; lang?: SdkLang } = {}
): ThreadsRendered {
  const lang = opts.lang;
  const t = msg(lang);
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  const placed = placeLink(form.linkPlacement, card.link, card.lang, lang);
  const link = placed.bodyLink;
  const image = form.with_cover ? card.cover : undefined;
  const allTags = form.include_tags ? card.tags : [];
  const fit = fitPost({
    head: card.text ?? card.title,
    ...(form.include_summary && !card.text ? { summary: card.summary } : {}),
    tags: allTags.slice(0, THREADS_LIMITS.maxTags),
    // a text post shows the link as its card; an image post needs it in the text
    ...(image && link ? { link } : {}),
    limit: THREADS_LIMITS.textMax,
    count: threadsLength,
  });
  if (fit.truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: t.truncated(THREADS_LIMITS.textMax),
    });
  if (allTags.length > fit.tags.length)
    report.push({
      kind: 'tags.trimmed',
      text: t.tagsTrimmed(THREADS_LIMITS.maxTags),
      count: allTags.length - fit.tags.length,
    });
  if (link)
    report.push({
      kind: 'link.card',
      text: image ? t.imagePost : t.linkCard,
      detail: { url: link },
    });
  else if (placed.followUp) report.push(...placed.report);
  else report.push(missingLinkReport('Threads', lang));
  report.push({
    kind: 'processing',
    text: t.processing,
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
        ...(link ? { link_attachment: link } : {}),
      };
  report.push(...mediaReport('threads', 'Threads', content, common, lang));
  return {
    text: fit.text,
    body,
    report,
    ...(placed.followUp ? { followUp: placed.followUp } : {}),
  };
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
  // a pasted-back link (SPEC-r12 §1.1) is `code:{shortcode}`: the media id is looked up among the account's
  // recent posts (needs the token); not found → no stats, no error
  const code =
    shortcodeOf(externalId) ?? shortcodeOf(parsePostUrl('threads', externalId)?.externalId ?? '');
  if (code || isUrlExternalId(externalId)) {
    const id = code && token ? await threadsMediaIdOf(code, ctx, graph) : undefined;
    return id ? fetchThreadsStats(id, ctx, graph) : null;
  }
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

/** The media id of a post by its shortcode, among the account's latest 100 posts (`GET /me/threads`). */
export async function threadsMediaIdOf(
  code: string,
  ctx: StatsContext,
  graph: string = THREADS_GRAPH
): Promise<string | undefined> {
  const token = ctx.credential?.access_token;
  if (!token) return undefined;
  const list = await readJson<{ data?: Array<{ id?: string; shortcode?: string }> }>(
    ctx,
    threadsRef(),
    `${graph}/me/threads?fields=id,shortcode&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const hit = list?.data?.find((p) => p.shortcode === code);
  return hit?.id ? String(hit.id) : undefined;
}

export function threadsHandoff(
  doc: Doc,
  form: ThreadsForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: { assetBase?: string } = {},
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('threads', doc, form, common, content, opts, lang);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('threads', input, lang);
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
  const base = opts.assetBase ? { assetBase: opts.assetBase } : {};
  const renderOpts = (lang?: SdkLang) => ({ ...base, ...(lang ? { lang } : {}) });
  return defineAdapter({
    key: 'threads',
    label: 'Threads',
    runtimes: opts.runtimes ?? platformMeta('threads')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: threadsBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: threadsSchema,
    schemaFor: threadsSchemaFor,
    maxConcurrent: 2,
    pollIntervalSec: opts.poll?.intervalSec ?? THREADS_POLL.intervalSec,
    pollTimeoutSec: opts.poll?.timeoutSec ?? THREADS_POLL.timeoutSec,
    statsRequires: 'token',
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderThreads(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        report: r.report,
        ...(r.followUp ? { followUp: r.followUp } : {}),
      };
    },
    renderRequest({ doc, form, common, content, lang }) {
      const r = renderThreads(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, undefined, undefined, r.report, r.followUp);
    },
    // SPEC-r12 §2.2: a reply container (`reply_to_id`) published right away, through the relay
    followUp(post, input, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'threads', ctx);
        return relayFollowUp(ctx, ref, post, input, { credential });
      });
    },
    renderHandoff({ doc, form, common, content, lang }) {
      return threadsHandoff(doc, form, common, content, base, lang);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderThreads(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        if (!r.text.trim() && r.body.media_type === 'TEXT')
          throw helpError(refIn(ref, ctx.lang), t.empty, { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous, ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 30, text: t.creating });
        const credential = await credentialOf(opts.credential, 'threads', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        const report = mergeReports(r.report, res.report);
        // the publisher posts it after `finalize` (the reply needs the published media id)
        const followUp = r.followUp ? { followUp: r.followUp } : {};
        if (res.state === 'processing')
          return {
            url: res.url,
            state: 'processing' as const,
            pending: res.pending,
            report,
            ...followUp,
          };
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report,
          ...followUp,
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
