/**
 * Platform degradation of 辰记's custom blocks (SPEC-r8 §3.0), done on the Tiptap JSON before core's
 * `convert`, so the Markdown and the portable HTML come from the same tree and every change is counted
 * for the report:
 *
 * | block                           | Markdown platforms (DEV / Hashnode)        | HTML platforms (Ghost / WordPress) |
 * | ------------------------------- | ------------------------------------------ | ---------------------------------- |
 * | 提示框 card / callout / notice   | `> **提示**` + content                      | `<blockquote>` with a bold label   |
 * | 徽章标题 `sn-h--pill` …          | `##` / `###`                               | plain `h2` / `h3`                  |
 * | 波浪线等装饰分割线               | `---`                                      | `<hr>`                             |
 * | 代码高亮                         | fenced block with language                 | `<pre><code class="language-x">`   |
 * | 表格                             | GFM; merged cells stay an HTML table       | HTML table                         |
 * | 外链                             | kept                                       | kept                               |
 * | 图片                             | `![alt](abs-url)` + italic caption         | `<figure>`, absolute `src`         |
 * | 公式                             | `$…$` or DEV `{% katex %}`                 | TeX source (no rasterizer yet)     |
 * | 视频 iframe                      | DEV `{% youtube id %}`, else a link        | a link                             |
 */
import { convert } from '@starnote/publish-core';

import { kitMessages } from './i18n';

import type { Doc, ReportItem, SdkLang, TiptapJSON } from '@starnote/publish-core';

export type DegradeTarget = 'markdown' | 'html';

export interface DegradeProfile {
  target: DegradeTarget;
  /** Language of the labels we add (提示 / Tip). Default from the content, else `zh`. */
  lang?: string;
  /** Allowed heading levels after mapping. Default `[2, 3]`. */
  headingLevels?: [number, number];
  /** Drop the first `h1` when its text equals this (the platform shows the title itself). */
  title?: string;
  /** `dollar`: `$…$` (Hashnode); `devto-liquid`: `{% katex inline %}…{% endkatex %}`; `source`: TeX kept. */
  math?: 'dollar' | 'devto-liquid' | 'source';
  /** `devto-liquid`: YouTube iframes become `{% youtube id %}`; otherwise links. */
  video?: 'devto-liquid' | 'link';
  /** Markdown platforms without `==mark==`: drop highlight marks. */
  stripHighlight?: boolean;
  /** Resolves relative image `src` (DEV and Hashnode need absolute URLs). */
  assetBase?: string;
}

export interface DegradeCounts {
  callout: number;
  heading: number;
  headingLevel: number;
  divider: number;
  quote: number;
  code: number;
  tableMerged: number;
  table: number;
  math: number;
  video: number;
  videoEmbedded: number;
  link: number;
  image: number;
  imageResolved: number;
  highlight: number;
  titleDropped: number;
}

export interface DegradedArticle {
  json: TiptapJSON;
  /** `convert` of the degraded tree. */
  doc: Doc;
  /** What is submitted: `doc.markdown` or `doc.portableHtml`. */
  body: string;
  counts: DegradeCounts;
  report: ReportItem[];
}

const LABELS: Record<'zh' | 'en', Record<string, string>> = {
  zh: { tip: '提示', warn: '注意', ask: '问', answer: '答', default: '提示' },
  en: { tip: 'Tip', warn: 'Warning', ask: 'Q', answer: 'A', default: 'Note' },
};

function langOf(lang?: string): 'zh' | 'en' {
  return lang && !/^zh/i.test(lang) ? 'en' : 'zh';
}

function text(t: string, marks?: TiptapJSON['marks']): TiptapJSON {
  return marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };
}

function para(...content: TiptapJSON[]): TiptapJSON {
  return { type: 'paragraph', content };
}

