/**
 * Telegraph (✅ telegra.ph/api): `createAccount` (`short_name` 1–32, `author_name` 0–128, `author_url` 0–512) returns
 * an `access_token`; `createPage` (`access_token`, `title` 1–256, `content` Array of Node ≤ 64 KB, `author_name`,
 * `author_url`, `return_content`) and `editPage/{path}` (title and content required again) return a Page
 * `{path, url, title, views}`; `getViews/{path}` → `{views}`. Responses are `{ok: true, result}` / `{ok: false,
 * error}`. Node = string | `{tag, attrs?: {href?, src?}, children?: Node[]}`, tags: a, aside, b, blockquote, br,
 * code, em, figcaption, figure, h3, h4, hr, i, iframe, img, li, ol, p, pre, s, strong, u, ul, video.
 *
 * Binding is automatic: 辰记's API calls `createAccount` and keeps the token (the user may give an author name).
 * Browser-safe: this file renders the Node JSON (from the degraded Tiptap tree, so the preview and the page agree) and
 * the relay body; the server adds the token and sends it.
 *
 * ⚠️ Not in the docs: whether a JSON request body is accepted (the server posts form fields with `content` as a JSON
 * string), error strings other than `SHORT_NAME_REQUIRED`, rate limits, whether external image URLs always display.
 */
import {
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
} from '@starnote/publish-core';
import {
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitTitle,
  guard,
  linkedImagesReport,
  num,
  originLinkOf,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PlatformStats,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  StatsContext,
  TiptapJSON,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const TELEGRAPH_API = 'https://api.telegra.ph';

export const TELEGRAPH_LIMITS = {
  /** ✅ 1–256 */
  titleMax: 256,
  /** ✅ 0–128 */
  authorNameMax: 128,
  /** ✅ content up to 64 KB */
  contentBytes: 64 * 1024,
} as const;

/** ✅ the tags Telegraph accepts. */
export const TELEGRAPH_TAGS = [
  'a',
  'aside',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'figcaption',
  'figure',
  'h3',
  'h4',
  'hr',
  'i',
  'iframe',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'u',
  'ul',
  'video',
] as const;
export type TelegraphTag = (typeof TELEGRAPH_TAGS)[number];

export interface TelegraphElement {
  tag: TelegraphTag;
  attrs?: { href?: string; src?: string };
  children?: TelegraphNode[];
}
export type TelegraphNode = string | TelegraphElement;

export const telegraphSchema = z.object({
  /** Shown under the title; defaults to the one given when binding. */
  author_name: z.string().trim().max(128, '作者名最多 128 字').optional().describe('作者名'),
  /** Opened when readers click the author name. */
  author_url: z
    .string()
    .trim()
    .max(512)
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('作者链接'),
  origin_note: z.boolean().default(true).describe('文末注明原文'),
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  /** The page path of an earlier publish (percent-encoded), to edit instead of creating. */
  external_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_%-]{1,512}$/, '页面路径格式不对')
    .optional()
    .describe('已发布页面'),
});

export type TelegraphForm = z.infer<typeof telegraphSchema>;
export type TelegraphFormInput = z.input<typeof telegraphSchema>;

/** Nothing secret to paste: the server creates the account. The author name is optional. */
export const telegraphKeyForm = z.object({
  author_name: z
    .string()
    .trim()
    .max(128, '作者名最多 128 字')
    .optional()
    .describe('作者名（可选）'),
});

export const telegraphBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'telegraph',
  fields: ['author_name'],
  form: telegraphKeyForm,
  helpUrl: 'https://telegra.ph/api',
  instructions: [
    'Telegraph 不用注册：点「绑定」后辰记自动为你创建一个 Telegraph 账号，令牌只存在辰记服务器',
    '作者名可选，会显示在每篇文章标题下面',
    '解绑后令牌作废，已经发出的页面不能再从辰记修改',
  ],
};

export interface TelegraphPageBody {
  page: {
    title: string;
    content: TelegraphNode[];
    author_name?: string;
    author_url?: string;
  };
}

export interface TelegraphRendered {
  title: string;
  nodes: TelegraphNode[];
  previewHtml: string;
  body: TelegraphPageBody;
  report: ReportItem[];
}

/* ---------------- Tiptap → Telegraph Node ---------------- */

const MARK_TAG: Record<string, TelegraphTag> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
};

interface Counts {
  table: number;
  task: number;
  dropped: number;
}

