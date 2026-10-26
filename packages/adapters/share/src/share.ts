/**
 * Share-intent hand-off (SPEC-r8 §5.2「短帖引流组」): no binding, every runtime. We build the platform's own
 * share / submit URL with the title, the link back to 辰记 and optional topics, plus copy text fitted to the
 * platform's length rule (rules now; an AI rewrite hook for later). The user confirms in the platform's
 * window, so `publish` ends `done` with `state: 'handoff'`, an empty `url`, and a `handoff.pending` report
 * carrying `{ via, openUrl, copyText }`.
 *
 * Browsers only allow `window.open` inside the click handler: hosts should compute the link with
 * `buildShare` / `preview` before the click (both are synchronous and pure) and open it there, or open a
 * blank window first and set its location when `publish` resolves.
 *
 * URL formats — ✅ checked against official docs (2026-10), ⚠️ 待核实 (no official page found):
 * - X ✅ `https://x.com/intent/tweet?text=&url=&hashtags=a,b` (docs.x.com web intent; text + hashtags + url ≤ 280)
 * - Threads ✅ `https://www.threads.com/intent/post?text=&url=` (developers.facebook.com threads-web-intents)
 * - Telegram ✅ `https://t.me/share/url?url=&text=` (core.telegram.org/widgets/share)
 * - Facebook ✅ with an app id: `https://www.facebook.com/dialog/share?app_id=&display=page&href=&hashtag=`;
 *   ⚠️ without one: `https://www.facebook.com/sharer/sharer.php?u=` (widely used, not in current docs; no text)
 * - LinkedIn ⚠️ `https://www.linkedin.com/sharing/share-offsite/?url=` (only the URL; current docs only cover the
 *   API) — the post text is copied for the user to paste
 * - Reddit ⚠️ `https://www.reddit.com/submit?url=&title=` (or `/r/<sub>/submit`) — no official page
 * - 微博 ⚠️ `https://service.weibo.com/share/share.php?url=&title=&pic=&appkey=` — no official page found
 * - Medium ✅ Import story at `https://medium.com/p/import` (help.medium.com); ⚠️ no documented URL parameter,
 *   so the link to paste is copied
 * - Pinterest ✅ `https://www.pinterest.com/pin/create/button/?url=&media=&description=`
 *   (developers.pinterest.com/docs/web-features/buttons: `url` the Pin's link, `media` the image, `description`);
 *   ⚠️ 文档把不加载 pinit.js 的自拼链接称作 unofficial；描述上限 500 字待核实。API 不用：Trial 档的 Pin 只有自己可见，
 *   Standard 档要录屏审核 ✅
 *
 * Platforms here have no free / review-free publishing API we can use (X 按次计费; Facebook / Threads 要 Meta App
 * Review; LinkedIn 要申请产品权限; Pinterest 见上). Reddit's share-intent stays as the fallback of the OAuth adapter
 * (`@starnote/publish-reddit`) while its app is not approved.
 */
import { defineAdapter } from '@starnote/publish-core';
import {
  codePoints,
  guard,
  helpError,
  linkCost,
  threadsLength,
  truncate,
  weiboLength,
  xWeightedLength,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  CommonFormShape,
  ContentKind,
  Doc,
  HandoffVia,
  PublishContent,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef } from '@starnote/publish-kit';

export type ShareKey =
  | 'x'
  | 'linkedin'
  | 'reddit'
  | 'facebook'
  | 'weibo'
  | 'threads'
  | 'telegram'
  | 'medium'
  | 'pinterest';

/** Where the post text ends up. */
type TextSlot = 'url' | 'clipboard' | 'link-only';

export interface SharePlatform {
  key: ShareKey;
  label: string;
  via: Extract<HandoffVia, 'share-intent' | 'import-url'>;
  /** The page opened (without parameters). */
  base: string;
  /** Length limit of the post text (with link and topics, as the platform counts them). */
  limit?: number;
  /** How the limit is counted, in words for the report. */
  limitNote?: string;
  textSlot: TextSlot;
  /** How topics are written. */
  hashtags: 'param' | 'inline' | 'weibo' | 'none';
  /** Max topics we add. */
  maxTags: number;
  /** Whether the URL format is confirmed by an official page. */
  verified: boolean;
}

