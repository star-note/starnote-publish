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
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import { absoluteUrl, guard, helpError, relayPublish, truncate } from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';
import { BLUESKY_LIMITS } from './limits';
import { publishBlueskyDirect } from './oauth';

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

export interface BlueskyPostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  langs?: string[];
  facets?: BlueskyFacet[];
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
  const link = form.link || short?.link || article?.canonicalUrl;
  const title = (common.title || d.title || '').trim();
  const head = (form.text || short?.thread?.[0] || short?.text || title).trim();
  let summary =
    form.text || short || !form.include_summary ? '' : (common.summary || d.summary || '').trim();
  const allTags = form.include_tags
    ? [...new Set((common.tags ?? []).map(hashtag).filter((t): t is string => !!t))]
    : [];
  const tags = allTags.slice(0, BLUESKY_LIMITS.maxTags);
  // Without a card the link has to be in the text (as a link facet).
  const inlineLink = link && !form.link_card ? link : '';
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
  if (link && form.link_card) {
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
  } else if (!link) {
    report.push({
      kind: 'canonical.missing',
      level: 'notice',
      text: '还没有辰记原文链接，这条帖子不带链接（先发布到辰记再同步可以带上原文卡片）',
    });
  }

  return { text, body: { record, ...(thumb ? { thumb_url: thumb } : {}) }, report };
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
      return { format: 'text', title: common?.title || doc.title, body: r.text, report: r.report };
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
          const res = await publishBlueskyDirect(session, r.body, {
            fetch: ctx.fetch,
            signal: ctx.signal,
          });
          ctx.emit({ type: 'progress', percent: 100, text: '完成' });
          return {
            url: res.url,
            externalId: res.rkey,
            state: 'published',
            report: mergeReports(report, res.report),
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
        };
      });
    },
  });
}
