/**
 * @starnote/moderation — 敏感词自动打码。浏览器安全，零运行时依赖。
 *
 * 不是审核关卡：没有「不通过」，只把命中词替换成 `**`（或等长 `*`），并可在预览里用
 * `<mark class="sn-masked">` 高亮。词库来自 konsheng/Sensitive-lexicon（MIT），见 SOURCES.md。
 *
 * 匹配：前缀树 + 最左最长匹配；可选归一化（全角→半角、大小写、词中夹杂的空格 / 符号）。
 * 纯 ASCII 词要求两侧是词边界，避免 `anal` 命中 `analysis`。
 */
import { CATEGORY_DATA } from './words.generated';

export type CategoryId =
  'insult' | 'porn' | 'violence' | 'politics' | 'corruption' | 'other' | 'ad' | 'livelihood';

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  /** Enabled when `categories` is not given. */
  default: boolean;
  size: number;
}

/** Built-in categories (`ad` / `livelihood` are off by default: too many everyday words). */
export const CATEGORIES: readonly CategoryInfo[] = CATEGORY_DATA.map((c) => ({
  id: c.id as CategoryId,
  label: c.label,
  default: c.default,
  size: c.words ? c.words.split('\n').length : 0,
}));

/** Words of one built-in category (normalized: NFKC + lower-case). */
export function builtinWords(category: CategoryId): string[] {
  const c = CATEGORY_DATA.find((x) => x.id === category);
  return c && c.words ? c.words.split('\n') : [];
}

export interface NormalizeOptions {
  /** 全角→半角（及其他 NFKC 兼容字符）。默认 true。 */
  width?: boolean;
  /** 忽略大小写。默认 true。 */
  case?: boolean;
  /** 忽略词中夹杂的空格 / 标点 / 符号 / 零宽字符（如「敏 感-词」）。默认 true。 */
  symbols?: boolean;
  /** 词中最多连续跳过几个符号。默认 3。 */
  maxSkip?: number;
}

export interface DictionaryOptions {
  /** 启用的内置分类；`'all'` 为全部；默认 `default: true` 的分类。 */
  categories?: CategoryId[] | 'all';
  /** 完全替换内置词库（传 `[]` 即空词库，只用 `extraWords`）。 */
  words?: string[];
  /** 额外的词；可写成 `{ word, category }`。 */
  extraWords?: Array<string | { word: string; category?: string }>;
  /** 白名单：这些词（及包含它们的位置）不打码。 */
  whitelist?: string[];
  /** 归一化开关；`false` 关闭全部。 */
  normalize?: boolean | NormalizeOptions;
}

export interface RenderOptions {
  /** `'fixed'`：每个命中替换为 `fixed`（默认 `**`）；`'length'`：替换为等长的 `maskChar`。默认 `'fixed'`。 */
  mode?: 'fixed' | 'length';
  fixed?: string;
  maskChar?: string;
  /** 预览：输出 `<mark class="sn-masked" title="已自动打码">**</mark>`。正式发布不要开。 */
  preview?: boolean;
}

export type MaskOptions = DictionaryOptions & RenderOptions;

export interface Hit {
  /** 词库里的词（归一化后）。 */
  word: string;
  /** 原文中被替换的片段。 */
  text: string;
  /** 在输入字符串（maskHtml 为原 HTML）中的 UTF-16 下标。 */
  index: number;
  category?: string;
}

export interface MaskTextResult {
  text: string;
  hits: Hit[];
}

export interface MaskHtmlResult {
  html: string;
  hits: Hit[];
}

/* ---------------- normalization ---------------- */

interface Norm {
  width: boolean;
  case: boolean;
  symbols: boolean;
  maxSkip: number;
}

function resolveNorm(n: DictionaryOptions['normalize']): Norm {
  if (n === false) return { width: false, case: false, symbols: false, maxSkip: 0 };
  const o = n === true || n === undefined ? {} : n;
  return {
    width: o.width ?? true,
    case: o.case ?? true,
    symbols: o.symbols ?? true,
    maxSkip: o.maxSkip ?? 3,
  };
}