export const SHARE_PLATFORMS: Record<ShareKey, SharePlatform> = {
  x: {
    key: 'x',
    label: 'X',
    via: 'share-intent',
    base: 'https://x.com/intent/tweet',
    limit: 280,
    limitNote: '280 字符（中文和 emoji 计 2，链接计 23）',
    textSlot: 'url',
    hashtags: 'param',
    maxTags: 3,
    verified: true,
  },
  threads: {
    key: 'threads',
    label: 'Threads',
    via: 'share-intent',
    base: 'https://www.threads.com/intent/post',
    limit: 500,
    limitNote: '500 字符（emoji 按 UTF-8 字节计）',
    textSlot: 'url',
    // ⚠️ 待核实：Threads 每帖只识别 1 个话题标签。
    hashtags: 'inline',
    maxTags: 1,
    verified: true,
  },
  telegram: {
    key: 'telegram',
    label: 'Telegram',
    via: 'share-intent',
    base: 'https://t.me/share/url',
    // ⚠️ 待核实：消息上限 4096 字符（Bot API 文档），分享页未写。
    limit: 4096,
    textSlot: 'url',
    hashtags: 'inline',
    maxTags: 3,
    verified: true,
  },
  facebook: {
    key: 'facebook',
    label: 'Facebook',
    via: 'share-intent',
    base: 'https://www.facebook.com/sharer/sharer.php',
    // ⚠️ 待核实：帖子上限 63206 字符（第三方资料）。
    limit: 63206,
    textSlot: 'clipboard',
    hashtags: 'inline',
    maxTags: 3,
    verified: false,
  },
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    via: 'share-intent',
    base: 'https://www.linkedin.com/sharing/share-offsite/',
    // ⚠️ 待核实：动态约 3000 字符（SPEC-r8 §5.2）。
    limit: 3000,
    textSlot: 'clipboard',
    hashtags: 'inline',
    maxTags: 3,
    verified: false,
  },
  reddit: {
    key: 'reddit',
    label: 'Reddit',
    via: 'share-intent',
    base: 'https://www.reddit.com/submit',
    // Reddit post titles: 300 characters.
    limit: 300,
    limitNote: '标题 300 字符',
    textSlot: 'url',
    hashtags: 'none',
    maxTags: 0,
    verified: false,
  },
  weibo: {
    key: 'weibo',
    label: '微博',
    via: 'share-intent',
    base: 'https://service.weibo.com/share/share.php',
    // ⚠️ 待核实：正文 ≤ 2000 字（SPEC-r8 §3.8），两个英文字符计 1 字，链接按短链计。
    limit: 2000,
    limitNote: '2000 字（两个英文字符计 1 字）',
    textSlot: 'url',
    hashtags: 'weibo',
    maxTags: 2,
    verified: false,
  },
  pinterest: {
    key: 'pinterest',
    label: 'Pinterest',
    via: 'share-intent',
    base: 'https://www.pinterest.com/pin/create/button/',
    // ⚠️ 待核实：Pin 描述上限 500 字符。
    limit: 500,
    limitNote: '描述 500 字符',
    textSlot: 'url',
    hashtags: 'inline',
    maxTags: 3,
    verified: true,
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    via: 'import-url',
    base: 'https://medium.com/p/import',
    textSlot: 'link-only',
    hashtags: 'none',
    maxTags: 0,
    verified: true,
  },
};

export const SHARE_KEYS = Object.keys(SHARE_PLATFORMS) as ShareKey[];

/* ---------------- copy text ---------------- */

