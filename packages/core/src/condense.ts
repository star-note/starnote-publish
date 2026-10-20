/**
 * 摘编 (CONTRACTS-r9 §3 `condensed`, mode `extract`): a free, local, extractive short version of an article.
 * Sentences are scored by term frequency (CJK bigrams + English words, stopwords removed), overlap with the
 * title and their section heading, and position (the first sentence of a section, the first paragraph); the
 * best ones are kept, in their original order, until the target length is reached. Headings stay for every
 * section that keeps a sentence; each kept section keeps at most one image; inline marks of kept text are
 * preserved. The AI rewrite (`rewrite.condense`) is a separate, paid path.
 */
import type { TiptapJSON } from './types';

export interface CondenseOptions {
  /** Article title: its words weigh more. */
  title?: string;
  /** Keep (at most one per kept section) images. Default true. */
  images?: boolean;
}

export interface CondenseResult {
  doc: TiptapJSON;
  /** `docChars(doc)` */
  chars: number;
}

/* ------------------------------------------------------------------------ */
/* counting                                                                 */
/* ------------------------------------------------------------------------ */

function textOf(node: TiptapJSON | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(textOf).join(node.type === 'paragraph' ? '' : '\n');
}

function countChars(text: string): number {
  return Array.from(text.replace(/\s+/g, '')).length;
}

/** Reading length of a document: characters of its text, whitespace not counted. */
export function docChars(json: TiptapJSON | null | undefined): number {
  return json ? countChars(textOf(json)) : 0;
}

/* ------------------------------------------------------------------------ */
/* sentences and inline slices                                              */
/* ------------------------------------------------------------------------ */

const OBJ = '￼';

/** Plain text of inline content, one character per non-text node (so offsets map back). */
function inlinePlain(content: TiptapJSON[] | undefined): string {
  return (content ?? [])
    .map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : OBJ))
    .join('');
}

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '…']);
const CLOSERS = new Set(['”', '’', '」', '』', '）', ')', '"', "'", '》', '】']);

/** `[start, end)` ranges of the sentences of a text (Chinese and English punctuation). */
export function splitSentences(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  const push = (end: number) => {
    let s = start;
    while (s < end && /\s/.test(text[s]!)) s++;
    let e = end;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) out.push([s, e]);
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    let end = -1;
    if (TERMINATORS.has(ch)) {
      end = i + 1;
      while (end < text.length && (TERMINATORS.has(text[end]!) || text[end] === '.')) end++;
    } else if (ch === '.' && (i + 1 >= text.length || /\s/.test(text[i + 1]!))) {
      end = i + 1;
    } else if (ch === '\n') {
      end = i + 1;
    }
    if (end < 0) continue;
    while (end < text.length && CLOSERS.has(text[end]!)) end++;
    push(end);
    i = end - 1;
  }
  push(text.length);
  return out;
}

/** The inline nodes covering `[start, end)` of `inlinePlain(content)`, marks kept. */
function sliceInline(content: TiptapJSON[] | undefined, start: number, end: number): TiptapJSON[] {
  const out: TiptapJSON[] = [];
  let pos = 0;
  for (const node of content ?? []) {
    const len = node.type === 'text' ? (node.text ?? '').length : 1;
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + len);
    if (b > a) {
      if (node.type === 'text') out.push({ ...node, text: node.text!.slice(a - pos, b - pos) });
      else out.push(node);
    }
    pos += len;
    if (pos >= end) break;
  }
  while (out.length && out[out.length - 1]!.type === 'hardBreak') out.pop();
  return out;
}

/* ------------------------------------------------------------------------ */
/* terms                                                                    */
/* ------------------------------------------------------------------------ */

const STOP_EN = new Set(
  'a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they them his her our your their my me us not no do does did so than then there here what which who whom how when where why can could will would should may might just also into about over more most such only very'.split(
    ' '
  )
);
const STOP_ZH = new Set(
  '的了是在我有和就不人都一一个上也很到说要去你会着没有看好自己这我们他们她们它们什么这个那个因为所以但是如果可以就是还是而且或者以及之后之前一些一种这样那样怎么为了通过对于'.match(
    /../g
  ) ?? []
);
const STOP_CHARS = new Set('的了是在和就也都很着与及或而且把被让给对从向'.split(''));

