/** Small pieces every relay adapter needs: the article, its canonical link, runtimes, the image report. */
import type {
  ArticleContent,
  Doc,
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