export interface ShareInput {
  title: string;
  summary?: string;
  tags?: readonly string[];
  /** The page being shared (the 辰记 original). */
  link: string;
  /** Text given by the user (or `ShortTextContent.text`): used instead of title + summary. */
  text?: string;
  includeSummary?: boolean;
  includeTags?: boolean;
  lang?: string;
  /** Reddit: post to this subreddit's submit page. */
  subreddit?: string;
  /** 微博: picture shown in the share box; Pinterest: the image to pin (`media`). */
  picture?: string;
  /** Facebook: use the documented Share Dialog with this app id instead of sharer.php. */
  facebookAppId?: string;
}

export interface ShareResult {
  platform: ShareKey;
  via: SharePlatform['via'];
  /** The page to open. */
  openUrl: string;
  /** What to copy: the post text (with topics, and the link where the page does not attach it). */
  copyText: string;
  /** The post text as fitted (no link). */
  text: string;
  /** Topics actually used (without `#`). */
  hashtags: string[];
  report: ReportItem[];
}

function tagWord(tag: string): string | null {
  // Topics are one token: drop spaces / punctuation, keep letters (any script), digits and _.
  const t = tag.replace(/[^\p{L}\p{N}_]+/gu, '');
  return t || null;
}

function inlineTags(p: SharePlatform, tags: string[]): string {
  if (!tags.length) return '';
  if (p.hashtags === 'weibo') return tags.map((t) => `#${t}#`).join(' ');
  if (p.hashtags === 'inline') return tags.map((t) => `#${t}`).join(' ');
  return '';
}

/** The text as the platform will count it (link included where the platform counts it). */
function measure(p: SharePlatform, text: string, tags: string[], link: string): number {
  const inline = inlineTags(p, tags);
  const body = [text, inline].filter(Boolean).join('\n\n');
  switch (p.key) {
    case 'x':
      // X appends the url and the hashtags: " https://t.co/…" (23) and " #tag" each.
      return (
        xWeightedLength(body) +
        (link ? 24 : 0) +
        tags.reduce((n, t) => n + 2 + xWeightedLength(t), 0)
      );
    case 'threads':
      return threadsLength(body) + (link ? 1 + linkCost(link) : 0);
    case 'weibo':
      return weiboLength(`${body} ${link}`);
    case 'telegram':
      return codePoints(body) + (link ? 1 + linkCost(link) : 0);
    default:
      return codePoints(body);
  }
}

/**
 * Rule-based fitting: title (+ summary) (+ topics) within the platform's limit. Shortens the summary first,
 * then drops topics from the end, then shortens the title.
 */
export function fitShareText(
  p: SharePlatform,
  input: { title: string; summary?: string; tags: string[]; link: string; text?: string }
): { text: string; tags: string[]; truncated: boolean; droppedTags: string[] } {
  const limit = p.limit ?? Infinity;
  const tags = [...input.tags];
  const droppedTags: string[] = [];
  const head = (input.text ?? input.title).trim();
  let summary = input.text ? '' : (input.summary ?? '').trim();
  const join = (h: string, s: string) => [h, s].filter(Boolean).join('\n\n');
  const fits = (t: string) => measure(p, t, tags, input.link) <= limit;

  if (fits(join(head, summary)))
    return { text: join(head, summary), tags, truncated: false, droppedTags };

  // 1. shorten the summary (binary search on code points), keep at least ~20 chars or drop it.
  if (summary) {
    const chars = [...summary];
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(join(head, truncate(summary, mid)))) lo = mid;
      else hi = mid - 1;
    }
    summary = lo >= 20 ? truncate(summary, lo) : '';
    if (fits(join(head, summary)))
      return { text: join(head, summary), tags, truncated: true, droppedTags };
  }
  // 2. drop topics from the end.
  while (tags.length && !fits(join(head, summary))) droppedTags.unshift(tags.pop()!);
  if (fits(join(head, summary)))
    return { text: join(head, summary), tags, truncated: true, droppedTags };
  // 3. shorten the head.
  const chars = [...head];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(truncate(head, mid))) lo = mid;
    else hi = mid - 1;
  }
  return { text: truncate(head, Math.max(1, lo)), tags, truncated: true, droppedTags };
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return q.toString();
}

