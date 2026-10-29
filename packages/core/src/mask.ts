/**
 * 敏感词自动打码 as an optional step of the conversion (`convert({ mask })`, on by default). Never blocks: hits
 * become `**` in what is published; with `preview: true` the HTML shows them as `<mark class="sn-masked">`.
 * The lexicon and matching live in `@starnote/moderation`; this file only walks the document.
 */
import { maskHtml, maskText, type Hit, type MaskOptions } from '@starnote/moderation';

import { coreMessages } from './i18n/messages';

import type { SdkLang } from './i18n/lang';
import type { ReportItem } from './report';
import type { TiptapJSON } from './types';

/** `convert`'s `mask` option: `false` turns masking off; an object tunes it (whitelist, extra words…). */
export type ConvertMask =
  | boolean
  | (Omit<MaskOptions, 'preview'> & {
      /** The HTML outputs show each hit as `<mark class="sn-masked" title="已自动打码">**</mark>`. Preview only. */
      preview?: boolean;
    });

export interface MaskSummary {
  /** Number of masked places (body + whatever the caller added). */
  count: number;
  /** The hits: what was replaced (`text`) and the lexicon word, in document order. */
  hits: Array<Pick<Hit, 'text' | 'word'> & { field?: string }>;
}

/** The options to use, or `null` when masking is off. */
export function resolveMask(
  mask: ConvertMask | undefined
): (MaskOptions & { preview?: boolean }) | null {
  if (mask === false) return null;
  if (mask === true || mask === undefined) return {};
  return mask;
}

/** Text that is never masked: code is code. */
const SKIP = new Set(['codeBlock']);

/** Mark on the `**` that replaced a hit: Markdown escapes it (so it is not read as emphasis), HTML shows it as is. */
export const MASK_MARK = 'snMasked';

/**
 * The document with sensitive words in its text nodes (and image captions / alt) replaced by `**`. Each `**`
 * is a text node of its own with the `snMasked` mark (strip it with `stripMaskMarks` before handing the tree to a
 * renderer with a strict schema). Pure: returns a new tree and the hits; the input is not touched.
 */
export function maskTree(
  json: TiptapJSON,
  opts: MaskOptions = {}
): { json: TiptapJSON; hits: MaskSummary['hits'] } {
  const hits: MaskSummary['hits'] = [];
  const o: MaskOptions = { ...opts, preview: false };
  const fixed = opts.mode === 'length' ? undefined : (opts.fixed ?? '**');
  const plain = (value: string) => {
    const r = maskText(value, o);
    for (const h of r.hits) hits.push({ text: h.text, word: h.word });
    return r.text;
  };
  const splitText = (node: TiptapJSON): TiptapJSON[] => {
    const value = node.text ?? '';
    const r = maskText(value, o);
    if (!r.hits.length) return [node];
    const out: TiptapJSON[] = [];
    let at = 0;
    const marks = node.marks ?? [];
    for (const h of [...r.hits].sort((a, b) => a.index - b.index)) {
      if (h.index < at) continue;
      hits.push({ text: h.text, word: h.word });
      if (h.index > at) out.push({ ...node, text: value.slice(at, h.index) });
      const replacement = fixed ?? (opts.maskChar ?? '*').repeat(Array.from(h.text).length);
      out.push({ ...node, text: replacement, marks: [...marks, { type: MASK_MARK }] });
      at = h.index + h.text.length;
    }
    if (at < value.length) out.push({ ...node, text: value.slice(at) });
    return out;
  };
  const walk = (node: TiptapJSON): TiptapJSON[] => {
    if (SKIP.has(node.type)) return [node];
    if (node.type === 'text') return node.text ? splitText(node) : [node];
    let next = node;
    if (node.attrs) {
      let attrs: Record<string, unknown> | undefined;
      for (const k of ['caption', 'alt'] as const) {
        const v = node.attrs[k];
        if (typeof v === 'string' && v) {
          const t = plain(v);
          if (t !== v) (attrs ??= { ...node.attrs })[k] = t;
        }
      }
      if (attrs) next = { ...next, attrs };
    }
    if (node.content?.length) {
      const content = node.content.flatMap(walk);
      if (content.length !== node.content.length || content.some((c, i) => c !== node.content![i]))
        next = { ...next, content };
    }
    return [next];
  };
  return { json: walk(json)[0]!, hits };
}

/** The tree without `snMasked` marks (for renderers with a strict schema, e.g. the editor's static renderer). */
export function stripMaskMarks(json: TiptapJSON): TiptapJSON {
  const marks = json.marks?.filter((m) => m.type !== MASK_MARK);
  const next: TiptapJSON = { ...json };
  if (json.marks) {
    if (marks?.length) next.marks = marks;
    else delete next.marks;
  }
  if (json.content) {
    // the split text nodes join back when their marks match again
    const out: TiptapJSON[] = [];
    for (const child of json.content.map(stripMaskMarks)) {
      const prev = out[out.length - 1];
      if (
        prev?.type === 'text' &&
        child.type === 'text' &&
        JSON.stringify(prev.marks ?? []) === JSON.stringify(child.marks ?? [])
      )
        out[out.length - 1] = { ...prev, text: (prev.text ?? '') + (child.text ?? '') };
      else out.push(child);
    }
    next.content = out;
  }
  return next;
}

/** `maskHtml` with the preview highlight (`mark.sn-masked`): what the preview shows for the published `**`. */
export function maskPreviewHtml(html: string, opts: MaskOptions = {}): string {
  return maskHtml(html, { ...opts, preview: true }).html;
}

/** The report line 「已自动打码 N 处」 (none when nothing was masked). */
export function maskReport(
  summary: MaskSummary | undefined,
  /** SPEC-r14 B5: language of the line. Default `zh-CN`. */
  lang?: SdkLang | string
): ReportItem[] {
  if (!summary?.count) return [];
  const samples = [...new Set(summary.hits.map((h) => h.text))].slice(0, 3);
  return [
    {
      kind: 'mask.applied',
      level: 'notice',
      text: coreMessages(lang).mask.applied(summary.count),
      count: summary.count,
      samples,
    },
  ];
}

export { maskHtml, maskText };
