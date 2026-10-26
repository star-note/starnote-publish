/** Length limits: titles, summaries, tags and share copy. Pure, browser-safe. */
import { CANONICAL_PLACEHOLDER, CANONICAL_PLACEHOLDER_RESERVE } from '@starnote/publish-core';

import type { ReportItem } from '@starnote/publish-core';

/** Code points, so an emoji or a CJK character counts once. */
export function codePoints(s: string): number {
  return [...s].length;
}

/** Cuts to `max` code points (by default) and ends with `…` when anything was cut. */
export function truncate(
  s: string,
  max: number,
  count: (s: string) => number = codePoints,
  ellipsis = '…'
): string {
  if (count(s) <= max) return s;
  const budget = max - count(ellipsis);
  let out = '';
  for (const ch of s) {
    if (count(out + ch) > budget) break;
    out += ch;
  }
  return out.replace(/\s+$/, '') + ellipsis;
}

/** Title within `max`, with a `title.truncated` report item when cut. */
export function fitTitle(
  title: string,
  max: number | undefined,
  platform: string
): { title: string; report: ReportItem[] } {
  const t = title.trim();
  if (!max || codePoints(t) <= max) return { title: t, report: [] };
  const cut = truncate(t, max);
  return {
    title: cut,
    report: [
      {
        kind: 'title.truncated',
        level: 'notice',
        text: `标题超过 ${platform} 上限 ${max} 字，已截短`,
        samples: [t],
      },
    ],
  };
}

/** Summary within `max`, with `summary.truncated` when cut. */
export function fitSummary(
  summary: string | undefined,
  max: number | undefined,
  platform: string
): { summary: string | undefined; report: ReportItem[] } {
  const s = summary?.trim();
  if (!s) return { summary: undefined, report: [] };
  if (!max || codePoints(s) <= max) return { summary: s, report: [] };
  return {
    summary: truncate(s, max),
    report: [
      {
        kind: 'summary.truncated',
        text: `摘要超过 ${platform} 上限 ${max} 字，已截短`,
      },
    ],
  };
}

export interface FitTagsOptions {
  max: number;
  /** Returns the platform form of a tag, or `null` when it cannot be used there. */
  normalize?: (tag: string) => string | null;
}

/**
 * Normalizes, de-duplicates and caps tags. Reports `tags.mapped` when a tag had to change and
 * `tags.trimmed` when tags were dropped (unusable or over the limit).
 */
export function fitTags(
  tags: readonly string[] | undefined,
  opts: FitTagsOptions,
  platform: string
): { tags: string[]; report: ReportItem[] } {
  const out: string[] = [];
  const mapped: string[] = [];
  const unusable: string[] = [];
  for (const raw of tags ?? []) {
    const t = raw.trim();
    if (!t) continue;
    const n = opts.normalize ? opts.normalize(t) : t;
    if (!n) {
      unusable.push(t);
      continue;
    }
    if (n !== t) mapped.push(`${t} → ${n}`);
    if (!out.includes(n)) out.push(n);
  }
  const over = out.slice(opts.max);
  const tagsOut = out.slice(0, opts.max);
  const report: ReportItem[] = [];
  if (mapped.length)
    report.push({
      kind: 'tags.mapped',
      text: `标签按 ${platform} 规则改写 ${mapped.length} 个`,
      count: mapped.length,
      samples: mapped.slice(0, 3),
    });
  const dropped = [...unusable, ...over];
  if (dropped.length) {
    const parts = [
      over.length ? `${platform} 最多 ${opts.max} 个标签，已截断为 ${opts.max} 个` : '',
      unusable.length ? `${unusable.length} 个标签不符合平台规则被去掉` : '',
    ].filter(Boolean);
    report.push({
      kind: 'tags.trimmed',
      level: 'notice',
      text: parts.join('；'),
      count: dropped.length,
      samples: dropped.slice(0, 3),
    });
  }
  return { tags: tagsOut, report };
}

/**
 * X counts characters by weight (twitter-text v3): Latin, general punctuation etc. weigh 1, everything
 * else (CJK, emoji) 2; every URL counts as 23 (t.co). Returns the weighted length.
 */
export function xWeightedLength(s: string, urlWeight = 23): number {
  const URL_RE = /https?:\/\/\S+/g;
  let n = 0;
  const withoutUrls = s.replace(URL_RE, () => {
    n += urlWeight;
    return '';
  });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const light =
      (cp >= 0 && cp <= 4351) ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

/**
 * 微博 counts two ASCII characters as one and a link as a fixed short link. ⚠️ 待核实：链接按 t.cn
 * 短链约 20 个 ASCII（10 字）计、全角字符计 1 字，来自第三方经验。
 */
export function weiboLength(s: string, urlChars = 10): number {
  const URL_RE = /https?:\/\/\S+/g;
  let half = 0;
  let n = 0;
  const withoutUrls = s.replace(URL_RE, () => {
    n += urlChars;
    return '';
  });
  for (const ch of withoutUrls) {
    if (ch.codePointAt(0)! < 128) half += 1;
    else n += 1;
  }
  return n + Math.ceil(half / 2);
}

/**
 * Threads counts characters, but emoji by their UTF-8 bytes (SPEC-r8 §5.2 ✅ 官方文档：「emoji 按 UTF-8
 * 字节计」).
 */
export function threadsLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    n += /\p{Extended_Pictographic}/u.test(ch) ? new TextEncoder().encode(ch).length : 1;
  }
  return n;
}

