/**
 * Allow-list SVG sanitizer. Dependency-free and browser-safe; also used by `scripts/build-logos.mts`
 * on every downloaded SVG (downloaded files are untrusted data).
 *
 * Removes: script / foreignObject / style / any element not on the allow-list (with its subtree),
 * comments, CDATA, processing instructions, DOCTYPE / entity declarations, `on*` event attributes,
 * any attribute not on the allow-list, `href` / `xlink:href` that are not a local `#fragment`,
 * `url(...)` that is not `url(#fragment)` (in `style` and in presentation attributes), and values
 * containing `javascript:`, `data:`, `expression(` or `@import`.
 */

const ELEMENTS = new Set(
  [
    'svg',
    'g',
    'defs',
    'symbol',
    'use',
    'title',
    'desc',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'lineargradient',
    'radialgradient',
    'stop',
    'clippath',
    'mask',
    'pattern',
    'filter',
    'feblend',
    'fecolormatrix',
    'fecomponenttransfer',
    'fecomposite',
    'feflood',
    'fefunca',
    'fefuncb',
    'fefuncg',
    'fefuncr',
    'fegaussianblur',
    'femerge',
    'femergenode',
    'feoffset',
    'femorphology',
    'fedropshadow',
  ].map((s) => s.toLowerCase())
);

/** Elements whose text content is kept (escaped). */
const TEXT_ELEMENTS = new Set(['title', 'desc']);

const ATTRIBUTES = new Set(
  [
    'xmlns',
    'xmlns:xlink',
    'version',
    'id',
    'class',
    'viewbox',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'fx',
    'fy',
    'fr',
    'd',
    'points',
    'transform',
    'preserveaspectratio',
    'role',
    'aria-label',
    'aria-hidden',
    'focusable',
    'fill',
    'fill-rule',
    'fill-opacity',
    'clip-rule',
    'clip-path',
    'clippathunits',
    'mask',
    'maskunits',
    'maskcontentunits',
    'filter',
    'filterunits',
    'primitiveunits',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-opacity',
    'opacity',
    'color',
    'display',
    'visibility',
    'style',
    'offset',
    'stop-color',
    'stop-opacity',
    'gradientunits',
    'gradienttransform',
    'spreadmethod',
    'patternunits',
    'patterncontentunits',
    'patterntransform',
    'href',
    'xlink:href',
    'in',
    'in2',
    'result',
    'stddeviation',
    'dx',
    'dy',
    'values',
    'type',
    'mode',
    'operator',
    'k1',
    'k2',
    'k3',
    'k4',
    'flood-color',
    'flood-opacity',
    'radius',
    'tablevalues',
    'slope',
    'intercept',
    'amplitude',
    'exponent',
    'color-interpolation-filters',
    'shape-rendering',
    'vector-effect',
    'paint-order',
    'mix-blend-mode',
    'isolation',
  ].map((s) => s.toLowerCase())
);

const DANGEROUS_VALUE =
  /javascript:|vbscript:|data:|expression\s*\(|@import|behavior\s*:|-moz-binding/i;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five XML entities and numeric references; unknown named entities are dropped. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (_m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return NAMED[e.toLowerCase()] ?? '';
  });
}

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Keeps only `url(#local)` references; any other `url(...)` makes the value unsafe. */
function hasExternalUrl(v: string): boolean {
  const re = /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v))) if (!m[2]!.trim().startsWith('#')) return true;
  // Unbalanced `url(` (e.g. smuggled through comments) is also rejected.
  return /url\s*\(/i.test(v.replace(re, ''));
}

function cleanStyle(v: string): string {
  const decls = v
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !hasExternalUrl(d) && !DANGEROUS_VALUE.test(d) && !/[<>\\]/.test(d));
  return decls.join(';');
}

function cleanAttr(name: string, raw: string): string | null {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return null;
  if (!ATTRIBUTES.has(n)) return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters on purpose
  const v = decodeEntities(raw).replace(/[\u0000-\u001f]/g, ' ');
  if (n === 'xmlns') return 'http://www.w3.org/2000/svg';
  if (n === 'xmlns:xlink') return 'http://www.w3.org/1999/xlink';
  if (n === 'href' || n === 'xlink:href') return /^#[\w.:-]+$/.test(v.trim()) ? v.trim() : null;
  if (n === 'style') {
    const s = cleanStyle(v);
    return s ? s : null;
  }
  if (DANGEROUS_VALUE.test(v) || hasExternalUrl(v)) return null;
  return v;
}

