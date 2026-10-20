/**
 * Composable render steps (SPEC-r8 §3.0, §12.5) that work on the Tiptap tree before `convert`, so every
 * platform gets the same HTML / Markdown serializer and only declares how our blocks degrade:
 * decorated headings → plain h2 / h3, callouts → quote with 「提示」, dividers → `<hr>`, math → platform
 * image or `$…$`, task lists → ☐ / ☑, folds flattened, videos → links. Each step is counted for `report`.
 */
import type { ReportItem } from './report';
import type { TiptapJSON } from './types';

export interface DegradeOptions {
  /** Clamp heading levels (知乎 / 掘金 / CSDN: 2…3). Variants are always dropped. */
  headings?: { min: number; max: number };
  /** Drop a leading h1 whose text equals the title (the platform shows the title itself). */
  dropTitleHeading?: string;
  /** Callout / card / notice → blockquote whose first line is the label (default 「提示」). */
  callouts?: { label?: string; style: 'html' | 'markdown' };
  /** `source` keeps `$…$`; `image` replaces it with an image of the formula. */
  math?: { mode: 'source' } | { mode: 'image'; url: (tex: string) => string };
  /** `symbols`: ☐ / ☑ text bullets (platforms without task lists). */
  taskList?: 'keep' | 'symbols';
  /** `<details>` → summary in bold + body. */
  flattenDetails?: boolean;
  /** Embedded videos → a link line (`label` + URL). */
  videoLabel?: string;
}

export interface DegradeResult {
  json: TiptapJSON;
  report: ReportItem[];
  counts: Record<
    'headings' | 'callouts' | 'dividers' | 'math' | 'tasks' | 'details' | 'videos' | 'mergedTables',
    number
  >;
}

