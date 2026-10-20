import { MASK_MARK, maskPreviewHtml, maskReport, maskTree, resolveMask, stripMaskMarks } from './mask';
import { mobileHtml, mobileOptionsFor } from './mobile';

import type { MaskSummary } from './mask';
import type { ReportItem } from './report';
import type { ConvertOptions, Doc, TiptapJSON, TiptapMark, TocItem } from './types';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for an HTML text node or attribute value. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** URL-ish slug: keeps letters (any script), digits, `_` and `-`; everything else becomes `-`. */
export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.slice(0, max).replace(/-$/, '') || 'section';
}

/**
 * The anchor id of the `index`-th heading (0-based, every level counted): `h-<index>-<slug>`.
 * `Doc.toc` uses it; a custom `renderHtml` must give its headings the same ids.
 */
export function headingId(text: string, index: number): string {
  return `h-${index}-${slugify(text.trim())}`;
}

interface Ctx {
  headings: number;
  toc: TocItem[];
  images: string[];
  title: string;
  tocLevels: Set<number>;
  textParts: string[];
}

function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '' || value === false) return '';
  return ` ${name}="${escapeHtml(String(value))}"`;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

const VARIANT_RE = /^[a-z0-9-]{1,24}$/;

/** A styled-block look (`attrs.variant`) safe to use in a class name, or `undefined`. */
export function variantOf(value: unknown): string | undefined {
  return typeof value === 'string' && VARIANT_RE.test(value) ? value : undefined;
}

function textOf(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join('');
}

/* ------------------------------------------------------------------------ */
/* HTML                                                                     */
/* ------------------------------------------------------------------------ */