/** A topic as one token: letters (any script), digits and `_`; `null` when nothing (or only digits) is left. */
export function hashtagWord(tag: string): string | null {
  const w = tag.replace(/[^\p{L}\p{N}_]+/gu, '');
  return w && !/^\d+$/.test(w) ? w : null;
}

/**
 * How many characters a link counts for in a fitted post: its own length, but the scheduled-batch placeholder
 * (`CANONICAL_PLACEHOLDER`) reserves `CANONICAL_PLACEHOLDER_RESERVE` (the real link replaces it later).
 */
export function linkCost(
  link: string | undefined,
  count: (s: string) => number = codePoints
): number {
  if (!link) return 0;
  return link === CANONICAL_PLACEHOLDER
    ? Math.max(CANONICAL_PLACEHOLDER_RESERVE, count(link))
    : count(link);
}

export interface FitPostInput {
  /** The title, or the user's own text. */
  head: string;
  summary?: string;
  /** Topic words (no `#`). */
  tags?: readonly string[];
  /** The link written at the end of the text (leave out when the platform attaches it as a card). */
  link?: string;
  /** Limit of the whole text, link and topics included, as `count` measures it. */
  limit: number;
  /** Default: code points. */
  count?: (s: string) => number;
  /** How a topic is written. Default `#word`. */
  hashtag?: (word: string) => string;
  /** Keep at least this many characters of a shortened summary, else drop it. Default 20. */
  minSummary?: number;
}

export interface FitPostResult {
  /** The whole post: head (+ summary) (+ topics) (+ link), blank lines between. */
  text: string;
  head: string;
  summary: string;
  tags: string[];
  truncated: boolean;
  droppedTags: string[];
}

/**
 * Rule-based fitting of a short post (SPEC-r11 §10 「只发引流卡片」): shortens the summary first, then drops topics
 * from the end, then shortens the head. The link is never cut.
 */
export function fitPost(input: FitPostInput): FitPostResult {
  const count = input.count ?? codePoints;
  const tagOf = input.hashtag ?? ((w: string) => `#${w}`);
  const minSummary = input.minSummary ?? 20;
  const tags = [...(input.tags ?? [])];
  const droppedTags: string[] = [];
  let head = input.head.trim();
  let summary = (input.summary ?? '').trim();
  const reserve = input.link ? linkCost(input.link, count) - count(input.link) : 0;
  const compose = (h: string, s: string, tg: string[]) =>
    [[h, s].filter(Boolean).join('\n\n'), tg.map(tagOf).join(' '), input.link ?? '']
      .filter(Boolean)
      .join('\n\n');
  const fits = (h: string, s: string, tg: string[]) =>
    count(compose(h, s, tg)) + reserve <= input.limit;
  const done = (truncated: boolean): FitPostResult => ({
    text: compose(head, summary, tags),
    head,
    summary,
    tags,
    truncated,
    droppedTags,
  });
  if (fits(head, summary, tags)) return done(false);
  if (summary) {
    let lo = 0;
    let hi = codePoints(summary);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(head, truncate(summary, mid, count), tags)) lo = mid;
      else hi = mid - 1;
    }
    summary = lo >= minSummary ? truncate(summary, lo, count) : '';
    if (fits(head, summary, tags)) return done(true);
  }
  while (tags.length && !fits(head, summary, tags)) droppedTags.unshift(tags.pop()!);
  if (fits(head, summary, tags)) return done(true);
  let lo = 1;
  let hi = codePoints(head);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(truncate(head, mid, count), summary, tags)) lo = mid;
    else hi = mid - 1;
  }
  head = truncate(head, Math.max(1, lo), count);
  return done(true);
}

/**
 * `text` + `sep` + `link` within `max`: only the text is shortened, the link is kept whole (a scheduled batch's
 * placeholder is budgeted at `CANONICAL_PLACEHOLDER_RESERVE`, so the server's substitution never cuts it).
 */
export function appendLink(
  text: string,
  link: string | undefined,
  max: number,
  sep = '\n\n',
  count: (s: string) => number = codePoints
): string {
  if (!link) return truncate(text, max, count);
  const room = max - linkCost(link, count) - count(sep);
  const head = text && room > 0 ? truncate(text, room, count) : '';
  return head ? `${head}${sep}${link}` : link;
}