export interface SanitizeSvgOptions {
  /** Set `fill` on the root `<svg>` (e.g. a brand colour for single-colour icons). */
  fill?: string;
  /** Drop `<title>` / `<desc>` (they show as tooltips). Default false. */
  dropTitle?: boolean;
}

/**
 * Returns a sanitized SVG string, or throws when the input has no `<svg>` root.
 * The output is re-serialized from tokens, so nothing outside the allow-list survives.
 */
export function sanitizeSvg(input: string, opts: SanitizeSvgOptions = {}): string {
  // Drop everything that is not an element or text before tokenizing.
  const src = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '');

  const out: string[] = [];
  /** Stack of open elements: name + whether it (and so its subtree) is kept. */
  const stack: Array<{ name: string; keep: boolean }> = [];
  const keeping = () => stack.every((e) => e.keep);
  let sawRoot = false;
  const tagRe =
    /<\s*(\/)?\s*([a-zA-Z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/)?\s*>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const pushText = (text: string) => {
    const top = stack[stack.length - 1];
    if (!top || !keeping() || !TEXT_ELEMENTS.has(top.name) || opts.dropTitle) return;
    const t = decodeEntities(text.replace(/<[^>]*>?/g, ''));
    if (t.trim()) out.push(escText(t));
  };

  while ((m = tagRe.exec(src))) {
    pushText(src.slice(last, m.index));
    last = tagRe.lastIndex;
    const [, closing, rawName, rawAttrs = '', selfClosing] = m;
    const name = rawName!.toLowerCase();
    if (closing) {
      // Pop to the matching element (tolerates malformed nesting).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name === name) {
          const wasKept = stack.slice(0, i + 1).every((e) => e.keep);
          stack.length = i;
          if (wasKept) out.push(`</${outName(name)}>`);
          break;
        }
      }
      continue;
    }
    const parentKeeps = keeping();
    const isRoot = name === 'svg' && !sawRoot;
    let keep = parentKeeps && ELEMENTS.has(name) && (sawRoot || isRoot);
    if (keep && opts.dropTitle && TEXT_ELEMENTS.has(name)) keep = false;
    if (keep) {
      const attrs: string[] = [];
      const seen = new Set<string>();
      const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(rawAttrs))) {
        const an = a[1]!.toLowerCase();
        if (seen.has(an)) continue;
        seen.add(an);
        if (isRoot && opts.fill && an === 'fill') continue;
        const v = cleanAttr(an, a[2] ?? a[3] ?? a[4] ?? '');
        if (v !== null) attrs.push(` ${outAttr(an)}="${escAttr(v)}"`);
      }
      if (isRoot) {
        sawRoot = true;
        if (!seen.has('xmlns')) attrs.unshift(' xmlns="http://www.w3.org/2000/svg"');
        if (opts.fill) attrs.push(` fill="${escAttr(opts.fill)}"`);
      }
      out.push(`<${outName(name)}${attrs.join('')}${selfClosing ? '/' : ''}>`);
    }
    if (!selfClosing) stack.push({ name, keep });
  }
  if (!sawRoot) throw new Error('sanitizeSvg: no <svg> root element');
  // Close anything left open (truncated input).
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack.slice(0, i + 1).every((e) => e.keep)) out.push(`</${outName(stack[i]!.name)}>`);
  }
  return out.join('');
}

const CASED: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite',
  feflood: 'feFlood',
  fefunca: 'feFuncA',
  fefuncb: 'feFuncB',
  fefuncg: 'feFuncG',
  fefuncr: 'feFuncR',
  fegaussianblur: 'feGaussianBlur',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  feoffset: 'feOffset',
  femorphology: 'feMorphology',
  fedropshadow: 'feDropShadow',
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  spreadmethod: 'spreadMethod',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits',
  filterunits: 'filterUnits',
  primitiveunits: 'primitiveUnits',
  patternunits: 'patternUnits',
  patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform',
  stddeviation: 'stdDeviation',
  tablevalues: 'tableValues',
};
const outName = (n: string) => CASED[n] ?? n;
const outAttr = (n: string) => CASED[n] ?? n;

/** True when a string still contains something the sanitizer must never let through. */
export function looksDangerous(svg: string): boolean {
  return (
    /<\s*(script|foreignobject|style|iframe|object|embed|image|a)\b/i.test(svg) ||
    /\son[a-z]+\s*=/i.test(svg) ||
    /javascript:/i.test(svg) ||
    /(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg) ||
    /url\(\s*['"]?(?!#)/i.test(svg)
  );
}