const ZERO_WIDTH = /[\u200b-\u200f\u2060-\u2064\ufeff\u00ad]/;
/**
 * Characters bridged inside a word when `symbols` is on: spaces (not line breaks), zero-width chars and
 * the symbols people insert to dodge filters. Structural punctuation (、，。；：| ` brackets, line breaks)
 * is never bridged, so 「红色、区块」 or a Markdown table cell does not form a word.
 */
const SKIPPABLE =
  /[ \t\u00a0\u3000\u200b-\u200f\u2060-\u2064\ufeff\u00ad*\-_.·•~/\\+=#@^&%$'"\u2018\u2019\u201c\u201d]/;

function normChar(c: string, n: Norm): string {
  let r = c;
  if (n.width) {
    const code = c.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) r = String.fromCharCode(code - 0xfee0);
    else if (code === 0x3000) r = ' ';
    else if (code > 0x7f && !(code >= 0x4e00 && code <= 0x9fff)) {
      const k = c.normalize('NFKC');
      if (k.length === 1) r = k;
    }
  }
  if (n.case) r = r.toLowerCase();
  return r;
}

const isSkippable = (c: string, n: Norm) => (n.symbols ? SKIPPABLE.test(c) : ZERO_WIDTH.test(c));
const isAsciiWordChar = (c: string | undefined) => !!c && /^[a-z0-9]$/i.test(c);

/* ---------------- trie ---------------- */

interface Node {
  next: Map<string, Node>;
  /** Terminal: dictionary word. */
  word?: string;
  category?: string;
  /** The word starts / ends with an ASCII letter or digit: needs a word boundary on that side. */
  edgeStart?: boolean;
  edgeEnd?: boolean;
  /** Terminal: whitelist entry. */
  allow?: boolean;
}

const newNode = (): Node => ({ next: new Map() });

function normWord(w: string, n: Norm): string {
  let out = '';
  for (const c of w.trim()) {
    if (isSkippable(c, n)) continue;
    out += normChar(c, n);
  }
  return out;
}

function insert(root: Node, w: string, set: (node: Node) => void): void {
  if (!w) return;
  let node = root;
  for (const c of w) {
    let nx = node.next.get(c);
    if (!nx) node.next.set(c, (nx = newNode()));
    node = nx;
  }
  set(node);
}

export interface Masker {
  maskText(text: string, opts?: RenderOptions): MaskTextResult;
  maskHtml(html: string, opts?: RenderOptions): MaskHtmlResult;
  /** Dictionary size (after whitelist). */
  readonly size: number;
}