/** CJK bigrams + English words, lowercased, stopwords out. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[一-鿿]+|[A-Za-z][A-Za-z0-9+#.-]*|\d+(?:\.\d+)?%?/g)) {
    const run = m[0];
    if (/^[一-鿿]/.test(run)) {
      const chars = Array.from(run);
      for (let i = 0; i < chars.length - 1; i++) {
        const bi = chars[i]! + chars[i + 1]!;
        if (STOP_ZH.has(bi) || STOP_CHARS.has(chars[i]!) || STOP_CHARS.has(chars[i + 1]!)) continue;
        out.push(bi);
      }
    } else {
      const w = run.toLowerCase().replace(/[.-]+$/, '');
      if (w.length >= 2 && !STOP_EN.has(w) && !/^\d+$/.test(w)) out.push(w);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* condense                                                                 */
/* ------------------------------------------------------------------------ */

const IMAGE_TYPES = new Set(['image', 'imageBlock', 'imageGif']);
/** Dropped from a 摘编: they do not shorten into sentences. */
const DROP_TYPES = new Set([
  'codeBlock',
  'table',
  'divider',
  'horizontalRule',
  'details',
  'iframe',
  'mermaid',
  'tableOfContents',
  'toc',
]);

interface Unit {
  /** section index */
  sec: number;
  /** block index in the section */
  blk: number;
  /** sentence range in the paragraph (paragraph units), list item index (list units) */
  range?: [number, number];
  item?: number;
  text: string;
  chars: number;
  score: number;
  order: number;
  /** first sentence of its section */
  first?: boolean;
  /** in the article's first paragraph */
  lead?: boolean;
}

interface Section {
  heading?: TiptapJSON;
  blocks: TiptapJSON[];
}

function sections(doc: TiptapJSON): Section[] {
  const out: Section[] = [{ blocks: [] }];
  for (const node of doc.content ?? []) {
    if (node.type === 'heading') out.push({ heading: node, blocks: [] });
    else out[out.length - 1]!.blocks.push(node);
  }
  return out.filter((s) => s.heading || s.blocks.length);
}

/**
 * Keeps the most important original sentences until about `targetChars` (see the module comment).
 * A document already within the target is returned as it is.
 */