function textOf(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

/** `https://www.youtube.com/embed/ID`, `youtu.be/ID`, `watch?v=ID` → ID. */
export function youtubeId(src: string): string | undefined {
  const m =
    /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(
      src
    );
  return m?.[1];
}

function resolve(src: string, base?: string): string {
  if (!base || /^(https?:|data:)/i.test(src)) return src;
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

function zero(): DegradeCounts {
  return {
    callout: 0,
    heading: 0,
    headingLevel: 0,
    divider: 0,
    quote: 0,
    code: 0,
    tableMerged: 0,
    table: 0,
    math: 0,
    video: 0,
    videoEmbedded: 0,
    link: 0,
    image: 0,
    imageResolved: 0,
    highlight: 0,
    titleDropped: 0,
  };
}

/** Pure transform of the Tiptap tree; see the table above. */
export function degradeJson(
  root: TiptapJSON,
  profile: DegradeProfile
): { json: TiptapJSON; counts: DegradeCounts } {
  const counts = zero();
  const labels = LABELS[langOf(profile.lang)];
  const [minH, maxH] = profile.headingLevels ?? [2, 3];
  const title = profile.title?.trim();
  let titleSeen = false;

  const walkMarks = (marks: TiptapJSON['marks']): TiptapJSON['marks'] => {
    if (!marks) return marks;
    let out = marks;
    if (marks.some((m) => m.type === 'link')) counts.link += 1;
    if (profile.stripHighlight && marks.some((m) => m.type === 'highlight')) {
      counts.highlight += 1;
      out = marks.filter((m) => m.type !== 'highlight');
    }
    return out.length ? out : undefined;
  };

  const walkAll = (nodes: TiptapJSON[] | undefined): TiptapJSON[] =>
    (nodes ?? []).flatMap((n) => {
      const r = walk(n);
      return r === null ? [] : Array.isArray(r) ? r : [r];
    });

  const walk = (node: TiptapJSON): TiptapJSON | TiptapJSON[] | null => {
    const a = node.attrs ?? {};
    switch (node.type) {
      case 'text': {
        const marks = walkMarks(node.marks);
        const out: TiptapJSON = { type: 'text', text: node.text ?? '' };
        if (marks) out.marks = marks;
        return out;
      }
      case 'heading': {
        const level = Number(a.level) || 1;
        if (level === 1 && title && !titleSeen && textOf(node).trim() === title) {
          titleSeen = true;
          counts.titleDropped += 1;
          return null;
        }
        const mapped = Math.min(maxH, Math.max(minH, level));
        if (mapped !== level) counts.headingLevel += 1;
        if (a.variant) counts.heading += 1;
        const attrs: Record<string, unknown> = { ...a, level: mapped };
        delete attrs.variant;
        return { ...node, attrs, content: walkAll(node.content) };
      }
      case 'blockquote': {
        if (a.variant) counts.quote += 1;
        const attrs: Record<string, unknown> = { ...a };
        delete attrs.variant;
        return { ...node, attrs, content: walkAll(node.content) };
      }
      case 'card':
      case 'notice':
      case 'callout': {
        counts.callout += 1;
        const variant = typeof a.variant === 'string' ? a.variant : '';
        const label =
          (typeof a.label === 'string' && a.label.trim()) ||
          (node.type === 'callout' && typeof a.title === 'string' && a.title.trim()) ||
          labels[variant] ||
          (node.type === 'card' ? '' : labels.default);
        let body: TiptapJSON[];
        if (node.type === 'callout' && !node.content?.length) {
          const b = typeof a.body === 'string' ? a.body.replace(/<[^>]+>/g, '').trim() : '';
          body = b ? [para(text(b))] : [];
        } else {
          body = walkAll(node.content);
        }
        const head = label ? [para(text(label, [{ type: 'bold' }]))] : [];
        return { type: 'blockquote', content: [...head, ...body] };
      }
      case 'divider': {
        if ((a.variant && a.variant !== 'line') || a.label) counts.divider += 1;
        return { type: 'horizontalRule' };
      }
      case 'codeBlock':
        counts.code += 1;
        return node;
      case 'table': {
        const merged = (node.content ?? []).some((r) =>
          (r.content ?? []).some(
            (c) => Number(c.attrs?.colspan) > 1 || Number(c.attrs?.rowspan) > 1
          )
        );
        if (merged) counts.tableMerged += 1;
        else counts.table += 1;
        return { ...node, content: walkAll(node.content) };
      }
      case 'katex': {
        counts.math += 1;
        const tex = String(a.text ?? '');
        if (profile.math === 'devto-liquid') return text(`{% katex inline %}${tex}{% endkatex %}`);
        if (profile.math === 'source' && profile.target === 'html') return text(`$${tex}$`);
        return node;
      }
      case 'iframe': {
        const src = typeof a.src === 'string' ? a.src : '';
        if (!src) return null;
        counts.video += 1;
        const id = youtubeId(src);
        if (profile.video === 'devto-liquid' && id) {
          counts.videoEmbedded += 1;
          return para(text(`{% youtube ${id} %}`));
        }
        return para(text(src, [{ type: 'link', attrs: { href: src } }]));
      }
      case 'image':
      case 'imageBlock':
      case 'imageGif':
      case 'mermaid': {
        const src = typeof a.src === 'string' ? a.src : '';
        if (!src) return node;
        counts.image += 1;
        const abs = resolve(src, profile.assetBase);
        if (abs !== src) counts.imageResolved += 1;
        return { ...node, attrs: { ...a, src: abs } };
      }
      default:
        return node.content ? { ...node, content: walkAll(node.content) } : node;
    }
  };

  const out = walk(root);
  const json = (Array.isArray(out) ? { type: 'doc', content: out } : out) ?? {
    type: 'doc',
    content: [],
  };
  return { json, counts };
}

/** The report for a set of counts (one item per kind so `mergeReports` keeps them apart). */
export function degradeReport(
  counts: DegradeCounts,
  profile: DegradeProfile,
  platform: string,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): ReportItem[] {
  const m = kitMessages(lang).degrade;
  const md = profile.target === 'markdown';
  const items: ReportItem[] = [];
  const add = (n: number, item: Omit<ReportItem, 'count'>) => {
    if (n > 0) items.push({ ...item, count: n });
  };
  add(counts.callout, {
    kind: 'block.degraded.callout',
    text: m.callout(counts.callout),
    detail: { block: 'sn-box', to: 'blockquote' },
  });
  add(counts.heading, {
    kind: 'block.degraded.heading',
    text: m.heading(counts.heading),
    detail: { block: 'sn-h', to: md ? '##' : 'h2/h3' },
  });
  add(counts.headingLevel, {
    kind: 'heading.mapped',
    text: m.headingLevel(counts.headingLevel),
  });
  add(counts.divider, {
    kind: 'block.degraded.divider',
    text: m.divider(counts.divider),
    detail: { block: 'divider', to: md ? '---' : 'hr' },
  });
  add(counts.quote, {
    kind: 'block.degraded.quote',
    text: m.quote(counts.quote),
  });
  add(counts.code, {
    kind: 'code.fenced',
    text: md ? m.codeFenced(counts.code, platform) : m.codeKept(counts.code),
  });
  add(counts.tableMerged, {
    kind: 'table.html',
    level: 'notice',
    text: md ? m.tableMergedMd(counts.tableMerged) : m.tableMergedHtml(counts.tableMerged),
  });
  if (!md)
    add(counts.table, {
      kind: 'table.kept',
      text: m.table(counts.table),
    });
  add(counts.math, {
    kind: profile.math === 'devto-liquid' ? 'math.liquid' : 'math.as-source',
    level: profile.math === 'devto-liquid' || profile.math === 'dollar' ? 'info' : 'warn',
    text:
      profile.math === 'devto-liquid'
        ? m.mathLiquid(counts.math)
        : profile.math === 'dollar'
          ? m.mathDollar(counts.math)
          : m.mathTex(counts.math),
  });
  add(counts.videoEmbedded, {
    kind: 'video.embedded',
    text: m.youtube(counts.videoEmbedded),
  });
  add(counts.video - counts.videoEmbedded, {
    kind: 'video.linkified',
    text: m.video(counts.video - counts.videoEmbedded),
  });
  add(counts.link, { kind: 'link.kept', text: m.link(counts.link) });
  add(counts.imageResolved, {
    kind: 'image.absolute',
    text: m.imageAbsolute(counts.imageResolved),
  });
  add(counts.highlight, {
    kind: 'mark.stripped',
    text: m.highlight(platform, counts.highlight),
  });
  return items;
}

/** Degrades, converts and reports in one go. */
export function degradeArticle(
  doc: Doc,
  profile: DegradeProfile,
  platform: string,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): DegradedArticle {
  const { json, counts } = degradeJson(doc.json, profile);
  const out = convert(json);
  return {
    json,
    doc: out,
    body: profile.target === 'markdown' ? out.markdown : out.portableHtml,
    counts,
    report: degradeReport(counts, profile, platform, lang),
  };
}