/** Pure: the URL to open and the text to copy for one platform. */
export function buildShare(key: ShareKey, input: ShareInput): ShareResult {
  const p = SHARE_PLATFORMS[key];
  const report: ReportItem[] = [];
  const link = input.link;

  if (p.via === 'import-url') {
    report.push(
      {
        kind: 'handoff.pending',
        level: 'notice',
        text: '已生成 Medium 导入链接，需你在新窗口粘贴原文链接并确认导入',
        detail: { via: p.via, openUrl: p.base, copyText: link },
      },
      {
        kind: 'canonical.set',
        text: 'Medium 导入会自动把 canonical 指回辰记原文',
        detail: { url: link },
      }
    );
    return {
      platform: key,
      via: p.via,
      openUrl: p.base,
      copyText: link,
      text: '',
      hashtags: [],
      report,
    };
  }

  const wanted =
    input.includeTags === false || p.maxTags === 0
      ? []
      : [...new Set((input.tags ?? []).map(tagWord).filter((t): t is string => !!t))];
  const overLimit = wanted.slice(p.maxTags);
  const fit = fitShareText(p, {
    title: input.title,
    // A Reddit link post only has a title.
    ...(input.includeSummary === false || !input.summary || key === 'reddit'
      ? {}
      : { summary: input.summary }),
    tags: wanted.slice(0, p.maxTags),
    link,
    ...(input.text ? { text: input.text } : {}),
  });
  const inline = inlineTags(p, fit.tags);
  const postText = [fit.text, inline].filter(Boolean).join('\n\n');

  let openUrl: string;
  switch (key) {
    case 'x':
      openUrl = `${p.base}?${qs({ text: fit.text, url: link, hashtags: fit.tags.join(',') || undefined })}`;
      break;
    case 'threads':
      openUrl = `${p.base}?${qs({ text: postText, url: link })}`;
      break;
    case 'telegram':
      openUrl = `${p.base}?${qs({ url: link, text: postText })}`;
      break;
    case 'reddit': {
      const base = input.subreddit
        ? `https://www.reddit.com/r/${encodeURIComponent(input.subreddit)}/submit`
        : p.base;
      openUrl = `${base}?${qs({ url: link, title: fit.text })}`;
      break;
    }
    case 'weibo':
      openUrl = `${p.base}?${qs({ url: link, title: postText, pic: input.picture })}`;
      break;
    case 'facebook':
      openUrl = input.facebookAppId
        ? `https://www.facebook.com/dialog/share?${qs({ app_id: input.facebookAppId, display: 'page', href: link, hashtag: fit.tags[0] ? `#${fit.tags[0]}` : undefined })}`
        : `${p.base}?${qs({ u: link })}`;
      break;
    case 'linkedin':
      openUrl = `${p.base}?${qs({ url: link })}`;
      break;
    case 'pinterest':
      openUrl = `${p.base}?${qs({ url: link, media: input.picture, description: postText })}`;
      break;
    default:
      openUrl = p.base;
  }

  // Pages that attach the link as a card get the text alone; elsewhere the copy is the whole post.
  const copyText =
    p.textSlot === 'clipboard'
      ? postText
      : key === 'x'
        ? [fit.text, fit.tags.map((t) => `#${t}`).join(' '), link].filter(Boolean).join(' ')
        : key === 'reddit'
          ? fit.text
          : `${postText}\n${link}`;

  if (fit.truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `分享文案按 ${p.label} 上限${p.limitNote ? ` ${p.limitNote}` : ` ${p.limit} 字`}截短`,
      samples: [input.text ?? input.title],
    });
  const dropped = [...fit.droppedTags, ...overLimit];
  if (dropped.length)
    report.push({
      kind: 'tags.trimmed',
      level: 'info',
      text: `${p.label} 最多带 ${p.maxTags} 个话题，去掉 ${dropped.length} 个`,
      count: dropped.length,
      samples: dropped.slice(0, 3),
    });
  if (key === 'pinterest' && !input.picture)
    report.push({
      kind: 'share.no-image',
      level: 'notice',
      text: '没有封面图：Pinterest 会让你从原文页面里挑一张图',
    });
  if (p.textSlot === 'clipboard')
    report.push({
      kind: 'share.copy',
      text: `${p.label} 的分享页只接收链接，文案已备好，请在分享框里粘贴`,
    });
  report.push({
    kind: 'handoff.pending',
    level: 'notice',
    text: '已生成分享链接，需你在新窗口确认发出',
    detail: { via: p.via, openUrl, copyText, verified: p.verified },
  });
  return {
    platform: key,
    via: p.via,
    openUrl,
    copyText,
    text: fit.text,
    hashtags: fit.tags,
    report,
  };
}

