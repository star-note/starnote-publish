/**
 * Tiptap JSON (already degraded by `degradeJson`, target html) → Tumblr NPF content blocks (✅
 * tumblr.com/docs/npf): `text` (subtypes heading1 / heading2 / indented / chat / ordered-list-item /
 * unordered-list-item, `indent_level`, inline `formatting`), `image` and `link`.
 *
 * | Tiptap                     | NPF                                                        |
 * | -------------------------- | ---------------------------------------------------------- |
 * | heading 2 / 3+             | text `heading1` / `heading2`                               |
 * | paragraph                  | text (hard breaks split it into blocks)                    |
 * | blockquote                 | text `indented`                                            |
 * | bullet / ordered / task    | text `unordered-list-item` / `ordered-list-item` + indent  |
 * | codeBlock                  | text `chat` (monospace), one block per line                |
 * | table                      | one text block per row, cells joined with ` | `            |
 * | image / imageBlock         | image `{ media: [{ url }], alt_text, caption }`            |
 * | horizontalRule             | dropped (NPF has no divider)                               |
 * | bold / italic / strike / link | formatting `bold` / `italic` / `strikethrough` / `link` |
 *
 * ⚠️ 待核实：formatting 的 start / end 按 JavaScript 字符串下标（UTF-16 码元）计算；NPF 文档写的是 character index，
 * 遇到 emoji 等补充平面字符时可能差一位。
 */
import type { TiptapJSON } from '@starnote/publish-core';

export type NpfTextSubtype =
  | 'heading1'
  | 'heading2'
  | 'quirky'
  | 'quote'
  | 'indented'
  | 'chat'
  | 'ordered-list-item'
  | 'unordered-list-item';

export interface NpfFormatting {
  start: number;
  end: number;
  type: 'bold' | 'italic' | 'strikethrough' | 'small' | 'link';
  url?: string;
}

export interface NpfTextBlock {
  type: 'text';
  text: string;
  subtype?: NpfTextSubtype;
  indent_level?: number;
  formatting?: NpfFormatting[];
}

export interface NpfImageBlock {
  type: 'image';
  /** As rendered: the 辰记 image URL. The sender uploads it (multipart `identifier`) before posting. */
  media: Array<{ url: string; width?: number; height?: number }>;
  alt_text?: string;
  caption?: string;
}

export interface NpfLinkBlock {
  type: 'link';
  url: string;
  title?: string;
  description?: string;
}

export type NpfBlock = NpfTextBlock | NpfImageBlock | NpfLinkBlock;

export interface NpfCounts {
  divider: number;
  table: number;
  code: number;
  image: number;
  imageSkipped: number;
}

interface Run {
  text: string;
  marks: TiptapJSON['marks'];
}

const MARK_TYPES: Record<string, NpfFormatting['type']> = {
  bold: 'bold',
  strong: 'bold',
  italic: 'italic',
  em: 'italic',
  strike: 'strikethrough',
  strikethrough: 'strikethrough',
};

/** Inline runs of a block, split at hard breaks. */
function lines(node: TiptapJSON): Run[][] {
  const out: Run[][] = [[]];
  const walk = (n: TiptapJSON, inherited: TiptapJSON['marks'] = []) => {
    if (n.type === 'text') {
      out[out.length - 1]!.push({
        text: n.text ?? '',
        marks: [...(inherited ?? []), ...(n.marks ?? [])],
      });
      return;
    }
    if (n.type === 'hardBreak') {
      out.push([]);
      return;
    }
    if (n.type === 'katex' || n.type === 'mathInline') {
      out[out.length - 1]!.push({
        text: String(n.attrs?.text ?? n.attrs?.latex ?? ''),
        marks: inherited,
      });
      return;
    }
    for (const c of n.content ?? []) walk(c, n.marks ?? inherited);
  };
  for (const c of node.content ?? []) walk(c);
  return out;
}