export function extractiveCondense(
  json: TiptapJSON,
  targetChars: number,
  opts: CondenseOptions = {}
): CondenseResult {
  const doc: TiptapJSON =
    json && json.type === 'doc' ? json : { type: 'doc', content: json ? [json] : [] };
  const total = docChars(doc);
  if (total <= targetChars) return { doc, chars: total };

  const secs = sections(doc);
  const units: Unit[] = [];
  let order = 0;
  let firstParagraph = true;
  secs.forEach((sec, si) => {
    let firstInSection = true;
    sec.blocks.forEach((block, bi) => {
      if (block.type === 'paragraph') {
        const plain = inlinePlain(block.content);
        const ranges = splitSentences(plain);
        ranges.forEach((range, ri) => {
          const text = plain.slice(range[0], range[1]);
          const chars = countChars(text.replace(new RegExp(OBJ, 'g'), ''));
          if (!chars) return;
          units.push({
            sec: si,
            blk: bi,
            range,
            text,
            chars,
            score: 0,
            order: order++,
            ...(firstInSection && ri === 0 ? { first: true } : {}),
            ...(firstParagraph ? { lead: true } : {}),
          });
        });
        if (ranges.length) {
          firstInSection = false;
          firstParagraph = false;
        }
      } else if (
        block.type === 'bulletList' ||
        block.type === 'orderedList' ||
        block.type === 'taskList'
      ) {
        (block.content ?? []).forEach((item, ii) => {
          const text = textOf(item);
          const chars = countChars(text);
          if (chars)
            units.push({ sec: si, blk: bi, item: ii, text, chars, score: 0, order: order++ });
        });
        firstInSection = false;
      } else if (!IMAGE_TYPES.has(block.type) && !DROP_TYPES.has(block.type)) {
        const text = textOf(block);
        const chars = countChars(text);
        if (chars) units.push({ sec: si, blk: bi, text, chars, score: 0, order: order++ });
        firstInSection = false;
      }
    });
  });
  if (!units.length) return { doc, chars: total };

  // term frequency over the article
  const tf = new Map<string, number>();
  const unitTerms = units.map((u) => {
    const t = terms(u.text);
    for (const term of t) tf.set(term, (tf.get(term) ?? 0) + 1);
    return new Set(t);
  });
  const maxTf = Math.max(1, ...tf.values());
  const titleTerms = new Set(terms(opts.title ?? ''));
  const headingTerms = secs.map((s) => new Set(terms(textOf(s.heading))));

  units.forEach((u, i) => {
    const set = unitTerms[i]!;
    let base = 0;
    for (const term of set) base += (tf.get(term) ?? 0) / maxTf;
    base = set.size ? base / Math.pow(set.size, 0.6) : 0;
    const overlap = (ref: Set<string>) => {
      if (!ref.size) return 0;
      let hit = 0;
      for (const term of ref) if (set.has(term)) hit++;
      return hit / ref.size;
    };
    let score = base + 0.6 * overlap(titleTerms) + 0.3 * overlap(headingTerms[u.sec]!);
    if (u.first) score += 0.35;
    if (u.lead) score += 0.6;
    if (u.chars < 8) score *= 0.5;
    else if (u.chars > 160) score *= 0.75;
    u.score = score;
  });

  // greedy by score within the budget; a section's heading costs its characters once
  const headingChars = secs.map((s) => countChars(textOf(s.heading)));
  const opened = new Set<number>();
  const kept = new Set<number>();
  let used = 0;
  const hi = targetChars * 1.08;
  const lo = targetChars * 0.92;
  const byScore = [...units].sort((a, b) => b.score - a.score || a.order - b.order);
  for (const u of byScore) {
    if (used >= lo) break;
    const cost = u.chars + (opened.has(u.sec) ? 0 : headingChars[u.sec]!);
    if (used + cost > hi && kept.size) continue;
    kept.add(u.order);
    opened.add(u.sec);
    used += cost;
  }

  // rebuild in document order
  const keptUnits = units.filter((u) => kept.has(u.order));
  const content: TiptapJSON[] = [];
  const withImages = opts.images !== false;
  secs.forEach((sec, si) => {
    if (!opened.has(si)) return;
    if (sec.heading) content.push(sec.heading);
    const mine = keptUnits.filter((u) => u.sec === si);
    let imageDone = !withImages;
    sec.blocks.forEach((block, bi) => {
      if (IMAGE_TYPES.has(block.type)) {
        if (!imageDone) content.push(block);
        imageDone = true;
        return;
      }
      const here = mine.filter((u) => u.blk === bi);
      if (!here.length) return;
      if (block.type === 'paragraph') {
        if (here.length === units.filter((u) => u.sec === si && u.blk === bi).length) {
          content.push(block);
          return;
        }
        const inline: TiptapJSON[] = [];
        let prevEnd = -1;
        for (const u of here) {
          const [a, b] = u.range!;
          const latin = /[A-Za-z0-9.,;:!?)]$/.test(inlinePlain(inline));
          if (inline.length && a !== prevEnd && latin) inline.push({ type: 'text', text: ' ' });
          inline.push(...sliceInline(block.content, a, b));
          prevEnd = b;
        }
        content.push({ ...block, content: inline });
      } else if (here[0]!.item !== undefined) {
        const items = new Set(here.map((u) => u.item));
        content.push({ ...block, content: (block.content ?? []).filter((_, i) => items.has(i)) });
      } else {
        content.push(block);
      }
    });
  });
  const out: TiptapJSON = { ...doc, content };
  return { doc: out, chars: docChars(out) };
}
