/**
 * Bluesky (AT Protocol ✅ docs.bsky.app / atproto.com): a post is an `app.bsky.feed.post` record created with
 * `com.atproto.repo.createRecord` on the user's PDS; the link back to 辰记 is an `app.bsky.embed.external` card
 * (title, description, thumbnail uploaded with `com.atproto.repo.uploadBlob`); hashtags are `richtext.facet#tag`
 * facets (UTF-8 byte offsets). Text ≤ 300 graphemes ✅. Posts cannot be edited (⚠️ 官方尚无编辑功能): an update
 * publishes a new post.
 *
 * Binding: atproto OAuth (✅ the official way for apps with end users; PKCE + PAR + DPoP), public client — the
 * access token is bound to a key that only the client holds, so 辰记's server can neither use nor store it:
 * - desktop: the main process runs the flow and posts (token and DPoP key encrypted on the machine);
 * - web: `./oauth` runs the flow in the page (non-extractable WebCrypto key, page memory only) and posts directly
 *   to the PDS (`publishBlueskyDirect`); nothing goes through 辰记's API;
 * - no 「云端代发」 for Bluesky.
 *
 * SPEC-r12 §2: with `linkPlacement: 'first_comment'` the post has no link and no card; the link follows as the
 * author's reply (`reply.root` / `reply.parent` = the post's `uri` + `cid`, a link facet over the URL — Bluesky does
 * not detect links in text by itself ✅).
 */
import {
  CANONICAL_PLACEHOLDER,
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
  platformMeta,
  visibleLinkOf,
} from '@starnote/publish-core';
import {
  absoluteUrl,
  guard,
  helpError,
  kindError,
  linkPlacementField,
  num,
  placeLink,
  readJson,
  relayFollowUp,
  relayPublish,
  relayRequestOf,
  stats,
  truncate,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  FollowUpInput,
  FollowUpParent,
  PlatformStats,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  StatsContext,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';
import { BLUESKY_LIMITS } from './limits';
import {
  BLUESKY_APPVIEW,
  BlueskyOAuthError,
  createPostDirect,
  publishBlueskyDirect,
} from './oauth';

import type { BlueskySession } from './oauth';

let segmenter: Intl.Segmenter | undefined;
/** Grapheme clusters (emoji with modifiers count 1). */
export function graphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    segmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(s)].map((x) => x.segment);
  }
  return [...s];
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

export const blueskySchema = z.object({
  /** Your own text instead of title + summary (fitted to 300 graphemes). */
  text: z.string().trim().max(3000).optional().describe('帖子文字'),
  link: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  link_card: z.boolean().default(true).describe('链接卡片'),
  /** SPEC-r12 §2: the link as a card / in the text, or as the author's first reply. */
  linkPlacement: linkPlacementField('bluesky'),
});

export type BlueskyForm = z.infer<typeof blueskySchema>;
export type BlueskyFormInput = z.input<typeof blueskySchema>;

export const blueskyHandleForm = z.object({
  handle: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, '').toLowerCase())
    .pipe(
      z
        .string()
        .regex(
          /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
          '请填写 handle，如 me.bsky.social'
        )
    )
    .optional()
    .describe('Handle（可不填）'),
});

export const blueskyBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'atproto',
  fields: ['handle'],
  form: blueskyHandleForm,
  scopes: ['atproto', 'transition:generic'],
  helpUrl: 'https://bsky.app/',
  instructions: [
    '填写你的 Bluesky handle（如 me.bsky.social，也可以不填直接用 bsky.social 登录），点「授权」',
    '在 Bluesky 授权页登录并允许辰记',
    '令牌绑定在这台设备生成的密钥上：桌面端加密存本机；网页只在当前页面，关闭即失效；Bluesky 不支持云端代发',
    '授权最长约 2 周有效（公开客户端的限制），到期后重新授权即可',
  ],
};

export interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  >;
}

/** A record's `uri` + `cid` (`com.atproto.repo.strongRef`). */
export interface BlueskyStrongRef {
  uri: string;
  cid: string;
}

export interface BlueskyPostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  langs?: string[];
  facets?: BlueskyFacet[];
  /** A reply: the thread's first post and the post replied to. */
  reply?: { root: BlueskyStrongRef; parent: BlueskyStrongRef };
  embed?: {
    $type: 'app.bsky.embed.external';
    external: { uri: string; title: string; description: string; thumb?: unknown };
  };
}

export interface BlueskyRelayBody {
  record: BlueskyPostRecord;
  /** The card's thumbnail to upload (absolute; the sender only fetches 辰记's own assets or https). */
  thumb_url?: string;
}