/* ---------------- adapters ---------------- */

const baseFields = {
  /** Your own copy (instead of title + summary); still fitted to the limit. */
  text: z.string().trim().max(5000).optional().describe('分享文案'),
  /** The page to share; default the 辰记 original. */
  link: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('分享链接'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
};

export const shareSchema = z.object(baseFields);
export const redditShareSchema = z.object({
  ...baseFields,
  subreddit: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{2,21}$/, '版块名只能是字母、数字和下划线')
    .optional()
    .describe('版块（r/…）'),
});

export type ShareForm = z.infer<typeof shareSchema> & { subreddit?: string | undefined };

/** Asked before the rules; return the post text (without link) or undefined to keep the rule-based text. */
export interface ShareRewriteRequest {
  platform: ShareKey;
  label: string;
  limit?: number;
  limitNote?: string;
  title: string;
  summary?: string;
  tags: string[];
  link: string;
  lang?: string;
}

export interface ShareAdapterOptions {
  /** AI rewrite hook (e.g. the host's AI helper); its text is still fitted to the limit. */
  rewrite?(req: ShareRewriteRequest, signal?: AbortSignal): Promise<string | undefined>;
  facebookAppId?: string;
  /** Resolves a relative cover for 微博's `pic`. */
  assetBase?: string;
  links?: ErrorLinks;
  runtimes?: RuntimeSupport[];
}

function handoffRuntimes(p: SharePlatform): RuntimeSupport[] {
  return (['web', 'electron', 'server'] as const).map((runtime) => ({
    runtime,
    mode: 'handoff' as const,
    handoff: { via: p.via, url: p.base },
    note:
      p.via === 'import-url'
        ? '先发到辰记，再用 Import story 导入'
        : `打开${p.label}的分享页，由你确认发出`,
  }));
}

