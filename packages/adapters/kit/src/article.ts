/** Small pieces every relay adapter needs: the article, its canonical link, runtimes, the image report. */
import { LINK_PLACEMENT, visibleLinkOf } from '@starnote/publish-core';
import { z } from 'zod';

import { hashtagWord } from './text';

import type {
  ArticleContent,
  CommonFormShape,
  Doc,
  FollowUpInput,
  LinkPlacement,
  PlatformKey,
  PublishContent,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';

/** The content as an article (`PublishJob.doc` wrapped when the job gave none). */
export function articleOf(doc: Doc, content?: PublishContent): ArticleContent {
  return content?.kind === 'article' ? content : { kind: 'article', doc };
}

/**
 * The canonical link: the form's explicit URL, else the 辰记 original (`ArticleContent.canonicalUrl`),
 * unless the form turned it off. Reports `canonical.set`.
 */
export function canonicalOf(
  form: { canonical_url?: string | undefined; set_canonical?: boolean | undefined },
  article: ArticleContent,
  platform: string
): { url: string | undefined; report: ReportItem[] } {
  if (form.set_canonical === false) return { url: undefined, report: [] };
  const url = form.canonical_url || article.canonicalUrl;
  if (!url) {
    return {
      url: undefined,
      report: [
        {
          kind: 'canonical.missing',
          level: 'notice',
          text: '还没有辰记原文链接，这次没有设置 canonical（先发布到辰记再同步可以把搜索权重留给原文）',
        },
      ],
    };
  }
  return {
    url,
    report: [
      {
        kind: 'canonical.set',
        text: form.canonical_url ? `设置 canonical 指向 ${url}` : `设置 canonical 指回辰记原文`,
        detail: { url, platform },
      },
    ],
  };
}

/**
 * The link of a 「本文首发于辰记」 / 「Originally published at」 line (SPEC-r12 §5.3): readers click it, so it is the
 * tracking short link — unless the form named its own canonical URL, which then wins.
 */
export function originLinkOf(
  form: { canonical_url?: string | undefined },
  article: ArticleContent,
  canonicalUrl: string
): string {
  return form.canonical_url ? canonicalUrl : article.trackingUrl || canonicalUrl;
}

/**
 * Browser / desktop through 辰记's API (`relayPublish`): the SDK renders the request body, the server adds the
 * stored credential and sends it (服务器代发). Scheduling is the server's business, not this runtime's.
 */
export const CLIENT_RELAY: RuntimeSupport[] = [
  { runtime: 'web', mode: 'api', needs: ['token'], note: '由服务器代发（凭据只在服务器）' },
  { runtime: 'electron', mode: 'api', needs: ['token'], note: '由服务器代发（凭据只在服务器）' },
];

/** Predicted report for images linked from 辰记 (or uploaded by the server where the relay body asks for it). */
export function linkedImagesReport(n: number, platform: string): ReportItem[] {
  return n
    ? [
        {
          kind: 'image.linked',
          text: `${n} 张图片以辰记图片链接引用（${platform} 直接加载外链）`,
          count: n,
        },
      ]
    : [];
}

/**
 * HTML platforms without a canonical field (Blogger, WordPress.com): a 「本文首发于辰记」 / 「Originally published at」
 * line with the link closes the post.
 */
export function originNoteHtml(url: string, lang?: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const en = !!lang && !/^zh/i.test(lang);
  const link = `<a href="${esc(url)}">${en ? esc(url) : '辰记'}</a>`;
  return `\n<hr>\n<p><em>${en ? `Originally published at ${link}.` : `本文首发于${link}。`}</em></p>`;
}

/** Relative `/assets/…` (or `./…`) → absolute on `base`; absolute http(s) kept; anything else dropped. */
export function absoluteUrl(url: string | undefined, base?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base || !/^\/|^\.\.?\//.test(url)) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

/** What a short post / link card is made of (SPEC-r11 §10 「只发引流卡片，不发全文」). */
export interface CardSource {
  /** The note's title (or the form's). */
  title: string;
  /** The summary (common, else the note's first sentences). */
  summary: string;
  /** The user's own text (form, or `ShortTextContent.text`): used instead of title + summary when given. */
  text?: string;
  /**
   * The link back to 辰记 readers click (form link, else the tracking short link, short-text link, canonical, image
   * set's article — SPEC-r12 §5.3) — may be the placeholder.
   */
  link?: string;
  /** Topic words without `#`, deduplicated (`hashtagWord`). */
  tags: string[];
  /** Absolute cover URL, when there is one. */
  cover?: string;
  /** Absolute image URLs: the cover first, then the note's / set's images. */
  images: string[];
  lang?: string;
}

/**
 * Pure: the pieces of a link card from any content. Relative images are made absolute on `assetBase` (dropped
 * when that is not possible).
 */
export function cardOf(
  doc: Doc,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: {
    assetBase?: string | undefined;
    text?: string | undefined;
    link?: string | undefined;
  } = {}
): CardSource {
  const short = content?.kind === 'short-text' ? content : undefined;
  const set = content?.kind === 'image-set' ? content : undefined;
  const article = content?.kind === 'article' ? content : set?.from;
  const d = article?.doc ?? doc;
  const link = opts.link || visibleLinkOf(content);
  const text = opts.text || short?.thread?.[0] || short?.text || set?.caption || undefined;
  const tags = [
    ...new Set(
      [...(set?.topics ?? []), ...(common.tags ?? [])]
        .map(hashtagWord)
        .filter((t): t is string => !!t)
    ),
  ];
  const cover = absoluteUrl(common.cover, opts.assetBase);
  const raw = [
    ...(cover ? [cover] : []),
    ...(set ? set.images.map((i) => i.url) : (short?.images ?? []).map((i) => i.url)),
    ...(set ? [] : d.images),
  ];
  const images = [
    ...new Set(raw.map((u) => absoluteUrl(u, opts.assetBase)).filter((u): u is string => !!u)),
  ];
  return {
    title: (common.title || d.title || set?.title || '').trim(),
    summary: (common.summary || d.summary || '').trim(),
    ...(text ? { text: text.trim() } : {}),
    ...(link ? { link } : {}),
    tags,
    ...(cover ? { cover } : {}),
    images,
    ...(article?.lang ? { lang: article.lang } : {}),
  };
}

/** `canonical.missing` for a short post without a link back to 辰记. */
export function missingLinkReport(platform: string): ReportItem {
  return {
    kind: 'canonical.missing',
    level: 'notice',
    text: `还没有辰记原文链接，${platform} 帖子里没有链接（先发布到辰记再同步可以带上原文卡片）`,
  };
}

/**
 * SPEC-r11 §10: the short-post platforms never edit an earlier post — with `ctx.previous` the new post is a new one,
 * and the report says so (`update.unsupported`).
 */
export function newPostReport(previous: { externalId?: string } | undefined): ReportItem[] {
  return previous?.externalId
    ? [
        {
          kind: 'update.unsupported',
          level: 'notice',
          text: '这次发出的是一条新帖子（不修改之前发过的）',
        },
      ]
    : [];
}

/**
 * SPEC-r12 §2.2: the platform form's `linkPlacement` field (only on the platforms of `LINK_PLACEMENT`), defaulting
 * to the registry's choice.
 */
export function linkPlacementField(platform: PlatformKey) {
  return z
    .enum(['body', 'first_comment'])
    .default(LINK_PLACEMENT[platform] ?? 'body')
    .describe('原文链接');
}

/** SPEC-r12 §2.2: the link comment — `原文：{url}` for a Chinese note, `Read more: {url}` for another language. */
export function linkCommentText(url: string, lang?: string): string {
  return lang && !/^zh/i.test(lang) ? `Read more: ${url}` : `原文：${url}`;
}

/**
 * Where the link goes (SPEC-r12 §2.2). `body`: the post keeps the link (`bodyLink`). `first_comment`: the post gets
 * no link and no link card, and the link becomes the follow-up comment (reported as `link.first_comment`). No
 * link at all: nothing to place.
 */
export function placeLink(
  placement: LinkPlacement | undefined,
  link: string | undefined,
  lang?: string
): { bodyLink: string | undefined; followUp?: FollowUpInput; report: ReportItem[] } {
  if (placement !== 'first_comment' || !link) return { bodyLink: link, report: [] };
  const text = linkCommentText(link, lang);
  return {
    bodyLink: undefined,
    followUp: { kind: 'link_comment', text },
    report: [
      {
        kind: 'link.first_comment',
        text: '原文链接不放正文，发帖后作为第一条评论发出',
        detail: { url: link, text },
      },
    ],
  };
}