export interface BlueskyRendered {
  text: string;
  body: BlueskyRelayBody;
  report: ReportItem[];
  /** `linkPlacement: 'first_comment'`: the reply carrying the link. */
  followUp?: FollowUpInput;
}

function hashtag(t: string): string | null {
  const w = t.replace(/[^\p{L}\p{N}_]+/gu, '');
  return w && !/^\d+$/.test(w) ? w.slice(0, 64) : null;
}

function iso639(lang?: string): string | undefined {
  const m = /^([a-z]{2})(?:[-_]|$)/i.exec(lang ?? '');
  return m ? m[1]!.toLowerCase() : undefined;
}

/** `#tag` facets for the hashtags that ended up in the text (UTF-8 byte offsets ✅). */
export function tagFacets(text: string, tags: readonly string[]): BlueskyFacet[] {
  const facets: BlueskyFacet[] = [];
  let from = 0;
  for (const tag of tags) {
    const needle = `#${tag}`;
    const at = text.indexOf(needle, from);
    if (at < 0) continue;
    const byteStart = utf8(text.slice(0, at));
    facets.push({
      index: { byteStart, byteEnd: byteStart + utf8(needle) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
    from = at + needle.length;
  }
  return facets;
}

/** Pure: the post record (text + hashtag facets + link card) and the predicted report. */
export function renderBluesky(
  doc: Doc,
  form: BlueskyForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; now?: () => Date } = {}
): BlueskyRendered {
  const short = content?.kind === 'short-text' ? content : undefined;
  const article = content?.kind === 'article' ? content : undefined;
  const d = article?.doc ?? doc;
  const placed = placeLink(form.linkPlacement, form.link || visibleLinkOf(content), article?.lang);
  const link = placed.bodyLink;
  const title = (common.title || d.title || '').trim();
  const head = (form.text || short?.thread?.[0] || short?.text || title).trim();
  let summary =
    form.text || short || !form.include_summary ? '' : (common.summary || d.summary || '').trim();
  const allTags = form.include_tags
    ? [...new Set((common.tags ?? []).map(hashtag).filter((t): t is string => !!t))]
    : [];
  const tags = allTags.slice(0, BLUESKY_LIMITS.maxTags);
  // Without a card the link has to be in the text (as a link facet). A scheduled batch's placeholder is never put
  // in the text: the server's string substitution would change the length (300 graphemes) and shift the facets'
  // UTF-8 byte offsets, so a placeholder link always goes into the link card (whose `uri` is substituted safely).
  const placeholder = link === CANONICAL_PLACEHOLDER;
  const useCard = form.link_card || placeholder;
  const inlineLink = link && !useCard ? link : '';
  const compose = (h: string, s: string, tg: string[]) =>
    [[h, s].filter(Boolean).join('\n\n'), tg.map((t) => `#${t}`).join(' '), inlineLink]
      .filter(Boolean)
      .join('\n\n');
  const len = (s: string) => graphemes(s).length;
  const fits = (h: string, s: string, tg: string[]) =>
    len(compose(h, s, tg)) <= BLUESKY_LIMITS.graphemes;
  const cut = (s: string, n: number) => {
    const g = graphemes(s);
    return g.length <= n
      ? s
      : `${g
          .slice(0, Math.max(0, n - 1))
          .join('')
          .trimEnd()}…`;
  };

  let h = head;
  let truncated = false;
  if (!fits(h, summary, tags) && summary) {
    let lo = 0;
    let hi = len(summary);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(h, cut(summary, mid), tags)) lo = mid;
      else hi = mid - 1;
    }
    summary = lo >= 20 ? cut(summary, lo) : '';
    truncated = true;
  }
  while (!fits(h, summary, tags) && tags.length) {
    tags.pop();
    truncated = true;
  }
  if (!fits(h, summary, tags)) {
    let lo = 1;
    let hi = len(h);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(cut(h, mid), summary, tags)) lo = mid;
      else hi = mid - 1;
    }
    h = cut(h, lo);
    truncated = true;
  }
  const text = compose(h, summary, tags);
  const facets = tagFacets(text, tags);
  if (inlineLink) {
    const at = text.lastIndexOf(inlineLink);
    const byteStart = utf8(text.slice(0, at));
    facets.push({
      index: { byteStart, byteEnd: byteStart + utf8(inlineLink) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: inlineLink }],
    });
  }

  const report: ReportItem[] = [];
  if (truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `帖子按 Bluesky 上限 ${BLUESKY_LIMITS.graphemes} 字截短`,
    });
  if (allTags.length > tags.length)
    report.push({
      kind: 'tags.trimmed',
      text: `话题保留 ${tags.length} 个，去掉 ${allTags.length - tags.length} 个`,
      count: allTags.length - tags.length,
    });

  const lang = iso639(article?.lang);
  const record: BlueskyPostRecord = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: (opts.now?.() ?? new Date()).toISOString(),
    ...(lang ? { langs: [lang] } : {}),
    ...(facets.length ? { facets } : {}),
  };
  let thumb: string | undefined;
  if (placeholder && !form.link_card)
    report.push({
      kind: 'link.card.forced',
      level: 'notice',
      text: '排期时辰记原文链接还不确定，改为以链接卡片附上（不写进正文）',
    });
  if (link && useCard) {
    const description = truncate(
      (common.summary || d.summary || '').trim(),
      BLUESKY_LIMITS.cardDescription
    );
    record.embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: link,
        title: truncate(title || link, BLUESKY_LIMITS.cardTitle),
        description,
      },
    };
    thumb = absoluteUrl(common.cover, opts.assetBase);
    report.push({
      kind: 'link.card',
      text: thumb ? '附上辰记原文链接卡片（含封面缩略图）' : '附上辰记原文链接卡片',
      detail: { url: link },
    });
  } else if (placed.followUp) {
    report.push(...placed.report);
  } else if (!link) {
    report.push({
      kind: 'canonical.missing',
      level: 'notice',
      text: '还没有辰记原文链接，这条帖子不带链接（先发布到辰记再同步可以带上原文卡片）',
    });
  }

  report.push(...mediaReport('bluesky', 'Bluesky', content, common));
  return {
    text,
    body: { record, ...(thumb ? { thumb_url: thumb } : {}) },
    report,
    ...(placed.followUp ? { followUp: placed.followUp } : {}),
  };
}