function markHtml(mark: TiptapMark, inner: string): string {
  const a = mark.attrs ?? {};
  switch (mark.type) {
    case 'bold':
      return `<strong>${inner}</strong>`;
    case 'italic':
      return `<em>${inner}</em>`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'strike':
      return `<s>${inner}</s>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'highlight': {
      const color = str(a.color);
      return color
        ? `<mark style="background-color: ${escapeHtml(color)}">${inner}</mark>`
        : `<mark>${inner}</mark>`;
    }
    case 'link': {
      const href = str(a.href) ?? '#';
      const target = str(a.target);
      const rel = target === '_blank' ? 'noopener noreferrer nofollow' : undefined;
      return `<a${attr('href', href)}${attr('target', target)}${attr('rel', rel)}${attr('title', a.title)}>${inner}</a>`;
    }
    default:
      return inner;
  }
}

function inlineHtml(nodes: TiptapJSON[] | undefined, ctx: Ctx): string {
  return (nodes ?? []).map((node) => nodeHtml(node, ctx)).join('');
}

function blocksHtml(nodes: TiptapJSON[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((node) => nodeHtml(node, ctx))
    .filter(Boolean)
    .join('\n');
}

function nodeHtml(node: TiptapJSON, ctx: Ctx): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'doc':
      return blocksHtml(node.content, ctx);
    case 'text': {
      let out = escapeHtml(node.text ?? '');
      // Marks wrap inside-out so `link` (usually first) ends up outermost.
      for (const mark of [...(node.marks ?? [])].reverse()) out = markHtml(mark, out);
      return out;
    }
    case 'paragraph': {
      const align = str(a.textAlign);
      const style = align && align !== 'left' ? ` style="text-align: ${escapeHtml(align)}"` : '';
      return `<p${style}>${inlineHtml(node.content, ctx)}</p>`;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(a.level) || 1));
      const text = textOf(node).trim();
      const id = headingId(text, ctx.headings);
      ctx.headings += 1;
      if (level === 1 && !ctx.title) ctx.title = text;
      if (ctx.tocLevels.has(level)) ctx.toc.push({ id, level, text });
      const variant = variantOf(a.variant);
      const cls = variant ? ` class="sn-h sn-h--${variant}"` : '';
      return `<h${level} id="${id}"${cls}>${inlineHtml(node.content, ctx)}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>\n${blocksHtml(node.content, ctx)}\n</ul>`;
    case 'orderedList': {
      const start = Number(a.start);
      return `<ol${start && start !== 1 ? attr('start', start) : ''}>\n${blocksHtml(node.content, ctx)}\n</ol>`;
    }
    case 'listItem':
      return `<li>${listItemHtml(node.content, ctx)}</li>`;
    case 'taskList':
      return `<ul data-type="taskList">\n${blocksHtml(node.content, ctx)}\n</ul>`;
    case 'taskItem': {
      const checked = a.checked === true;
      return `<li data-type="taskItem" data-checked="${checked}"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${listItemHtml(node.content, ctx)}</li>`;
    }
    case 'blockquote': {
      const variant = variantOf(a.variant);
      const cls = variant ? ` class="sn-quote sn-quote--${variant}"` : '';
      return `<blockquote${cls}>\n${blocksHtml(node.content, ctx)}\n</blockquote>`;
    }
    // Styled container (StyledBlocks `card`): the look is CSS, the badge a data attribute.
    case 'card': {
      const variant = variantOf(a.variant) ?? 'soft';
      return `<div class="sn-box sn-box--${variant}"${attr('data-label', str(a.label))}>\n${blocksHtml(node.content, ctx)}\n</div>`;
    }
    // SparkWrite divider: same markup as the editor so the shared stylesheet applies.
    case 'divider': {
      const variant = variantOf(a.variant) ?? 'line';
      const label = variant !== 'line' ? str(a.label) : undefined;
      const inner = label
        ? `<hr><span class="divider__label">${escapeHtml(label)}</span><hr>`
        : '<hr>';
      return `<div class="divider divider--${variant}" data-variant="${variant}" role="separator">${inner}</div>`;
    }
    case 'codeBlock': {
      const language = str(a.language);
      const code = (node.content ?? []).map((n) => escapeHtml(n.text ?? '')).join('');
      return `<pre><code${language ? attr('class', `language-${language}`) : ''}>${code}</code></pre>`;
    }
    case 'image': {
      const src = str(a.src) ?? '';
      if (src && !ctx.images.includes(src)) ctx.images.push(src);
      return `<img${attr('src', src)}${attr('alt', a.alt ?? '')}${attr('title', a.title)}${attr('width', a.width)}${attr('height', a.height)}>`;
    }
    // SparkWrite stores block-level pictures (and GIFs) as their own block nodes.
    case 'imageBlock':
    case 'imageGif': {
      const src = str(a.src) ?? '';
      if (src && !ctx.images.includes(src)) ctx.images.push(src);
      const caption = str(a.caption);
      const img = `<img${attr('src', src)}${attr('alt', a.alt ?? caption ?? '')}${attr('title', a.title)}${attr('width', a.width)}${attr('height', a.height)}>`;
      return caption
        ? `<figure>${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`
        : `<figure>${img}</figure>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'hardBreak':
      return '<br>';
    case 'table':
      return `<table>\n<tbody>\n${blocksHtml(node.content, ctx)}\n</tbody>\n</table>`;
    case 'tableRow':
      return `<tr>${inlineHtml(node.content, ctx)}</tr>`;
    case 'tableCell':
    case 'tableHeader': {
      const tag = node.type === 'tableHeader' ? 'th' : 'td';
      const colspan = Number(a.colspan);
      const rowspan = Number(a.rowspan);
      const inner = (node.content ?? []).map((n) => nodeHtml(n, ctx)).join('');
      const align = str(a.align);
      const alignAttr = align === 'center' || align === 'right' ? attr('align', align) : '';
      return `<${tag}${colspan > 1 ? attr('colspan', colspan) : ''}${rowspan > 1 ? attr('rowspan', rowspan) : ''}${alignAttr}>${inner}</${tag}>`;
    }
    case 'mermaid': {
      const src = str(a.src) ?? '';
      if (src && !ctx.images.includes(src)) ctx.images.push(src);
      return src
        ? `<figure><img${attr('src', src)}${attr('alt', a.alt ?? '')}${attr('width', a.width)}></figure>`
        : '';
    }
    case 'katex':
      return `<span class="math-inline">${escapeHtml(`$${String(a.text ?? '')}$`)}</span>`;
    case 'callout': {
      // older documents kept the callout's text as child blocks
      if (node.content?.length) return blocksHtml(node.content, ctx);
      const title = str(a.title);
      const body = str(a.body);
      return `<blockquote>${title ? `<p><strong>${escapeHtml(title)}</strong></p>` : ''}${body ? `<p>${escapeHtml(body.replace(/<[^>]+>/g, ''))}</p>` : ''}</blockquote>`;
    }
    case 'notice':
      return `<blockquote>\n${blocksHtml(node.content, ctx)}\n</blockquote>`;
    case 'details': {
      const [summary, body] = node.content ?? [];
      return `<details><summary>${inlineHtml(summary?.content, ctx)}</summary>\n${blocksHtml(body?.content, ctx)}\n</details>`;
    }
    case 'iframe': {
      const src = str(a.src);
      return src ? `<p><a${attr('href', src)}>${escapeHtml(src)}</a></p>` : '';
    }
    default:
      // Unknown node: render its children so nothing is lost and nothing throws.
      return node.content ? blocksHtml(node.content, ctx) : '';
  }
}

/** A list item's single paragraph is unwrapped; anything richer keeps its blocks. */
function listItemHtml(content: TiptapJSON[] | undefined, ctx: Ctx): string {
  const nodes = content ?? [];
  if (nodes.length === 1 && nodes[0]?.type === 'paragraph')
    return inlineHtml(nodes[0].content, ctx);
  return blocksHtml(nodes, ctx);
}

/* ------------------------------------------------------------------------ */
/* Markdown                                                                 */
/* ------------------------------------------------------------------------ */

function markMd(mark: TiptapMark, inner: string): string {
  const a = mark.attrs ?? {};
  switch (mark.type) {
    case 'bold':
      return `**${inner}**`;
    case 'italic':
      return `*${inner}*`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'strike':
      return `~~${inner}~~`;
    case 'code':
      return `\`${inner}\``;
    case 'highlight':
      return `==${inner}==`;
    // a masked word (`**`, see mask.ts): literal asterisks, not emphasis
    case MASK_MARK:
      return inner.replace(/\*/g, '\\*');
    case 'link': {
      const href = str(a.href) ?? '';
      const title = str(a.title);
      return `[${inner}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    default:
      return inner;
  }
}

function inlineMd(nodes: TiptapJSON[] | undefined): string {
  return (nodes ?? []).map((node) => nodeMd(node, 0)).join('');
}

function indent(text: string, depth: number): string {
  const pad = '  '.repeat(depth);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

function blocksMd(nodes: TiptapJSON[] | undefined, depth: number): string {
  return (nodes ?? [])
    .map((node) => nodeMd(node, depth))
    .filter((s) => s !== '')
    .join('\n\n');
}

function listMd(
  node: TiptapJSON,
  depth: number,
  bullet: (i: number, item: TiptapJSON) => string
): string {
  return (node.content ?? [])
    .map((item, i) => {
      const prefix = bullet(i, item);
      const body = listItemMd(item.content, depth + 1);
      return prefix + body.replace(/^\s+/, '');
    })
    .join('\n');
}

function listItemMd(content: TiptapJSON[] | undefined, depth: number): string {
  const nodes = content ?? [];
  const parts = nodes.map((n, i) => {
    const text = nodeMd(n, depth);
    // First paragraph sits on the bullet line; nested blocks are indented under it.
    return i === 0 && n.type === 'paragraph' ? text : indent(text, depth);
  });
  return parts.join('\n');
}

function nodeMd(node: TiptapJSON, depth: number): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'doc':
      return blocksMd(node.content, depth);
    case 'text': {
      let out = node.text ?? '';
      for (const mark of [...(node.marks ?? [])].reverse()) out = markMd(mark, out);
      return out;
    }
    case 'paragraph':
      return inlineMd(node.content);
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(a.level) || 1));
      return `${'#'.repeat(level)} ${inlineMd(node.content)}`;
    }
    case 'bulletList':
      return listMd(node, depth, () => '- ');
    case 'orderedList': {
      const start = Number(a.start) || 1;
      return listMd(node, depth, (i) => `${start + i}. `);
    }
    case 'taskList':
      return listMd(node, depth, (_, item) => (item.attrs?.checked === true ? '- [x] ' : '- [ ] '));
    case 'listItem':
    case 'taskItem':
      return listItemMd(node.content, depth);
    case 'blockquote':
      return blocksMd(node.content, depth)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'codeBlock': {
      const language = str(a.language) ?? '';
      const code = (node.content ?? []).map((n) => n.text ?? '').join('');
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'image':
    case 'imageBlock':
    case 'imageGif':
    case 'mermaid': {
      const src = str(a.src) ?? '';
      const alt = str(a.alt) ?? str(a.caption) ?? '';
      const title = str(a.title);
      const width = a.width === undefined || a.width === null ? '' : String(a.width).trim();
      const align = str(a.align);
      // A resized or aligned picture keeps its size / side as an HTML <img> (allowed in GFM).
      if ((width && /^\d+(%|px)?$/.test(width) && width !== '100%') || align === 'right') {
        const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${width ? ` width="${escapeHtml(width.replace(/px$/, ''))}"` : ''}>`;
        const block = node.type !== 'image';
        const caption = str(a.caption);
        const wrapped = block && align && align !== 'left' ? `<p align="${align}">${img}</p>` : img;
        return caption && block ? `${wrapped}\n\n*${caption}*` : wrapped;
      }
      const caption = node.type !== 'image' ? str(a.caption) : undefined;
      const md = `![${alt}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
      return caption ? `${md}\n\n*${caption}*` : md;
    }
    case 'katex':
      return `$${String(a.text ?? '')}$`;
    case 'callout': {
      if (node.content?.length) return blocksMd(node.content, depth);
      const title = str(a.title);
      const body = str(a.body)?.replace(/<[^>]+>/g, '');
      return [title ? `> **${title}**` : '', body ? `> ${body}` : ''].filter(Boolean).join('\n>\n');
    }
    case 'notice':
    case 'card':
      return blocksMd(node.content, depth)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'details': {
      const [summary, body] = node.content ?? [];
      return `<details>\n<summary>${inlineMd(summary?.content)}</summary>\n\n${blocksMd(body?.content, depth)}\n\n</details>`;
    }
    case 'iframe': {
      const src = str(a.src);
      return src ? `[${src}](${src})` : '';
    }
    case 'horizontalRule':
    case 'divider':
      return '---';
    case 'hardBreak':
      return '  \n';
    case 'table': {
      const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
      // GFM has no merged cells: such a table stays an HTML table (Markdown allows raw HTML blocks).
      const merged = rows.some((r) =>
        (r.content ?? []).some((c) => Number(c.attrs?.colspan) > 1 || Number(c.attrs?.rowspan) > 1)
      );
      if (merged) return nodeHtml(node, newCtx({}));
      const aligns = (rows[0]?.content ?? []).flatMap((c) =>
        Array.from({ length: Math.max(1, Number(c.attrs?.colspan) || 1) }, () =>
          str(c.attrs?.align)
        )
      );
      const cells = rows.map((row) =>
        (row.content ?? []).map((cell) =>
          blocksMd(cell.content, 0).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()
        )
      );
      if (!cells.length) return '';
      const width = Math.max(...cells.map((r) => r.length));
      const line = (r: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
      const [head = [], ...body] = cells;
      const sep = `| ${Array.from({ length: width }, (_, i) =>
        aligns[i] === 'center' ? ':---:' : aligns[i] === 'right' ? '---:' : '---'
      ).join(' | ')} |`;
      return [line(head), sep, ...body.map(line)].join('\n');
    }
    default:
      return node.content ? blocksMd(node.content, depth) : '';
  }
}

/* ------------------------------------------------------------------------ */
/* Plain text                                                               */
/* ------------------------------------------------------------------------ */

const INLINE_ONLY = new Set(['text', 'hardBreak', 'image']);

function collectText(node: TiptapJSON, out: string[]): void {
  if (node.type === 'text') {
    out.push(node.text ?? '');
    return;
  }
  if (node.type === 'hardBreak') {
    out.push('\n');
    return;
  }
  const children = node.content ?? [];
  const isBlock = !INLINE_ONLY.has(node.type) && node.type !== 'doc';
  for (const child of children) collectText(child, out);
  if (isBlock && children.length) out.push('\n');
}

/**
 * Turns Tiptap JSON into HTML, Markdown, plain text, a table of contents and
 * the summary fields the adapters need. Pure: the same JSON always gives the
 * same output, and unknown nodes render their children instead of throwing.
 */
function newCtx(opts: ConvertOptions): Ctx {
  return {
    headings: 0,
    toc: [],
    images: [],
    title: '',
    tocLevels: new Set(opts.tocLevels ?? [2, 3]),
    textParts: [],
  };
}

export function convert(json: TiptapJSON, opts: ConvertOptions = {}): Doc {
  const source: TiptapJSON =
    json && typeof json === 'object' ? json : { type: 'doc', content: [] };
  // 敏感词打码: every output below is built from the masked tree, so HTML, Markdown and text agree.
  const maskOpts = resolveMask(opts.mask);
  const masked = maskOpts ? maskTree(source, maskOpts) : null;
  const root = masked ? masked.json : source;
  const ctx = newCtx(opts);
  let portableHtml = nodeHtml(root, ctx);
  let html = opts.renderHtml ? opts.renderHtml(masked ? stripMaskMarks(root) : root) : portableHtml;
  if (maskOpts?.preview && masked?.hits.length) {
    // the preview marks each hit where the published copy only has `**`
    const portable = nodeHtml(source, newCtx(opts));
    portableHtml = maskPreviewHtml(portable, maskOpts);
    html = opts.renderHtml ? maskPreviewHtml(opts.renderHtml(source), maskOpts) : portableHtml;
  }
  const report: ReportItem[] = [];
  const maskSummary: MaskSummary | undefined = masked
    ? { count: masked.hits.length, hits: masked.hits }
    : undefined;
  report.push(...maskReport(maskSummary));
  if (opts.mobile) {
    const mo = opts.mobile === true ? {} : opts.mobile;
    const same = html === portableHtml;
    const a = mobileHtml(html, mo);
    html = a.html;
    portableHtml = same ? a.html : mobileHtml(portableHtml, mo).html;
    report.push(...a.report);
  }
  const markdown = nodeMd(root, 0).trim();
  const parts: string[] = [];
  collectText(root, parts);
  const text = parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const summaryLength = opts.summaryLength ?? 120;
  const summary = text.replace(/\s+/g, ' ').trim().slice(0, summaryLength);
  return {
    json: root,
    html,
    portableHtml,
    markdown,
    text,
    toc: ctx.toc,
    images: ctx.images,
    title: ctx.title,
    summary,
    ...(maskSummary ? { masked: maskSummary } : {}),
    ...(report.length ? { report } : {}),
  };
}

/**
 * `convert` the way a platform receives it: masking on (unless `opts.mask` says otherwise) and, for the registry's
 * `mobileFirst` platforms, phone-first images and tables (`mobileOptionsFor`).
 */
export function convertFor(platform: string, json: TiptapJSON, opts: ConvertOptions = {}): Doc {
  return convert(json, { ...opts, mobile: opts.mobile ?? mobileOptionsFor(platform) });
}