/** Builds a reusable masker (the trie is built once). `maskText` / `maskHtml` cache maskers by options. */
export function createMasker(opts: DictionaryOptions & RenderOptions = {}): Masker {
  const n = resolveNorm(opts.normalize);
  const root = newNode();
  const white = new Set((opts.whitelist ?? []).map((w) => normWord(w, n)).filter(Boolean));
  let size = 0;
  const add = (raw: string, category?: string) => {
    const w = normWord(raw, n);
    if (!w || white.has(w)) return;
    const cps = Array.from(w);
    const edgeStart = isAsciiWordChar(cps[0]);
    const edgeEnd = isAsciiWordChar(cps[cps.length - 1]);
    insert(root, w, (node) => {
      if (!node.word) size++;
      node.word = w;
      node.edgeStart = edgeStart;
      node.edgeEnd = edgeEnd;
      if (category) node.category = category;
      else delete node.category;
    });
  };

  if (opts.words) for (const w of opts.words) add(w);
  else {
    const cats =
      opts.categories === 'all'
        ? CATEGORY_DATA.map((c) => c.id)
        : (opts.categories ?? CATEGORY_DATA.filter((c) => c.default).map((c) => c.id));
    for (const c of CATEGORY_DATA) {
      if (!cats.includes(c.id as CategoryId) || !c.words) continue;
      for (const w of c.words.split('\n')) add(w, c.id);
    }
  }
  for (const e of opts.extraWords ?? []) {
    if (typeof e === 'string') add(e, 'custom');
    else add(e.word, e.category ?? 'custom');
  }
  for (const w of white) insert(root, w, (node) => (node.allow = true));

  const baseRender: RenderOptions = {
    mode: opts.mode,
    fixed: opts.fixed,
    maskChar: opts.maskChar,
    preview: opts.preview,
  };

  /**
   * Scans `chars` (one entry per code point, already split) and returns spans [start, end) in
   * code-point indices. Leftmost-longest; whitelist spans are consumed without a hit.
   */
  function scan(chars: string[]): Array<{ start: number; end: number; node: Node }> {
    const out: Array<{ start: number; end: number; node: Node }> = [];
    const len = chars.length;
    const normed: string[] = new Array(len);
    const skip: boolean[] = new Array(len);
    for (let i = 0; i < len; i++) {
      normed[i] = normChar(chars[i]!, n);
      skip[i] = isSkippable(chars[i]!, n);
    }
    let i = 0;
    while (i < len) {
      if (skip[i] || !root.next.has(normed[i]!)) {
        i++;
        continue;
      }
      let node: Node | undefined = root;
      let j = i;
      let skipped = 0;
      let best: { end: number; node: Node } | null = null;
      let prev = '';
      while (j < len && node) {
        if (skip[j]) {
          if (j === i || ++skipped > n.maxSkip) break;
          j++;
          continue;
        }
        // Never bridge between ASCII and CJK (「SVG 点」 is ordinary mixed-script spacing).
        if (skipped > 0 && isAsciiWordChar(prev) !== isAsciiWordChar(normed[j])) break;
        skipped = 0;
        prev = normed[j]!;
        node = node.next.get(normed[j]!);
        if (!node) break;
        j++;
        if (node.word || node.allow) {
          if (node.allow) best = { end: j, node };
          else if (
            (!node.edgeStart || !isAsciiWordChar(normed[i - 1])) &&
            (!node.edgeEnd || !isAsciiWordChar(normed[j]))
          )
            best = { end: j, node };
        }
      }
      if (best) {
        if (!best.node.allow) out.push({ start: i, end: best.end, node: best.node });
        i = best.end;
      } else i++;
    }
    return out;
  }

  function replacement(r: RenderOptions, original: string): string {
    const mode = r.mode ?? 'fixed';
    const body =
      mode === 'length'
        ? (r.maskChar ?? '*').repeat(Math.max(1, Array.from(original).length))
        : (r.fixed ?? '**');
    return r.preview
      ? `<mark class="sn-masked" title="已自动打码">${escapeHtml(body)}</mark>`
      : body;
  }

  /** Masks a decoded string; `offsets[k]` is the source index of code point k (plus one past the end). */
  function maskDecoded(
    chars: string[],
    r: RenderOptions,
    emit: (from: number, to: number) => string,
    replaceSpan: (from: number, to: number, rep: string) => string,
    hits: Hit[],
    sourceIndex: (k: number) => number
  ): string {
    const spans = scan(chars);
    if (!spans.length) return emit(0, chars.length);
    let out = '';
    let pos = 0;
    for (const s of spans) {
      out += emit(pos, s.start);
      const original = chars.slice(s.start, s.end).join('');
      out += replaceSpan(s.start, s.end, replacement(r, original));
      hits.push({
        word: s.node.word!,
        text: original,
        index: sourceIndex(s.start),
        ...(s.node.category ? { category: s.node.category } : {}),
      });
      pos = s.end;
    }
    return out + emit(pos, chars.length);
  }

  return {
    size,
    maskText(text, o) {
      const r = { ...baseRender, ...o };
      const chars = Array.from(text);
      const idx: number[] = new Array(chars.length + 1);
      let u = 0;
      for (let k = 0; k < chars.length; k++) {
        idx[k] = u;
        u += chars[k]!.length;
      }
      idx[chars.length] = u;
      const hits: Hit[] = [];
      const plain = (a: number, b: number) => chars.slice(a, b).join('');
      const out = maskDecoded(
        chars,
        r,
        r.preview ? (a, b) => escapeHtml(plain(a, b)) : plain,
        (_a, _b, rep) => rep,
        hits,
        (k) => idx[k]!
      );
      return { text: out, hits };
    },
    maskHtml(html, o) {
      const r = { ...baseRender, ...o };
      const hits: Hit[] = [];
      let out = '';
      forEachHtmlToken(html, (tok) => {
        if (tok.type !== 'text' || tok.skip) {
          out += tok.raw;
          return;
        }
        // Decode entities while keeping, for every decoded code point, its raw source range.
        const chars: string[] = [];
        const from: number[] = [];
        const ent = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;
        let p = 0;
        const raw = tok.raw;
        const pushRaw = (s: string, base: number) => {
          let q = 0;
          for (const c of s) {
            chars.push(c);
            from.push(base + q);
            q += c.length;
          }
        };
        let m: RegExpExecArray | null;
        while ((m = ent.exec(raw))) {
          pushRaw(raw.slice(p, m.index), p);
          const d = decodeEntity(m[1]!);
          if (d === null) pushRaw(m[0], m.index);
          else {
            chars.push(d);
            from.push(m.index);
          }
          p = m.index + m[0].length;
        }
        pushRaw(raw.slice(p), p);
        from.push(raw.length);
        out += maskDecoded(
          chars,
          r,
          (a, b) => raw.slice(from[a], from[b]),
          (_a, _b, rep) => (r.preview ? rep : escapeHtml(rep)),
          hits,
          (k) => tok.index + from[k]!
        );
      });
      return { html: out, hits };
    },
  };
}