/** `#link` facets over every http(s) URL in `text` (UTF-8 byte offsets ✅; Bluesky does not detect links itself). */
export function linkFacets(text: string): BlueskyFacet[] {
  const facets: BlueskyFacet[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s，。、；！？）)\]]+/g)) {
    const uri = m[0].replace(/[.,;:!?'"]+$/, '');
    const byteStart = utf8(text.slice(0, m.index));
    facets.push({
      index: { byteStart, byteEnd: byteStart + utf8(uri) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  return facets;
}

/**
 * Pure: the link comment as a reply record (SPEC-r12 §2.2): `reply.root` and `reply.parent` both the post (it is
 * the first reply of a new thread), link facets, at most 300 graphemes (the text is cut before the link would be).
 */
export function blueskyReplyRecord(
  text: string,
  parent: BlueskyStrongRef,
  opts: { root?: BlueskyStrongRef; langs?: string[]; now?: () => Date } = {}
): BlueskyPostRecord {
  const g = graphemes(text);
  const t =
    g.length > BLUESKY_LIMITS.graphemes ? g.slice(0, BLUESKY_LIMITS.graphemes).join('') : text;
  const facets = linkFacets(t);
  return {
    $type: 'app.bsky.feed.post',
    text: t,
    createdAt: (opts.now?.() ?? new Date()).toISOString(),
    ...(opts.langs?.length ? { langs: opts.langs } : {}),
    ...(facets.length ? { facets } : {}),
    reply: { root: opts.root ?? parent, parent },
  };
}

/** The `{ uri, cid }` in a publish answer's `meta`, when it is one. */
export function strongRefOf(meta: unknown): BlueskyStrongRef | undefined {
  const m = meta as { uri?: unknown; cid?: unknown } | null | undefined;
  return m &&
    typeof m.uri === 'string' &&
    m.uri.startsWith('at://') &&
    typeof m.cid === 'string' &&
    m.cid
    ? { uri: m.uri, cid: m.cid }
    : undefined;
}

export function blueskyRef(links?: ErrorLinks): PlatformRef {
  return { key: 'bluesky', label: 'Bluesky', ...(links ? { links } : {}) };
}

/** What the senders call on the user's PDS (`Authorization: DPoP <token>` + a `DPoP` proof). */
export const BLUESKY_REQUESTS = {
  uploadBlob: {
    method: 'POST',
    url: '{pds}/xrpc/com.atproto.repo.uploadBlob',
    auth: 'DPoP <access_token>',
  },
  createRecord: {
    method: 'POST',
    url: '{pds}/xrpc/com.atproto.repo.createRecord',
    auth: 'DPoP <access_token>',
    body: "{ repo: did, collection: 'app.bsky.feed.post', record }",
  },
} as const satisfies Record<string, RequestDescription>;

/**
 * `at://did/app.bsky.feed.post/rkey` of a post: the external id as is when it is an AT URI, else the rkey with the
 * account's DID (`AccountRef.externalUid`) or the DID / handle in the post URL (`bsky.app/profile/{x}/post/{rkey}`).
 */
export function blueskyPostUri(
  externalId: string,
  ctx: Pick<StatsContext, 'account' | 'url'>
): { uri?: string; handle?: string; rkey: string } {
  if (externalId.startsWith('at://'))
    return { uri: externalId, rkey: externalId.split('/').pop()! };
  const rkey = externalId;
  const did = ctx.account?.externalUid?.startsWith('did:') ? ctx.account.externalUid : undefined;
  if (did) return { uri: `at://${did}/app.bsky.feed.post/${rkey}`, rkey };
  const m = /\/profile\/([^/]+)\/post\//.exec(ctx.url ?? '');
  const who = m ? decodeURIComponent(m[1]!) : undefined;
  if (who?.startsWith('did:')) return { uri: `at://${who}/app.bsky.feed.post/${rkey}`, rkey };
  return { ...(who ? { handle: who } : {}), rkey };
}

/**
 * SPEC-r11 §7 ✅ public AppView `app.bsky.feed.getPosts` (no credential): likes, replies, reposts + quotes. Bluesky
 * shows no view count.
 */
export async function fetchBlueskyStats(
  externalId: string,
  ctx: StatsContext,
  appView: string = BLUESKY_APPVIEW
): Promise<PlatformStats | null> {
  const ref = blueskyRef();
  // a pasted-back link (SPEC-r12 §1.1): its rkey, and the author's handle from the link
  if (isUrlExternalId(externalId)) {
    const parsed = parsePostUrl('bluesky', externalId);
    if (!parsed) return null;
    return fetchBlueskyStats(parsed.externalId, { ...ctx, url: parsed.url }, appView);
  }
  const target = blueskyPostUri(externalId, ctx);
  let uri = target.uri;
  if (!uri && target.handle) {
    const r = await readJson<{ did?: string }>(
      ctx,
      ref,
      `${appView}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(target.handle)}`
    );
    if (r?.did) uri = `at://${r.did}/app.bsky.feed.post/${target.rkey}`;
  }
  if (!uri) return null;
  const data = await readJson<{ posts?: Array<Record<string, unknown>> }>(
    ctx,
    ref,
    `${appView}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`
  );
  const post = data?.posts?.[0];
  if (!post) return null;
  const reposts = num(post.repostCount);
  const quotes = num(post.quoteCount);
  return stats('public', {
    likes: num(post.likeCount),
    comments: num(post.replyCount),
    ...(reposts !== undefined || quotes !== undefined
      ? { shares: (reposts ?? 0) + (quotes ?? 0) }
      : {}),
    ...(quotes !== undefined ? { extra: { quotes } } : {}),
  });
}

/**
 * A failed **write** straight to the PDS (web) → a `PlatformError` with its kind (SPEC-r11 §1): the request may have
 * reached the PDS when the connection dropped, the PDS answered 5xx or nothing says otherwise, so those are `unknown`
 * (never re-sent without asking); 429 `retry`; 401 / an expired session `disconnect`; a DPoP nonce loop (the PDS
 * refused every try) `retry`; any other 4xx `bad_body`. Other errors are passed on unchanged.
 */
export function blueskyWriteError(cause: unknown, p: PlatformRef = blueskyRef()): unknown {
  if (!(cause instanceof BlueskyOAuthError)) return cause;
  const status = cause.status;
  const init = status !== undefined ? { status } : {};
  if (cause.code === 'relogin' || status === 401)
    return kindError(p, 'disconnect', cause.message, { code: 'relogin', ...init });
  if (cause.code === 'rate_limited' || status === 429)
    return kindError(p, 'retry', cause.message, { code: 'rate_limited', ...init });
  if (cause.code === 'dpop') return kindError(p, 'retry', cause.message, { code: 'dpop' });
  if (status !== undefined && status >= 400 && status < 500)
    return kindError(p, 'bad_body', cause.message, { code: cause.code, ...init });
  // network, 5xx, no status: the write may have gone through
  return kindError(
    p,
    'unknown',
    `${cause.message}（结果未知：可能已经发出，请先到 Bluesky 确认，没有再重发）`,
    { code: cause.code === 'network' ? 'network' : status ? `http_${status}` : 'unknown', ...init }
  );
}

async function directWrite<T>(p: PlatformRef, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw blueskyWriteError(cause, p);
  }
}

/** The post's `cid` from the public AppView, when the publish answer did not give it (a 「补发」 later). */
async function resolveStrongRef(
  post: FollowUpParent,
  fallbackUri: string,
  ctx: Pick<StatsContext, 'fetch' | 'signal'>,
  appView: string = BLUESKY_APPVIEW
): Promise<BlueskyStrongRef> {
  const uri = post.externalId.startsWith('at://') ? post.externalId : fallbackUri;
  const data = await readJson<{ posts?: Array<{ uri?: string; cid?: string }> }>(
    ctx,
    blueskyRef(),
    `${appView}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`
  );
  const found = data?.posts?.[0];
  if (!found?.cid)
    throw helpError(blueskyRef(), '找不到要回复的 Bluesky 帖子（可能已删除）', {
      code: 'not_found',
    });
  return { uri: found.uri ?? uri, cid: found.cid };
}

export interface BlueskyAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  /** Web: the page-memory session from `./oauth` (`BlueskyOAuthClient`); publishing then goes straight to the PDS. */
  session?: () => BlueskySession | undefined;
}

export function createBlueskyAdapter(
  opts: BlueskyAdapterOptions = {}
): Adapter<typeof blueskySchema> {
  const ref = blueskyRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'bluesky',
    label: 'Bluesky',
    runtimes: opts.runtimes ?? platformMeta('bluesky')!.runtimes,
    contentTypes: ['short-text', 'article'],
    binding: blueskyBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: blueskySchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderBluesky(doc, form, common, content, renderOpts);
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        report: r.report,
        ...(r.followUp ? { followUp: r.followUp } : {}),
      };
    },
    // SPEC-r11 §12: the record a desktop task posts (Bluesky has no 云端代发: scheduled posts wait for the desktop).
    renderRequest({ doc, form, common, content, previous }) {
      const r = renderBluesky(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, previous, undefined, r.report, r.followUp);
    },
    // SPEC-r12 §2.2: web straight to the PDS (a reply record with link facets); desktop through its local relay.
    followUp(post, input, ctx) {
      return guard(ctx, ref, async () => {
        if (ctx.runtime !== 'web') return relayFollowUp(ctx, ref, post, input);
        const session = opts.session?.();
        if (!session)
          throw helpError(ref, '这个页面还没有 Bluesky 授权（授权只保存在当前页面），请先授权', {
            code: 'bind',
          });
        const parent =
          strongRefOf(post.meta) ??
          (await resolveStrongRef(
            post,
            `at://${session.did}/app.bsky.feed.post/${post.externalId}`,
            ctx
          ));
        const out = await directWrite(ref, () =>
          createPostDirect(session, blueskyReplyRecord(input.text, parent), {
            fetch: ctx.fetch,
            signal: ctx.signal,
          })
        );
        return { externalId: out.rkey, ...(out.url ? { url: out.url } : {}) };
      });
    },
    statsRequires: 'none',
    fetchStats(externalId, ctx) {
      return fetchBlueskyStats(externalId, ctx);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderBluesky(doc, form, common, content, renderOpts);
        if (!r.text.trim() && !r.body.record.embed)
          throw helpError(ref, '帖子是空的', { code: 'invalid' });
        const report = [...r.report];
        if (ctx.previous?.externalId)
          report.push({
            kind: 'update.unsupported',
            level: 'notice',
            text: 'Bluesky 帖子不能编辑，这次发布的是一条新帖子',
          });
        ctx.emit({ type: 'report', items: report });
        ctx.emit({ type: 'progress', percent: 40, text: '发布到 Bluesky' });
        if (ctx.runtime === 'web') {
          const session = opts.session?.();
          if (!session)
            throw helpError(ref, '这个页面还没有 Bluesky 授权（授权只保存在当前页面），请先授权', {
              code: 'bind',
            });
          const res = await directWrite(ref, () =>
            publishBlueskyDirect(session, r.body, { fetch: ctx.fetch, signal: ctx.signal })
          );
          ctx.emit({ type: 'progress', percent: 100, text: '完成' });
          return {
            url: res.url,
            externalId: res.rkey,
            state: 'published',
            report: mergeReports(report, res.report),
            ...(r.followUp
              ? { followUp: { ...r.followUp, meta: { uri: res.uri, cid: res.cid } } }
              : {}),
          };
        }
        // Desktop: the main process holds the token and the DPoP key (the host routes this call to it).
        const res = await relayPublish(ctx, ref, r.body);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(report, res.report),
          ...(r.followUp
            ? { followUp: { ...r.followUp, ...(res.meta !== undefined ? { meta: res.meta } : {}) } }
            : {}),
        };
      });
    },
  });
}