function absolute(url: string | undefined, base?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

/** What to share, from article or short-text content. */
export function shareInputOf(
  key: ShareKey,
  doc: Doc,
  form: ShareForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: Pick<ShareAdapterOptions, 'facebookAppId' | 'assetBase'> = {}
): ShareInput | { error: string } {
  const article = content?.kind === 'article' ? content : undefined;
  const short = content?.kind === 'short-text' ? content : undefined;
  const link = form.link || short?.link || article?.canonicalUrl;
  if (!link) return { error: '还没有可分享的链接：先发布到辰记（或在表单里填写链接）' };
  const d = article?.doc ?? doc;
  const text = form.text || short?.thread?.[0] || short?.text || undefined;
  const picture =
    key === 'weibo' || key === 'pinterest' ? absolute(common.cover, opts.assetBase) : undefined;
  return {
    title: common.title || d.title || '',
    ...(common.summary || d.summary ? { summary: common.summary || d.summary } : {}),
    tags: common.tags ?? [],
    link,
    ...(text ? { text } : {}),
    includeSummary: form.include_summary,
    includeTags: form.include_tags,
    ...(article?.lang ? { lang: article.lang } : {}),
    ...(form.subreddit ? { subreddit: form.subreddit } : {}),
    ...(picture ? { picture } : {}),
    ...(opts.facebookAppId ? { facebookAppId: opts.facebookAppId } : {}),
  };
}

export function createShareAdapter(key: ShareKey, opts: ShareAdapterOptions = {}): Adapter<any> {
  const p = SHARE_PLATFORMS[key];
  const ref: PlatformRef = { key, label: p.label, ...(opts.links ? { links: opts.links } : {}) };
  const schema = key === 'reddit' ? redditShareSchema : shareSchema;
  const kinds: ContentKind[] = key === 'medium' ? ['article'] : ['short-text', 'article'];

  return defineAdapter({
    key,
    label: p.label,
    runtimes: opts.runtimes ?? handoffRuntimes(p),
    contentTypes: kinds,
    binding: { kind: 'none', store: 'none' },
    capabilities: { supportsUpdate: false, needsLogin: false },
    schema,
    preview(
      doc: Doc,
      form: ShareForm,
      common: CommonFormShape = {},
      content?: PublishContent
    ): AdapterPreview {
      const input = shareInputOf(key, doc, form, common, content, opts);
      if ('error' in input)
        return {
          format: 'text',
          title: common.title || doc.title,
          body: '',
          report: [{ kind: 'share.no-link', level: 'warn', text: input.error }],
        };
      const r = buildShare(key, input);
      return {
        format: 'text',
        title: input.title,
        body: r.copyText,
        url: r.openUrl,
        report: r.report,
      };
    },
    // SPEC-r11 §12: the reminder a scheduled hand-off task opens (rule-based copy; the AI rewrite runs only on click).
    renderHandoff({ doc, form, common, content }) {
      const input = shareInputOf(key, doc, form as ShareForm, common, content, opts);
      if ('error' in input) throw new Error(input.error);
      const r = buildShare(key, input);
      return {
        handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText },
        report: r.report,
      };
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const input = shareInputOf(key, doc, form as ShareForm, common, content, opts);
        if ('error' in input) throw helpError(ref, input.error, { code: 'no_link' });
        const extra: ReportItem[] = [];
        if (opts.rewrite && !input.text && p.via === 'share-intent') {
          try {
            ctx.emit({ type: 'progress', percent: 30, text: `AI 改写${p.label}文案` });
            const text = await opts.rewrite(
              {
                platform: key,
                label: p.label,
                ...(p.limit ? { limit: p.limit } : {}),
                ...(p.limitNote ? { limitNote: p.limitNote } : {}),
                title: input.title,
                ...(input.summary ? { summary: input.summary } : {}),
                tags: [...(input.tags ?? [])],
                link: input.link,
                ...(input.lang ? { lang: input.lang } : {}),
              },
              ctx.signal
            );
            if (text?.trim()) {
              input.text = text.trim();
              extra.push({ kind: 'summary.generated', text: `${p.label} 分享文案由 AI 改写` });
            }
          } catch (e) {
            if (ctx.signal.aborted) throw e;
            ctx.emit({
              type: 'log',
              level: 'warn',
              text: `AI 改写失败，改用规则生成：${(e as Error).message}`,
            });
          }
        }
        const r = buildShare(key, input);
        const report = [...extra, ...r.report];
        ctx.emit({ type: 'report', items: report });
        ctx.emit({ type: 'progress', percent: 100, text: '分享链接已生成' });
        return {
          url: '',
          state: 'handoff' as const,
          report,
          handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText },
        };
      });
    },
  });
}

/** One adapter per platform, ready to register. */
export function createShareAdapters(
  opts: ShareAdapterOptions = {}
): Record<ShareKey, Adapter<any>> {
  return Object.fromEntries(SHARE_KEYS.map((k) => [k, createShareAdapter(k, opts)])) as Record<
    ShareKey,
    Adapter<any>
  >;
}

/** The `handoff.pending` item of a result's report (where `openUrl` / `copyText` live). */
export function handoffOf(
  report: readonly ReportItem[] | undefined
): { via: string; openUrl: string; copyText: string } | undefined {
  const item = report?.find((i) => i.kind === 'handoff.pending');
  const d = item?.detail as { via?: string; openUrl?: string; copyText?: string } | undefined;
  return d?.openUrl !== undefined && d.via
    ? { via: d.via, openUrl: d.openUrl, copyText: d.copyText ?? '' }
    : undefined;
}