/* ---------------- HTML tokenizer (text vs. markup) ---------------- */

interface HtmlToken {
  type: 'text' | 'markup';
  raw: string;
  index: number;
  /** Inside code / pre / script / style / textarea. */
  skip?: boolean;
}

/** Elements whose text is never masked. */
const SKIP_ELEMENTS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'textarea']);
/** Raw-text elements: content runs to the matching close tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea']);

const TAG =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][^\s/>]*)(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;

function forEachHtmlToken(html: string, cb: (t: HtmlToken) => void): void {
  const stack: string[] = [];
  let last = 0;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(html))) {
    if (m.index > last)
      cb({ type: 'text', raw: html.slice(last, m.index), index: last, skip: stack.length > 0 });
    cb({ type: 'markup', raw: m[0], index: m.index });
    last = TAG.lastIndex;
    const name = m[1]?.toLowerCase();
    if (!name || !SKIP_ELEMENTS.has(name)) continue;
    const closing = m[0][1] === '/';
    const selfClosing = /\/>$/.test(m[0]);
    if (closing) {
      const i = stack.lastIndexOf(name);
      if (i >= 0) stack.length = i;
    } else if (!selfClosing) {
      if (RAW_TEXT.has(name)) {
        const end = html.toLowerCase().indexOf(`</${name}`, last);
        const stop = end < 0 ? html.length : end;
        if (stop > last) cb({ type: 'text', raw: html.slice(last, stop), index: last, skip: true });
        last = stop;
        TAG.lastIndex = stop;
      } else stack.push(name);
    }
  }
  if (last < html.length)
    cb({ type: 'text', raw: html.slice(last), index: last, skip: stack.length > 0 });
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

function decodeEntity(e: string): string | null {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : null;
  }
  return NAMED[e.toLowerCase()] ?? null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- one-shot helpers (cached maskers) ---------------- */

const CACHE_MAX = 8;
const cache = new Map<string, Masker>();

function maskerFor(opts: DictionaryOptions): Masker {
  const key = JSON.stringify([
    opts.categories,
    opts.words,
    opts.extraWords,
    opts.whitelist,
    opts.normalize,
  ]);
  let m = cache.get(key);
  if (!m) {
    m = createMasker(opts);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, m);
  }
  return m;
}

/**
 * Masks sensitive words in plain text. With `preview: true` the result is HTML (text escaped, hits
 * wrapped in `<mark class="sn-masked">`).
 */
export function maskText(text: string, opts: MaskOptions = {}): MaskTextResult {
  return maskerFor(opts).maskText(text, opts);
}

/**
 * Masks sensitive words in the text nodes of an HTML string. Tags, attributes and comments are kept
 * byte-for-byte; `code` / `pre` / `kbd` / `samp` / `script` / `style` / `textarea` content is skipped.
 */
export function maskHtml(html: string, opts: MaskOptions = {}): MaskHtmlResult {
  return maskerFor(opts).maskHtml(html, opts);
}

/** CSS for the preview highlight (optional; consumers may style `.sn-masked` themselves). */
export const PREVIEW_CSS =
  'mark.sn-masked{background:rgba(250,173,20,.25);color:inherit;border-radius:2px;padding:0 1px;cursor:help}';