function textOf(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

const text = (t: string, bold = false): TiptapJSON => ({
  type: 'text',
  text: t,
  ...(bold ? { marks: [{ type: 'bold' }] } : {}),
});

function hasMergedCells(table: TiptapJSON): boolean {
  return (table.content ?? []).some((row) =>
    (row.content ?? []).some((c) => Number(c.attrs?.colspan) > 1 || Number(c.attrs?.rowspan) > 1)
  );
}

/** Pure: returns a new tree; the input is not modified. */
export function degradeTree(json: TiptapJSON, opts: DegradeOptions): DegradeResult {
  const counts: DegradeResult['counts'] = {
    headings: 0,
    callouts: 0,
    dividers: 0,
    math: 0,
    tasks: 0,
    details: 0,
    videos: 0,
    mergedTables: 0,
  };
  let titleDropped = false;

  const visit = (node: TiptapJSON, index: number, parent: TiptapJSON | null): TiptapJSON[] => {
    const a = node.attrs ?? {};
    switch (node.type) {
      case 'heading': {
        const level = Number(a.level) || 1;
        if (
          !titleDropped &&
          opts.dropTitleHeading !== undefined &&
          parent?.type === 'doc' &&
          index === firstBlockIndex(parent) &&
          level === 1 &&
          textOf(node).trim() === opts.dropTitleHeading.trim()
        ) {
          titleDropped = true;
          return [];
        }
        let next = level;
        if (opts.headings) next = Math.min(opts.headings.max, Math.max(opts.headings.min, level));
        const decorated = a.variant !== undefined && a.variant !== null && a.variant !== '';
        if (next !== level || decorated) counts.headings++;
        const rest = { ...a };
        delete rest.variant;
        return [{ ...node, attrs: { ...rest, level: next }, content: mapChildren(node) }];
      }
      case 'card':
      case 'notice':
      case 'callout': {
        if (!opts.callouts) return [{ ...node, content: mapChildren(node) }];
        counts.callouts++;
        const label =
          (typeof a.label === 'string' && a.label.trim()) || opts.callouts.label || '提示';
        const children = node.content?.length
          ? mapChildren(node)
          : [
              ...(typeof a.title === 'string' && a.title
                ? [{ type: 'paragraph', content: [text(a.title, true)] }]
                : []),
              ...(typeof a.body === 'string' && a.body
                ? [{ type: 'paragraph', content: [text(a.body.replace(/<[^>]+>/g, ''))] }]
                : []),
            ];
        const head: TiptapJSON = {
          type: 'paragraph',
          content: [text(opts.callouts.style === 'markdown' ? label : `${label}：`, true)],
        };
        return [{ type: 'blockquote', content: [head, ...children] }];
      }
      case 'divider': {
        if (a.variant && a.variant !== 'line') counts.dividers++;
        return [{ type: 'horizontalRule' }];
      }
      case 'katex': {
        if (!opts.math) return [node];
        counts.math++;
        const tex = String(a.text ?? '');
        if (opts.math.mode === 'source') return [node];
        return [{ type: 'image', attrs: { src: opts.math.url(tex), alt: tex } }];
      }
      case 'taskList': {
        if (opts.taskList !== 'symbols') return [{ ...node, content: mapChildren(node) }];
        counts.tasks++;
        return [
          {
            type: 'bulletList',
            content: (node.content ?? []).map((item) => {
              const checked = item.attrs?.checked === true;
              const [first, ...rest] = (item.content ?? []).flatMap((c, i) => visit(c, i, item));
              const mark = text(checked ? '☑ ' : '☐ ');
              const lead: TiptapJSON =
                first?.type === 'paragraph'
                  ? { ...first, content: [mark, ...(first.content ?? [])] }
                  : { type: 'paragraph', content: [mark] };
              return {
                type: 'listItem',
                content:
                  first?.type === 'paragraph'
                    ? [lead, ...rest]
                    : [lead, ...(first ? [first] : []), ...rest],
              };
            }),
          },
        ];
      }
      case 'details': {
        if (!opts.flattenDetails) return [{ ...node, content: mapChildren(node) }];
        counts.details++;
        const [summary, body] = node.content ?? [];
        return [
          { type: 'paragraph', content: [text(textOf(summary ?? { type: 'text' }), true)] },
          ...(body?.content ?? []).flatMap((c, i) => visit(c, i, body ?? null)),
        ];
      }
      case 'iframe': {
        const src = typeof a.src === 'string' ? a.src : '';
        if (!src) return [];
        counts.videos++;
        return [
          {
            type: 'paragraph',
            content: [
              text(`${opts.videoLabel ?? '视频'}：`),
              { type: 'text', text: src, marks: [{ type: 'link', attrs: { href: src } }] },
            ],
          },
        ];
      }
      case 'table': {
        if (hasMergedCells(node)) counts.mergedTables++;
        return [{ ...node, content: mapChildren(node) }];
      }
      default:
        return node.content ? [{ ...node, content: mapChildren(node) }] : [node];
    }
  };
  const mapChildren = (node: TiptapJSON): TiptapJSON[] =>
    (node.content ?? []).flatMap((c, i) => visit(c, i, node));

  const root = json && typeof json === 'object' ? json : { type: 'doc', content: [] };
  const out = visit(root, 0, null)[0] ?? { type: 'doc', content: [] };
  return { json: out, report: degradeReport(counts, opts), counts };
}

function firstBlockIndex(parent: TiptapJSON): number {
  const i = (parent.content ?? []).findIndex(
    (n) => !(n.type === 'paragraph' && !(n.content ?? []).length)
  );
  return i < 0 ? 0 : i;
}

function degradeReport(c: DegradeResult['counts'], opts: DegradeOptions): ReportItem[] {
  const items: ReportItem[] = [];
  const blocks: string[] = [];
  if (c.headings) blocks.push(`${c.headings} 个标题改成普通二、三级标题`);
  if (c.callouts) blocks.push(`${c.callouts} 个提示框改成引用块`);
  if (c.dividers) blocks.push(`${c.dividers} 条装饰分割线改成普通分割线`);
  if (c.tasks) blocks.push(`${c.tasks} 个任务列表改成 ☐ / ☑ 列表`);
  if (c.details) blocks.push(`${c.details} 个折叠块已展开`);
  if (blocks.length)
    items.push({
      kind: 'block.degraded',
      text: blocks.join('，'),
      count: c.headings + c.callouts + c.dividers + c.tasks + c.details,
      level: 'info',
    });
  if (c.math && opts.math)
    items.push(
      opts.math.mode === 'image'
        ? {
            kind: 'math.rasterized',
            text: `${c.math} 个公式改成平台的公式图片`,
            count: c.math,
            level: 'info',
          }
        : {
            kind: 'math.as-source',
            text: `${c.math} 个公式保留为 $…$ 写法，以平台实际显示为准`,
            count: c.math,
            level: 'notice',
          }
    );
  if (c.videos)
    items.push({
      kind: 'video.linkified',
      text: `${c.videos} 个视频改成链接`,
      count: c.videos,
      level: 'notice',
    });
  if (c.mergedTables)
    items.push({
      kind: 'table.merged-kept',
      text: `${c.mergedTables} 个表格有合并单元格，暂时不能转成图片，已按表格保留，显示可能错位`,
      count: c.mergedTables,
      level: 'warn',
    });
  return items;
}

/** Pure: replaces image `src`s (image, imageBlock, imageGif, mermaid) by the map; others are kept. */
export function rewriteImageSrcs(json: TiptapJSON, map: ReadonlyMap<string, string>): TiptapJSON {
  const IMAGE = new Set(['image', 'imageBlock', 'imageGif', 'mermaid']);
  const walk = (node: TiptapJSON): TiptapJSON => {
    const src = node.attrs?.src;
    const next: TiptapJSON =
      IMAGE.has(node.type) && typeof src === 'string' && map.has(src)
        ? { ...node, attrs: { ...node.attrs, src: map.get(src)! } }
        : node;
    return next.content ? { ...next, content: next.content.map(walk) } : next;
  };
  return walk(json);
}

/** Cuts `text` to `max` characters (code points), reporting what happened. */
export function truncateText(value: string, max: number): { value: string; truncated: boolean } {
  const chars = [...value];
  if (chars.length <= max) return { value, truncated: false };
  return { value: chars.slice(0, Math.max(0, max - 1)).join('') + '…', truncated: true };
}