function textBlock(
  runs: Run[],
  extra: { subtype?: NpfTextSubtype; indent_level?: number } = {}
): NpfTextBlock | null {
  let text = '';
  const formatting: NpfFormatting[] = [];
  for (const r of runs) {
    const start = text.length;
    text += r.text;
    const end = text.length;
    if (end === start) continue;
    for (const m of r.marks ?? []) {
      if (m.type === 'link') {
        const href = String(m.attrs?.href ?? '');
        if (/^https?:\/\//i.test(href)) formatting.push({ start, end, type: 'link', url: href });
        continue;
      }
      const t = MARK_TYPES[m.type];
      if (t) formatting.push({ start, end, type: t });
    }
  }
  if (!text.trim()) return null;
  // merge adjacent ranges of the same kind (and url)
  const merged: NpfFormatting[] = [];
  for (const f of formatting.sort((a, b) => a.start - b.start || a.type.localeCompare(b.type))) {
    const prev = merged.find((p) => p.type === f.type && p.url === f.url && p.end === f.start);
    if (prev) prev.end = f.end;
    else merged.push({ ...f });
  }
  return {
    type: 'text',
    text,
    ...(extra.subtype ? { subtype: extra.subtype } : {}),
    ...(extra.indent_level ? { indent_level: extra.indent_level } : {}),
    ...(merged.length ? { formatting: merged } : {}),
  };
}

function plain(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plain).join(node.type === 'paragraph' ? '' : ' ');
}

/** Converts a degraded document. `image` decides whether an image URL can be used (absolute http(s) only). */
export function toNpf(json: TiptapJSON): { blocks: NpfBlock[]; counts: NpfCounts } {
  const blocks: NpfBlock[] = [];
  const counts: NpfCounts = { divider: 0, table: 0, code: 0, image: 0, imageSkipped: 0 };
  const push = (b: NpfBlock | null) => {
    if (b) blocks.push(b);
  };

  const image = (n: TiptapJSON) => {
    const src = String(n.attrs?.src ?? '');
    if (!/^https?:\/\//i.test(src)) {
      counts.imageSkipped += 1;
      return;
    }
    counts.image += 1;
    const width = Number(n.attrs?.width);
    const alt = String(n.attrs?.alt ?? '').trim();
    const caption = String(n.attrs?.caption ?? n.attrs?.title ?? '').trim();
    blocks.push({
      type: 'image',
      media: [{ url: src, ...(Number.isFinite(width) && width > 0 ? { width } : {}) }],
      ...(alt ? { alt_text: alt.slice(0, 4096) } : {}),
      ...(caption ? { caption: caption.slice(0, 4096) } : {}),
    });
  };

  const list = (n: TiptapJSON, depth: number) => {
    const subtype: NpfTextSubtype =
      n.type === 'orderedList' ? 'ordered-list-item' : 'unordered-list-item';
    for (const item of n.content ?? []) {
      for (const c of item.content ?? []) {
        if (c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList') {
          list(c, depth + 1);
        } else if (c.type === 'paragraph') {
          for (const runs of lines(c))
            push(
              textBlock(runs, { subtype, ...(depth ? { indent_level: Math.min(depth, 7) } : {}) })
            );
        } else block(c, depth);
      }
    }
  };

  const block = (n: TiptapJSON, depth = 0) => {
    switch (n.type) {
      case 'heading': {
        const level = Number(n.attrs?.level ?? 2);
        for (const runs of lines(n))
          push(textBlock(runs, { subtype: level <= 2 ? 'heading1' : 'heading2' }));
        return;
      }
      case 'paragraph':
        for (const runs of lines(n)) push(textBlock(runs));
        // inline images become image blocks after the text
        for (const c of n.content ?? []) if (c.type === 'image') image(c);
        return;
      case 'blockquote':
        for (const c of n.content ?? []) {
          if (c.type === 'paragraph')
            for (const runs of lines(c)) push(textBlock(runs, { subtype: 'indented' }));
          else block(c, depth);
        }
        return;
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        list(n, depth);
        return;
      case 'codeBlock': {
        counts.code += 1;
        for (const line of plain(n).split('\n'))
          push({ type: 'text', text: line || ' ', subtype: 'chat' });
        return;
      }
      case 'table': {
        counts.table += 1;
        for (const row of n.content ?? []) {
          const cells = (row.content ?? []).map((c) => plain(c).trim());
          const header = (row.content ?? []).some((c) => c.type === 'tableHeader');
          const text = cells.join(' | ');
          if (text.trim())
            push({
              type: 'text',
              text,
              ...(header
                ? { formatting: [{ start: 0, end: text.length, type: 'bold' as const }] }
                : {}),
            });
        }
        return;
      }
      case 'image':
      case 'imageBlock':
        image(n);
        return;
      case 'horizontalRule':
        counts.divider += 1;
        return;
      default:
        for (const c of n.content ?? []) block(c, depth);
    }
  };

  for (const c of json.content ?? []) block(c);
  return { blocks, counts };
}