function textOf(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

function inline(nodes: TiptapJSON[] | undefined, counts: Counts): TelegraphNode[] {
  const out: TelegraphNode[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      let node: TelegraphNode = n.text ?? '';
      if (!node) continue;
      for (const mark of [...(n.marks ?? [])].reverse()) {
        const href = mark.attrs?.href;
        if (mark.type === 'link' && typeof href === 'string' && /^(https?:|mailto:)/i.test(href))
          node = { tag: 'a', attrs: { href }, children: [node] };
        else if (MARK_TAG[mark.type]) node = { tag: MARK_TAG[mark.type]!, children: [node] };
      }
      out.push(node);
    } else if (n.type === 'hardBreak') out.push({ tag: 'br' });
    else if (n.type === 'katex') out.push(`$${String(n.attrs?.text ?? '')}$`);
    else if (n.type === 'image') {
      const src = n.attrs?.src;
      if (typeof src === 'string' && /^https?:\/\//i.test(src))
        out.push({ tag: 'img', attrs: { src } });
    } else out.push(...inline(n.content, counts));
  }
  return out;
}

/** Inline content of a block that holds paragraphs (list items, quotes): paragraphs joined with line breaks. */
function flatten(nodes: TiptapJSON[] | undefined, counts: Counts): TelegraphNode[] {
  const out: TelegraphNode[] = [];
  for (const n of nodes ?? []) {
    const part =
      n.type === 'paragraph' || n.type === 'heading'
        ? inline(n.content, counts)
        : n.type === 'text'
          ? inline([n], counts)
          : flatten(n.content, counts);
    if (!part.length) continue;
    if (out.length) out.push({ tag: 'br' });
    out.push(...part);
  }
  return out;
}

function el(
  tag: TelegraphTag,
  children: TelegraphNode[],
  attrs?: TelegraphElement['attrs']
): TelegraphElement {
  return { tag, ...(attrs ? { attrs } : {}), ...(children.length ? { children } : {}) };
}

function listItems(node: TiptapJSON, counts: Counts): TelegraphElement[] {
  return (node.content ?? []).map((item) => {
    const own = (item.content ?? []).filter(
      (c) => !['bulletList', 'orderedList', 'taskList'].includes(c.type)
    );
    const nested = (item.content ?? []).filter((c) =>
      ['bulletList', 'orderedList', 'taskList'].includes(c.type)
    );
    const prefix: TelegraphNode[] = [];
    if (item.type === 'taskItem') {
      counts.task += 1;
      prefix.push(item.attrs?.checked ? '☑ ' : '☐ ');
    }
    return el('li', [
      ...prefix,
      ...flatten(own, counts),
      ...nested.flatMap((c) => blocks(c, counts)),
    ]);
  });
}

function blocks(node: TiptapJSON, counts: Counts): TelegraphNode[] {
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'doc':
    case 'details':
    case 'detailsContent':
    case 'detailsSummary':
      return (node.content ?? []).flatMap((c) => blocks(c, counts));
    case 'paragraph': {
      const kids = inline(node.content, counts);
      return kids.length ? [el('p', kids)] : [];
    }
    case 'heading':
      return [el(Number(a.level) >= 4 ? 'h4' : 'h3', inline(node.content, counts))];
    case 'bulletList':
    case 'taskList':
      return [el('ul', listItems(node, counts))];
    case 'orderedList':
      return [el('ol', listItems(node, counts))];
    case 'blockquote':
      return [el('blockquote', flatten(node.content, counts))];
    case 'codeBlock':
      return [el('pre', [textOf(node)])];
    case 'horizontalRule':
    case 'divider':
      return [{ tag: 'hr' }];
    case 'image':
    case 'imageBlock':
    case 'imageGif':
    case 'mermaid': {
      const src = typeof a.src === 'string' ? a.src : '';
      if (!/^https?:\/\//i.test(src)) {
        counts.dropped += 1;
        return [];
      }
      const caption = typeof a.caption === 'string' ? a.caption.trim() : '';
      return [
        el('figure', [
          { tag: 'img', attrs: { src } },
          ...(caption ? [el('figcaption', [caption])] : []),
        ]),
      ];
    }
    case 'table': {
      // no tables on Telegraph: one paragraph per row, cells separated by ` | `
      counts.table += 1;
      return (node.content ?? []).map((row) =>
        el(
          'p',
          (row.content ?? []).flatMap((cell, i) => [
            ...(i ? [' | '] : []),
            ...flatten(cell.content, counts),
          ])
        )
      );
    }
    default:
      if (node.content?.length) return (node.content ?? []).flatMap((c) => blocks(c, counts));
      return [];
  }
}

/** UTF-8 size of the `content` JSON. */
export function telegraphContentBytes(nodes: TelegraphNode[]): number {
  return new TextEncoder().encode(JSON.stringify(nodes)).length;
}

function originNodes(url: string, lang?: string): TelegraphNode[] {
  const link = (text: string): TelegraphElement => ({
    tag: 'a',
    attrs: { href: url },
    children: [text],
  });
  const line: TelegraphNode[] =
    lang && /^ja/i.test(lang)
      ? ['この記事は ', link('StarNote（辰記）'), ' で最初に公開されました。']
      : lang && !/^zh/i.test(lang)
        ? ['Originally published at ', link(url), '.']
        : ['本文首发于', link('辰记'), '。'];
  return [{ tag: 'hr' }, el('p', [el('em', line)])];
}

/** Pure: the Node JSON, the request body and the predicted report. */
export function renderTelegraph(
  doc: Doc,
  form: TelegraphForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): TelegraphRendered {
  const article = articleOf(doc, content);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'html',
      lang: article.lang,
      title: article.doc.title,
      headingLevels: [3, 4],
      math: 'source',
      video: 'link',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'Telegraph'
  );
  const counts: Counts = { table: 0, task: 0, dropped: 0 };
  const nodes = blocks(degraded.json, counts);
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    TELEGRAPH_LIMITS.titleMax,
    'Telegraph'
  );
  const report: ReportItem[] = [...mediaReport('telegraph', 'Telegraph', content, common)];
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, 'Telegraph');
  if (form.origin_note && canonical.url) {
    nodes.push(...originNodes(originLinkOf(form, article, canonical.url), article.lang));
    report.push({ kind: 'origin.note', text: '文末注明首发于辰记并附原文链接' });
  }
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length - counts.dropped, 'Telegraph'),
    ...title.report
  );
  if (counts.table)
    report.push({
      kind: 'table.flattened',
      level: 'notice',
      text: `Telegraph 没有表格：${counts.table} 个表格改为每行一段、单元格用 | 分隔`,
      count: counts.table,
    });
  if (counts.dropped)
    report.push({
      kind: 'image.dropped',
      level: 'warn',
      text: `${counts.dropped} 张图片没有公网地址，Telegraph 显示不了，已去掉`,
      count: counts.dropped,
    });
  const bytes = telegraphContentBytes(nodes);
  if (bytes > TELEGRAPH_LIMITS.contentBytes)
    report.push({
      kind: 'body.too_large',
      level: 'error',
      text: `正文约 ${Math.ceil(bytes / 1024)} KB，超过 Telegraph 的 64 KB 上限，请拆成几篇`,
    });

  return {
    title: title.title,
    nodes,
    previewHtml: degraded.doc.portableHtml,
    body: {
      page: {
        title: title.title,
        content: nodes,
        ...(form.author_name ? { author_name: form.author_name } : {}),
        ...(form.author_url ? { author_url: form.author_url } : {}),
      },
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function telegraphRef(links?: ErrorLinks): PlatformRef {
  return { key: 'telegraph', label: 'Telegraph', ...(links ? { links } : {}) };
}

/**
 * What 辰记's API sends to Telegraph (`app/services/relay_platforms.py`), form-encoded with `content` as a JSON
 * string: bind `createAccount`, publish `createPage`, update `editPage/{path}`.
 */
export const TELEGRAPH_REQUESTS = {
  bind: {
    method: 'POST',
    url: `${TELEGRAPH_API}/createAccount`,
    auth: 'none (returns access_token)',
    body: 'short_name, author_name',
  },
  create: {
    method: 'POST',
    url: `${TELEGRAPH_API}/createPage`,
    auth: 'access_token=<access_token> (form field)',
    body: 'TelegraphPageBody.page',
  },
  update: {
    method: 'POST',
    url: `${TELEGRAPH_API}/editPage/{path}`,
    auth: 'access_token=<access_token> (form field)',
    body: 'TelegraphPageBody.page',
  },
} as const satisfies Record<string, RequestDescription>;

export function telegraphRelayBody(r: TelegraphRendered): TelegraphPageBody {
  return r.body;
}

/** ✅ `getViews/{path}` (no token needed): the page's total views. */
export async function fetchTelegraphStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const path = isUrlExternalId(externalId)
    ? parsePostUrl('telegraph', externalId)?.externalId
    : externalId;
  if (!path) return null;
  const res = await readJson<{ ok?: boolean; result?: { views?: unknown } }>(
    ctx,
    telegraphRef(),
    `${TELEGRAPH_API}/getViews/${path}`
  );
  if (!res?.ok || !res.result) return null;
  return stats('official-api', { views: num(res.result.views) });
}

/* ---------------- adapter ---------------- */

export interface TelegraphAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop and publishes through 辰记's API (`POST /notes/{id}/publish/telegraph`). */
export function createTelegraphAdapter(
  opts: TelegraphAdapterOptions = {}
): Adapter<typeof telegraphSchema> {
  const ref = telegraphRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'telegraph',
    label: 'Telegraph',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: telegraphBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: TELEGRAPH_LIMITS.titleMax },
    schema: telegraphSchema,
    statsRequires: 'none',
    fetchStats(externalId, ctx) {
      return fetchTelegraphStats(externalId, ctx);
    },
    preview(doc, form, common, content): AdapterPreview {
      const r = renderTelegraph(doc, form, common, content, renderOpts);
      return {
        format: 'html',
        title: r.title,
        body: r.previewHtml,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous }) {
      const r = renderTelegraph(doc, form, common, content, renderOpts);
      return relayRequestOf(telegraphRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderTelegraph(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '由服务器代发到 Telegraph' });
        const res = await relayPublish(ctx, ref, telegraphRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
