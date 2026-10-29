import { escapeHtml, variantOf } from './convert';
import { maskPreviewHtml, maskReport, maskTree, resolveMask } from './mask';
import { mobileHtml, mobileOptionsFor } from './mobile';
import { resolveArticleTheme } from './themes';

import type { ConvertMask, MaskSummary } from './mask';
import type { MobileOptions } from './mobile';
import type { SdkLang } from './i18n/lang';
import type { ReportItem } from './report';
import type { ArticleTheme, ArticleThemeId } from './themes';

import type { TiptapJSON, TiptapMark } from './types';

/**
 * Tiptap JSON → HTML for the WeChat Official Account (微信公众号) editor.
 *
 * The 公众号 editor keeps an article's markup only in a narrow form, so this
 * serializer differs from `convert().html` on purpose:
 *
 * - **Inline styles only.** `<style>`, classes and ids are dropped by the
 *   editor (and by the draft API), so every look is written onto the element.
 * - **`section` / `p` / `span` / `strong` / `em` / `img` / `br` / `ul` / `ol` /
 *   `li` / `table` / `blockquote` / `pre` / `code` / `h1`–`h6` / `hr` / `svg`** are
 *   the only tags emitted. No `div`, no `figure`.
 * - **No positioning tricks** (`position`, `float`, `transform`) and no
 *   pseudo-elements: badges, quotation marks and numbers become real nodes.
 * - **Inline SVG** draws the ornamental dividers, without `id`, `<defs>`,
 *   gradients, `<style>`, `<text>` or scripts (all removed or unreliable in
 *   the editor). Gradients are approximated with segments. Set
 *   `dividerMode: 'img'` to use pre-rendered PNGs instead.
 * - **Links** outside `mp.weixin.qq.com` are not clickable in articles; they
 *   become the link text plus a numbered reference listed at the end.
 * - **Relative URLs** (`/api/v1/assets/…`) are made absolute with `assetBase`
 *   so the editor (or the adapter's upload step) can fetch every image.
 *
 * See `README.md` (“微信公众号 HTML”) for the assumptions behind these rules.
 */
export interface WechatOptions {
  /** SPEC-r14 B5: language of the report (the article itself is not translated). Default `zh-CN`. */
  lang?: SdkLang;
  /** Accent colour for styled blocks. Default `#6918b4`. */
  accent?: string;
  /** Second accent (gradients, answers). Default `#6a5ef0`. */
  accent2?: string;
  /** Origin that relative image URLs are resolved against, e.g. `https://starnote.app`. */
  assetBase?: string;
  /** `svg` (default): inline SVG dividers. `img`: `<img>` of `{dividerImageBase}/{variant}.png`. */
  dividerMode?: 'svg' | 'img';
  /** Where divider PNGs live. Default `{assetBase}/materials/dividers`. */
  dividerImageBase?: string;
  /** Body text size in px. Default 15. */
  fontSize?: number;
  /** Heading for the reference list of external links. Default `参考链接`. */
  linksTitle?: string;
  /**
   * Tokenizes a code block the way the editor highlights it (辰记 passes the editor SDK's
   * `highlightCode`). Without it code is one colour.
   */
  highlight?: (code: string, language: string | null) => WechatHighlight;
  /** Code colours by token class (`shj-kwd`, `shj-bg`…). Default: the editor's light theme. */
  codeTheme?: Record<string, string>;
  /** 敏感词自动打码, on by default (see `ConvertOptions.mask`). */
  mask?: ConvertMask;
  /**
   * Phone-first output; default: the registry's choice for 公众号 (mobile-first, no scroll containers: images at
   * screen width, tables over 4 columns as cards). `false` keeps the editor's sizes.
   */
  mobile?: boolean | MobileOptions;
  /**
   * 公众号风格主题 (CONTRACTS-r9 §1): palette, body size / line height / paragraph gap / justify, and the look of
   * headings and quotes without a variant, plain dividers, captions and card corners. Explicit `accent`,
   * `accent2` and `fontSize` still win. `null` / absent: the default look.
   */
  theme?: ArticleThemeId | ArticleTheme | null;
}

/** A highlighted code block: the editor's language label and its tokens. */
export interface WechatHighlight {
  label?: string;
  tokens: { type?: string; text: string }[];
}

/** The editor's light code palette (GitHub Light), used when `codeTheme` is not given. */
export const WECHAT_CODE_THEME: Record<string, string> = {
  'shj-bg': '#f6f8fa',
  'shj-fg': '#1f2328',
  'shj-border': 'rgba(31, 35, 40, 0.12)',
  'shj-numbers': '#8c959f',
  'shj-kwd': '#cf222e',
  'shj-deleted': '#82071e',
  'shj-err': '#82071e',
  'shj-class': '#953800',
  'shj-cmnt': '#6e7781',
  'shj-num': '#0550ae',
  'shj-bool': '#0550ae',
  'shj-type': '#0550ae',
  'shj-oper': '#0550ae',
  'shj-section': '#0550ae',
  'shj-var': '#953800',
  'shj-str': '#0a3069',
  'shj-esc': '#0a3069',
  'shj-func': '#8250df',
  'shj-insert': '#116329',
};

export interface WechatResult {
  html: string;
  /** Absolute `src` of every image, in document order (the adapter uploads them to WeChat). */
  images: string[];
  /** External links collected as references, in order. */
  links: { text: string; href: string }[];
  /** What masking replaced (absent when off). */
  masked?: MaskSummary;
  /** Masking and phone-first changes. */
  report?: ReportItem[];
}

interface Palette {
  accent: string;
  accent2: string;
  rose: string;
  amber: string;
  ink: string;
  heading: string;
  muted: string;
  line: string;
}

interface Ctx {
  o: Required<Pick<WechatOptions, 'dividerMode' | 'fontSize' | 'linksTitle'>> & WechatOptions;
  c: Palette;
  images: string[];
  links: { text: string; href: string }[];
  counters: Record<string, number>;
  /** Inside a dark card: headings and quotes switch to light colours. */
  dark: boolean;
}

/* ------------------------------------------------------------------------ */
/* helpers                                                                  */
/* ------------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((x) => x + x)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? [105, 24, 180] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgba()` of a hex colour. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

/** Mixes a hex colour towards black (`amount` 0–1), as hex. */
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * (1 - amount)));
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const out = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** `{a: 'b'}` → `a: b; ` with the falsy entries left out. */
function css(styles: Record<string, string | number | false | null | undefined>): string {
  return Object.entries(styles)
    .filter(([, v]) => v !== false && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v}`)
    .join('; ');
}

/** Escapes a double-quoted attribute value; single quotes (font names) stay readable. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tag(name: string, style: string, inner: string, extra = ''): string {
  return `<${name}${extra}${style ? ` style="${escapeAttr(style)}"` : ''}>${inner}</${name}>`;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function absolute(src: string, base?: string): string {
  if (!base || /^(https?:|data:)/i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  return `${base.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

function safeColor(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_COLOR.test(value.trim()) ? value.trim() : undefined;
}

/* ------------------------------------------------------------------------ */
/* inline                                                                   */
/* ------------------------------------------------------------------------ */

function markWx(mark: TiptapMark, inner: string, ctx: Ctx, text: string): string {
  const a = mark.attrs ?? {};
  switch (mark.type) {
    case 'bold':
      return tag('strong', css({ fontWeight: 700 }), inner);
    case 'italic':
      return tag('em', css({ fontStyle: 'italic' }), inner);
    case 'underline':
      return tag('span', css({ textDecoration: 'underline' }), inner);
    case 'strike':
      return tag('span', css({ textDecoration: 'line-through' }), inner);
    case 'code':
      return tag(
        'code',
        css({
          padding: '2px 5px',
          margin: '0 2px',
          borderRadius: '4px',
          background: rgba(ctx.c.accent, 0.08),
          color: darken(ctx.c.accent, 0.15),
          fontSize: '90%',
          fontFamily: "Menlo, Consolas, 'Courier New', monospace",
          wordBreak: 'break-all',
        }),
        inner
      );
    case 'highlight':
      return tag(
        'span',
        css({ backgroundColor: safeColor(a.color) ?? '#fff1b8', padding: '0 2px' }),
        inner
      );
    case 'textStyle': {
      const color = safeColor(a.color);
      const size =
        typeof a.fontSize === 'string' && /^\d{1,2}(\.\d+)?px$/.test(a.fontSize)
          ? a.fontSize
          : undefined;
      return color || size ? tag('span', css({ color, fontSize: size }), inner) : inner;
    }
    case 'link': {
      const href = str(a.href);
      if (!href) return inner;
      if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)) {
        return `<a href="${escapeHtml(href)}" style="${escapeAttr(css({ color: ctx.c.accent, textDecoration: 'none' }))}">${inner}</a>`;
      }
      ctx.links.push({ text: text || href, href });
      const n = ctx.links.length;
      return `${tag('span', css({ color: ctx.c.accent }), inner)}${tag('sup', css({ color: ctx.c.accent, fontSize: '11px' }), `[${n}]`)}`;
    }
    default:
      return inner;
  }
}

function inlineWx(nodes: TiptapJSON[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === 'text') {
        const text = node.text ?? '';
        let out = escapeHtml(text);
        // Link outermost, like the blog renderer; the link reads the plain text.
        for (const mark of [...(node.marks ?? [])].reverse()) out = markWx(mark, out, ctx, text);
        return out;
      }
      if (node.type === 'hardBreak') return '<br>';
      if (node.type === 'image') return imageTag(node, ctx, true);
      if (node.type === 'emoji')
        return escapeHtml(str(node.attrs?.emoji) ?? str(node.attrs?.name) ?? '');
      if (node.type === 'mention') return escapeHtml(`@${str(node.attrs?.label) ?? ''}`);
      // 公众号 has no formula renderer and drops KaTeX's stylesheet: the TeX source, as code.
      if (node.type === 'katex')
        return tag(
          'code',
          css({
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '0.875em',
            padding: '0.15em 0.35em',
            borderRadius: '4px',
            backgroundColor: 'rgba(175, 184, 193, 0.22)',
          }),
          escapeHtml(String(node.attrs?.text ?? ''))
        );
      return node.content ? inlineWx(node.content, ctx) : '';
    })
    .join('');
}

function imageTag(node: TiptapJSON, ctx: Ctx, inline = false): string {
  const a = node.attrs ?? {};
  const align = str(a.align);
  const blockMargin = align === 'left' ? '0' : align === 'right' ? '0 0 0 auto' : '0 auto';
  const raw = str(a.src) ?? '';
  if (!raw) return '';
  const src = absolute(raw, ctx.o.assetBase);
  if (!ctx.images.includes(src)) ctx.images.push(src);
  const width = typeof a.width === 'number' ? `${a.width}px` : str(a.width);
  const style = css({
    display: inline ? 'inline-block' : 'block',
    margin: inline ? '0 2px' : blockMargin,
    maxWidth: '100%',
    width: width && /^\d+(\.\d+)?(px|%)$/.test(width) ? width : undefined,
    height: 'auto',
    borderRadius: inline ? undefined : '6px',
    verticalAlign: inline ? 'middle' : undefined,
  });
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(str(a.alt) ?? str(a.caption) ?? '')}" style="${escapeAttr(style)}">`;
}

/* ------------------------------------------------------------------------ */
/* blocks                                                                   */
/* ------------------------------------------------------------------------ */

const HEADING_SIZE: Record<number, number> = { 1: 22, 2: 19, 3: 17, 4: 16, 5: 15, 6: 15 };

function pStyle(ctx: Ctx, last: boolean, align?: string): string {
  const themed = themePStyle(ctx, last, align);
  if (themed !== undefined) return themed;
  return css({
    margin: last ? '0' : `0 0 ${Math.round(ctx.o.fontSize * 1.1)}px`,
    lineHeight: 1.75,
    textAlign: align && ['center', 'right', 'justify'].includes(align) ? align : undefined,
  });
}

function blocksWx(nodes: TiptapJSON[] | undefined, ctx: Ctx, tight = false): string {
  const list = (nodes ?? []).filter(Boolean);
  return list
    .map((node, i) => blockWx(node, ctx, tight && i === list.length - 1))
    .filter(Boolean)
    .join('');
}

function headingWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const a = node.attrs ?? {};
  const level = Math.min(6, Math.max(1, Number(a.level) || 2));
  const size = HEADING_SIZE[level]!;
  const variant = variantOf(a.variant);
  const { accent, accent2, rose } = ctx.c;
  const color = ctx.dark ? '#ffffff' : ctx.c.heading;
  const text = inlineWx(node.content, ctx);
  const base = {
    margin: last ? '28px 0 0' : '28px 0 14px',
    fontSize: `${variant ? Math.min(size, 18) : size}px`,
    fontWeight: 700,
    lineHeight: 1.5,
    color,
    letterSpacing: '0.5px',
  };
  const h = `h${level}`;
  const count = (key: string) => {
    ctx.counters[key] = (ctx.counters[key] ?? 0) + 1;
    return String(ctx.counters[key]).padStart(2, '0');
  };
  switch (variant) {
    case 'pill':
      return tag(
        h,
        css({
          ...base,
          display: 'flex',
          alignItems: 'center',
          paddingBottom: '8px',
          borderBottom: `1px solid ${rgba(accent, 0.16)}`,
        }),
        tag(
          'span',
          css({
            flexShrink: 0,
            display: 'inline-block',
            minWidth: '32px',
            height: '24px',
            lineHeight: '24px',
            padding: '0 9px',
            marginRight: '10px',
            borderRadius: '999px',
            backgroundColor: accent,
            backgroundImage: `linear-gradient(135deg, ${accent}, ${accent2})`,
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 700,
            textAlign: 'center',
            boxSizing: 'border-box',
          }),
          count('pill')
        ) + tag('span', '', text)
      );
    case 'bar':
      return tag(
        h,
        css({
          ...base,
          padding: '4px 0 4px 10px',
          borderLeft: `4px solid ${accent}`,
          borderRadius: '0 6px 6px 0',
          backgroundImage: `linear-gradient(90deg, ${rgba(accent, 0.09)}, ${rgba(accent, 0)} 75%)`,
        }),
        text
      );
    case 'underline':
      return tag(
        h,
        css(base),
        tag(
          'span',
          css({
            padding: '0 2px',
            backgroundImage: `linear-gradient(90deg, ${rgba(accent, 0.32)}, ${rgba(rose, 0.3)})`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '0 88%',
            backgroundSize: '100% 8px',
          }),
          text
        )
      );
    case 'ornament': {
      const line = (dir: 'l' | 'r') =>
        svg(
          36,
          6,
          (dir === 'l'
            ? segments(0, 30, 3, 1, (t) => [accent, t * 0.9])
            : segments(6, 30, 3, 1, (t) => [accent, (1 - t) * 0.9])) +
            `<circle cx="${dir === 'l' ? 33 : 3}" cy="3" r="2.4" fill="${accent}"/>`,
          css({ display: 'inline-block', verticalAlign: 'middle', width: '36px', height: '6px' })
        );
      return tag(
        h,
        css({ ...base, textAlign: 'center' }),
        `${line('l')}${tag('span', css({ margin: '0 10px', verticalAlign: 'middle' }), text)}${line('r')}`
      );
    }
    case 'step':
      return tag(
        'section',
        css({ margin: base.margin }),
        tag(
          'section',
          css({
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: '4px',
            backgroundColor: accent,
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '2.5px',
            lineHeight: 1.5,
          }),
          `STEP ${count('step')}`
        ) + tag(h, css({ ...base, margin: '8px 0 0' }), text)
      );
    case 'tag':
      return tag(
        h,
        css(base),
        tag(
          'span',
          css({
            display: 'inline-block',
            padding: '4px 16px 4px 12px',
            borderRadius: '4px 999px 999px 4px',
            backgroundColor: accent,
            backgroundImage: `linear-gradient(90deg, ${accent}, ${accent2})`,
            color: '#ffffff',
          }),
          text
        )
      );
    default:
      return themeHeadingWx(h, level, text, ctx, last) ?? tag(h, css(base), text);
  }
}

function quoteMark(ctx: Ctx, glyph: string, align: 'left' | 'right', size: number): string {
  return tag(
    'p',
    css({
      margin: '0',
      height: `${Math.round(size * 0.55)}px`,
      lineHeight: `${size}px`,
      fontSize: `${size}px`,
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontWeight: 700,
      color: rgba(ctx.c.accent, 0.42),
      textAlign: align,
      overflow: 'hidden',
    }),
    glyph
  );
}

function quoteWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const variant = variantOf(node.attrs?.variant);
  const { accent, amber } = ctx.c;
  const margin = last ? '20px 0 0' : '20px 0';
  const body = blocksWx(node.content, ctx, true);
  switch (variant) {
    case 'card':
      return tag(
        'section',
        css({
          margin,
          padding: '10px 18px 16px',
          borderRadius: '12px',
          backgroundColor: rgba(accent, 0.07),
        }),
        quoteMark(ctx, '“', 'left', 44) + body
      );
    case 'center':
      return tag(
        'section',
        css({
          margin,
          padding: '0 18px',
          textAlign: 'center',
          fontSize: `${ctx.o.fontSize + 1}px`,
          fontWeight: 600,
          color: ctx.dark ? '#ffffff' : darken(accent, 0.18),
        }),
        quoteMark(ctx, '“', 'left', 34) + body + quoteMark(ctx, '”', 'right', 34)
      );
    case 'line':
      return tag(
        'section',
        css({
          margin,
          padding: '10px 15px',
          borderLeft: `3px solid ${accent}`,
          borderRadius: '0 8px 8px 0',
          backgroundColor: rgba(accent, 0.05),
        }),
        body
      );
    case 'paper':
      return tag(
        'section',
        css({
          margin,
          padding: '14px 18px',
          border: `1px dashed ${rgba(amber, 0.6)}`,
          borderRadius: '10px',
          backgroundColor: rgba(amber, 0.08),
        }),
        body
      );
    default:
      return (
        themeQuoteWx(body, ctx, last) ??
        tag(
          'blockquote',
          css({
            margin,
            padding: '10px 16px',
            borderLeft: `3px solid ${rgba(accent, 0.25)}`,
            backgroundColor: '#f8f7fa',
            color: ctx.dark ? '#f3eefe' : '#555555',
          }),
          body
        )
      );
  }
}

function badge(label: string, bg: string, color = '#ffffff'): string {
  return tag(
    'section',
    css({
      display: 'inline-block',
      marginBottom: '10px',
      padding: '2px 11px',
      borderRadius: '999px',
      backgroundColor: bg,
      color,
      fontSize: '12px',
      fontWeight: 600,
      lineHeight: 1.7,
      letterSpacing: '0.5px',
    }),
    escapeHtml(label)
  );
}

function cardWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const a = node.attrs ?? {};
  const variant = variantOf(a.variant) ?? 'soft';
  const label = str(a.label);
  const { accent, accent2, rose, amber } = ctx.c;
  const margin = last ? '20px 0 0' : '20px 0';
  const wasDark = ctx.dark;
  if (variant === 'dark') ctx.dark = true;
  const body = blocksWx(node.content, ctx, true);
  ctx.dark = wasDark;
  const box = (
    style: Record<string, string | number | undefined>,
    labelBg = accent,
    labelColor = '#ffffff'
  ) =>
    tag(
      'section',
      css({
        margin,
        padding: '15px 18px',
        borderRadius: '12px',
        ...style,
        ...themeCardRadius(ctx, variant),
      }),
      (label ? badge(label, labelBg, labelColor) : '') + body
    );

  switch (variant) {
    case 'outline':
      return tag(
        'section',
        css({
          margin: label ? (last ? '30px 0 0' : '30px 0 20px') : margin,
          padding: label ? '0 18px 15px' : '15px 18px',
          border: `1px solid ${rgba(accent, 0.38)}`,
          borderRadius: '12px',
          ...themeCardRadius(ctx, variant),
        }),
        (label
          ? tag(
              'section',
              css({ marginTop: '-13px', marginBottom: '8px', lineHeight: 1 }),
              badge(label, accent).replace('margin-bottom: 10px', 'margin-bottom: 0')
            )
          : '') + body
      );
    case 'shadow':
      return box({
        backgroundColor: '#ffffff',
        border: '1px solid #f0edf5',
        boxShadow: '0 10px 30px -14px rgba(40, 16, 80, 0.3)',
      });
    case 'accent':
      return box({
        padding: '18px 18px 15px',
        borderRadius: '10px',
        backgroundColor: rgba(accent, 0.05),
        backgroundImage: `linear-gradient(90deg, ${accent}, ${accent2})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 4px',
        backgroundPosition: 'top',
      });
    case 'ticket':
      return box({
        border: `1.5px dashed ${rgba(accent, 0.45)}`,
        borderRadius: '10px',
        backgroundColor: rgba(accent, 0.04),
      });
    case 'tip':
      return box(
        {
          borderLeft: `4px solid ${amber}`,
          borderRadius: '4px 12px 12px 4px',
          backgroundColor: rgba(amber, 0.12),
        },
        amber,
        '#4a3000'
      );
    case 'warn':
      return box(
        {
          borderLeft: `4px solid ${rose}`,
          borderRadius: '4px 12px 12px 4px',
          backgroundColor: rgba(rose, 0.1),
        },
        rose
      );
    case 'ask':
      return box(
        {
          marginRight: '12%',
          padding: '12px 16px',
          borderRadius: '4px 16px 16px 16px',
          backgroundColor: '#f3f2f5',
        },
        '#6b6875'
      );
    case 'answer':
      return box(
        {
          marginLeft: '12%',
          padding: '12px 16px',
          borderRadius: '16px 4px 16px 16px',
          backgroundColor: rgba(accent, 0.09),
        },
        accent2
      );
    case 'end':
      return box({
        padding: '10px 0',
        textAlign: 'center',
        fontSize: '14px',
        color: '#666666',
        borderRadius: '0',
      });
    case 'dark':
      return box(
        {
          padding: '20px 20px',
          borderRadius: '14px',
          backgroundColor: '#1d1530',
          backgroundImage: 'linear-gradient(145deg, #241a3d, #15101f)',
          color: '#f3eefe',
        },
        'rgba(255, 255, 255, 0.16)'
      );
    case 'stat':
      return statWx(node, ctx, margin, label);
    case 'soft':
    default:
      return box({ backgroundColor: rgba(accent, 0.07) });
  }
}

/**
 * 数据卡: paragraphs that open with bold are figures (big number + caption), two per row as inline blocks (公众号
 * keeps neither grid nor flex-wrap); anything else (the source sentence) runs full width under them.
 */
function statWx(node: TiptapJSON, ctx: Ctx, margin: string, label: string | undefined): string {
  const { accent, accent2 } = ctx.c;
  const isFigure = (n: TiptapJSON) =>
    n.type === 'paragraph' &&
    n.content?.[0]?.type === 'text' &&
    (n.content[0].marks ?? []).some((m) => m.type === 'bold');
  const children = node.content ?? [];
  const figures = children.filter(isFigure).map((n) => {
    const [first, ...rest] = n.content ?? [];
    return tag(
      'section',
      css({
        display: 'inline-block',
        width: '50%',
        verticalAlign: 'top',
        boxSizing: 'border-box',
        padding: '0 10px 12px 0',
      }),
      tag(
        'section',
        css({ borderLeft: `3px solid ${rgba(accent, 0.32)}`, paddingLeft: '10px' }),
        tag(
          'span',
          css({
            display: 'block',
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: 1.2,
            color: accent,
          }),
          escapeHtml(first?.text ?? '')
        ) +
          tag(
            'span',
            css({ display: 'block', fontSize: '13px', lineHeight: 1.5, color: '#666666' }),
            inlineWx(rest, ctx).trim()
          )
      )
    );
  });
  const others = children.filter((n) => !isFigure(n));
  const rest = others.length
    ? tag(
        'section',
        css({ marginTop: '4px', fontSize: '14px', color: '#555555' }),
        blocksWx(others, ctx, true)
      )
    : '';
  return tag(
    'section',
    css({
      margin,
      padding: '16px 18px 14px',
      border: `1px solid ${rgba(accent, 0.16)}`,
      borderRadius: '14px',
      backgroundColor: rgba(accent, 0.06),
      backgroundImage: `linear-gradient(160deg, ${rgba(accent, 0.08)}, ${rgba(accent2, 0.03)})`,
    }),
    (label ? badge(label, accent) : '') +
      tag('section', css({ lineHeight: 0 }), figures.join('')) +
      rest
  );
}

function listWx(node: TiptapJSON, ctx: Ctx, last: boolean, ordered: boolean): string {
  const a = node.attrs ?? {};
  const start = Number(a.start);
  const items = (node.content ?? [])
    .map((item) => {
      const kids = item.content ?? [];
      const inner =
        kids.length === 1 && kids[0]?.type === 'paragraph'
          ? inlineWx(kids[0].content, ctx)
          : blocksWx(kids, ctx, true);
      return tag('li', css({ margin: '4px 0', lineHeight: 1.75 }), tag('section', '', inner));
    })
    .join('');
  return tag(
    ordered ? 'ol' : 'ul',
    css({
      margin: last ? '0' : `0 0 ${Math.round(ctx.o.fontSize * 1.1)}px`,
      paddingLeft: '22px',
      listStyleType: ordered ? 'decimal' : 'disc',
    }),
    items,
    ordered && start > 1 ? ` start="${start}"` : ''
  );
}

function taskListWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  return tag(
    'section',
    css({ margin: last ? '0' : `0 0 ${Math.round(ctx.o.fontSize * 1.1)}px` }),
    (node.content ?? [])
      .map((item) => {
        const checked = item.attrs?.checked === true;
        const kids = item.content ?? [];
        const inner =
          kids.length === 1 && kids[0]?.type === 'paragraph'
            ? inlineWx(kids[0].content, ctx)
            : blocksWx(kids, ctx, true);
        return tag(
          'p',
          css({ margin: '4px 0', lineHeight: 1.75 }),
          tag('span', css({ color: ctx.c.accent, marginRight: '6px' }), checked ? '☑' : '☐') +
            (checked
              ? tag('span', css({ color: '#999999', textDecoration: 'line-through' }), inner)
              : inner)
        );
      })
      .join('')
  );
}

/** Leading spaces and runs of spaces as `&nbsp;`: the 公众号 editor collapses whitespace even in <pre>. */
function keepSpaces(html: string): string {
  return html
    .replace(/\t/g, '    ')
    .replace(/^ +/, (m) => '&nbsp;'.repeat(m.length))
    .replace(/ {2,}/g, (m) => '&nbsp;'.repeat(m.length));
}

function codeWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const code = (node.content ?? []).map((n) => n.text ?? '').join('');
  const theme = { ...WECHAT_CODE_THEME, ...ctx.o.codeTheme };
  const hl = ctx.o.highlight?.(code, str(node.attrs?.language) ?? null);
  const tokens = hl?.tokens ?? [{ text: code }];
  // Every token is coloured inline (the 公众号 editor drops classes); a newline is a <br>, so the
  // lines survive an editor that rewrites white-space, and each line starts with its own span.
  let line = '';
  const lines: string[] = [];
  for (const t of tokens) {
    const color = t.type ? theme[`shj-${t.type}`] : undefined;
    const italic = t.type === 'cmnt';
    const pieces = t.text.split('\n');
    pieces.forEach((piece, i) => {
      if (i > 0) {
        lines.push(line);
        line = '';
      }
      if (!piece) return;
      const text = keepSpaces(escapeHtml(piece));
      line += color
        ? tag('span', css({ color, fontStyle: italic ? 'italic' : undefined }), text)
        : text;
    });
  }
  lines.push(line);
  const body = lines.join('<br>');
  const label = hl?.label && hl.label !== 'Plain' ? hl.label : '';
  return tag(
    'section',
    css({
      margin: last ? '0' : '0 0 16px',
      border: `1px solid ${theme['shj-border']}`,
      borderRadius: '8px',
      backgroundColor: theme['shj-bg'],
      overflowX: 'auto',
    }),
    (label
      ? tag(
          'section',
          css({
            padding: '6px 12px 0',
            fontSize: '12px',
            lineHeight: '18px',
            color: theme['shj-numbers'],
            textAlign: 'right',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }),
          escapeHtml(label)
        )
      : '') +
      tag(
        'section',
        css({
          margin: '0',
          padding: label ? '4px 12px 12px' : '12px',
          overflowX: 'auto',
          whiteSpace: 'pre',
        }),
        tag(
          'code',
          css({
            display: 'block',
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
            fontSize: '13px',
            lineHeight: '20px',
            color: theme['shj-fg'],
            whiteSpace: 'pre',
            wordBreak: 'normal',
            backgroundColor: 'transparent',
          }),
          body
        )
      )
  );
}

function tableWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const rows = (node.content ?? [])
    .map((row) =>
      tag(
        'tr',
        '',
        (row.content ?? [])
          .map((cell) => {
            const th = cell.type === 'tableHeader';
            const colspan = Number(cell.attrs?.colspan);
            const rowspan = Number(cell.attrs?.rowspan);
            const extra = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
            const kids = cell.content ?? [];
            const inner =
              kids.length === 1 && kids[0]?.type === 'paragraph'
                ? inlineWx(kids[0].content, ctx)
                : blocksWx(kids, ctx, true);
            const align = str(cell.attrs?.align);
            const bg = safeColor(str(cell.attrs?.backgroundColor));
            const widths = Array.isArray(cell.attrs?.colwidth)
              ? (cell.attrs.colwidth as unknown[])
              : [];
            const width = widths.every((w) => typeof w === 'number' && w > 0)
              ? (widths as number[]).reduce((sum, w) => sum + w, 0)
              : 0;
            // the editor's grid: hairline rgba(0,0,0,.1) borders, a 4% grey header, 8px padding
            return tag(
              th ? 'th' : 'td',
              css({
                border: '1px solid #e6e6e6',
                padding: '8px',
                backgroundColor: bg ?? (th ? '#f5f5f5' : undefined),
                fontWeight: th ? 600 : undefined,
                textAlign: align === 'center' || align === 'right' ? align : 'left',
                verticalAlign: 'top',
                width: width ? `${width}px` : undefined,
                minWidth: '5em',
              }),
              inner,
              extra
            );
          })
          .join('')
      )
    )
    .join('');
  return tag(
    'section',
    css({ margin: last ? '0' : '0 0 16px', overflowX: 'auto' }),
    tag(
      'table',
      css({ borderCollapse: 'collapse', fontSize: `${ctx.o.fontSize}px`, lineHeight: 1.6 }),
      tag('tbody', '', rows)
    )
  );
}

function figureWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const a = node.attrs ?? {};
  const img = imageTag(node, ctx);
  if (!img) return '';
  const align = str(a.align);
  const caption = str(a.caption);
  return (
    tag(
      'p',
      css({
        margin: caption ? '0 0 6px' : last ? '0' : '0 0 16px',
        textAlign: align === 'left' || align === 'right' ? align : 'center',
        lineHeight: 0,
      }),
      img
    ) +
    (caption
      ? tag(
          'p',
          themeCaptionCss(ctx, last) ??
            css({
              margin: last ? '0' : '0 0 16px',
              textAlign: 'center',
              fontSize: '12px',
              lineHeight: 1.6,
              color: '#999999',
            }),
          escapeHtml(caption)
        )
      : '')
  );
}

function blockWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph': {
      const inner = inlineWx(node.content, ctx);
      return tag('p', pStyle(ctx, last, str(a.textAlign)), inner || '<br>');
    }
    case 'heading':
      return headingWx(node, ctx, last);
    case 'blockquote':
      return quoteWx(node, ctx, last);
    case 'card':
      return cardWx(node, ctx, last);
    case 'divider':
      return (
        themeHrWx(ctx, last, variantOf(a.variant) ?? 'line') ??
        dividerWx(variantOf(a.variant) ?? 'line', str(a.label), ctx, last)
      );
    case 'horizontalRule':
      return themeHrWx(ctx, last) ?? dividerWx('line', undefined, ctx, last);
    case 'bulletList':
      return listWx(node, ctx, last, false);
    case 'orderedList':
      return listWx(node, ctx, last, true);
    case 'taskList':
      return taskListWx(node, ctx, last);
    case 'codeBlock':
      return codeWx(node, ctx, last);
    case 'table':
      return tableWx(node, ctx, last);
    case 'image':
    case 'imageBlock':
    case 'imageGif':
    case 'mermaid':
      return figureWx(node, ctx, last);
    case 'callout':
      return calloutWx(node, ctx, last);
    case 'notice':
      return noticeWx(node, ctx, last);
    case 'details': {
      const [summary, body] = node.content ?? [];
      return (
        tag(
          'p',
          css({ margin: '0 0 6px', fontWeight: 600 }),
          `▸ ${inlineWx(summary?.content, ctx)}`
        ) +
        tag(
          'section',
          css({ margin: last ? '0' : '0 0 16px', paddingLeft: '14px' }),
          blocksWx(body?.content, ctx, true)
        )
      );
    }
    case 'iframe': {
      const src = str(a.src);
      return src ? tag('p', pStyle(ctx, last), `▶ ${escapeHtml(src)}`) : '';
    }
    default:
      // Unknown blocks (columns, details…): keep their content readable.
      return node.content ? blocksWx(node.content, ctx, last) : '';
  }
}

const CALLOUT_COLORS: Record<string, string> = {
  note: '#1f6feb',
  tip: '#238636',
  important: '#ab7df8',
  warning: '#d29922',
  caution: '#f85149',
};

/** Callout: the editor's tinted, bordered box with a coloured title. */
function calloutWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const a = node.attrs ?? {};
  // older documents kept the callout's text as child blocks
  if (node.content?.length) return blocksWx(node.content, ctx, last);
  const color = CALLOUT_COLORS[String(a.type)];
  const title = str(a.title);
  const body = str(a.body)?.replace(/<[^>]+>/g, '');
  return tag(
    'section',
    css({
      margin: last ? '16px 0 0' : '16px 0',
      padding: '16px',
      border: `1px solid ${color ?? '#e5e5e5'}`,
      borderRadius: '10px',
      backgroundColor: color ? rgba(color, 0.12) : undefined,
    }),
    (title
      ? tag('p', css({ margin: body ? '0 0 8px' : '0', fontWeight: 600, color }), escapeHtml(title))
      : '') + (body ? tag('p', css({ margin: '0', whiteSpace: 'pre-wrap' }), escapeHtml(body)) : '')
  );
}

const NOTICE_COLORS: Record<string, string> = {
  info: '#1f6feb',
  success: '#1a7f37',
  warning: '#bf8700',
  tip: '#8250df',
  danger: '#cf222e',
  error: '#cf222e',
};

/** Notice: a left-ruled tinted box (the editor's `.notice`). */
function noticeWx(node: TiptapJSON, ctx: Ctx, last: boolean): string {
  const color = NOTICE_COLORS[String(node.attrs?.type)] ?? NOTICE_COLORS.info!;
  return tag(
    'section',
    css({
      margin: last ? '16px 0 0' : '16px 0',
      padding: '12px 16px',
      borderLeft: `4px solid ${color}`,
      borderRadius: '6px',
      backgroundColor: rgba(color, 0.09),
    }),
    blocksWx(node.content, ctx, true)
  );
}

/* ------------------------------------------------------------------------ */
/* dividers                                                                 */
/* ------------------------------------------------------------------------ */

function svg(width: number, height: number, body: string, style?: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${escapeAttr(
    style ?? css({ display: 'block', margin: '0 auto', maxWidth: '100%', overflow: 'visible' })
  )}">${body}</svg>`;
}

/**
 * Horizontal segments from x0 to x1 (`n` of them) whose colour / opacity come
 * from `paint(t)` (t = 0…1 along the run): a gradient without `<defs>`.
 */
function segments(
  x0: number,
  x1: number,
  n: number,
  h: number,
  paint: (t: number) => [string, number],
  y = 0
): string {
  const w = (x1 - x0) / n;
  let out = '';
  for (let i = 0; i < n; i++) {
    const [fill, opacity] = paint((i + 0.5) / n);
    if (opacity <= 0.01) continue;
    out += `<rect x="${(x0 + i * w).toFixed(2)}" y="${y}" width="${(w + 0.3).toFixed(2)}" height="${h}" fill="${fill}" fill-opacity="${opacity.toFixed(2)}"/>`;
  }
  return out;
}

function star4(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
}

/** Ornament paths (same drawings as the editor's CSS masks), in a 0-based box. */
const PATHS = {
  wave: 'M0 4C4 0 8 0 12 4S20 8 24 4',
  leaf: [
    'M24 8.5C21 3 15 1.5 10 3C14 6.5 19 8.5 24 8.5Z',
    'M24 8.5C27 14 33 15.5 38 14C34 10.5 29 8.5 24 8.5Z',
    'M15 8.5C13.5 11.5 10.5 12.8 7.5 12.4C9.5 10 12 8.5 15 8.5Z',
    'M33 8.5C34.5 5.5 37.5 4.2 40.5 4.6C38.5 7 36 8.5 33 8.5Z',
  ],
  pen: 'M8 15.6L3.3 8.4L5.3 2.4H10.7L12.7 8.4ZM8 6.3A1.35 1.35 0 1 0 8 9A1.35 1.35 0 1 0 8 6.3ZM7.6 8.9H8.4V14.4H7.6Z',
  penCap: 'M5.5 0.4H10.5V1.7H5.5Z',
  ink: 'M3 11.5C30 6.5 70 5 120 6.2C170 7.4 220 5.4 262 6.6C280 7.1 292 8.4 297 10.2C292 12.6 276 13.6 255 13.4C210 13 170 14.8 120 14.6C75 14.4 35 15.8 3 11.5ZM60 9.6C100 8.6 150 8.7 205 9.3C150 9.4 100 9.5 60 9.6Z',
  /** 辰记 mark (the brand mark decimated to a polyline), 100×100 box. */
  chenji:
    'M49.7 39.6 L45.4 36.3 L40.4 34.4 L35 34 L29.8 35.1 L25 37.6 L21.1 41.3 L18.2 45.8 L16.2 50.8 L15 56.1 L14.5 61.5 L14.7 66.8 L15.7 72.1 L17.4 77.2 L19.9 82 L23.2 86.3 L27.2 89.9 L31.8 92.7 L36.8 94.6 L42.1 95.3 L47.5 94.9 L52.7 94.9 L58.1 95.3 L63.4 94.5 L68.5 92.6 L73 89.8 L77 86.1 L80.2 81.8 L82.7 77 L84.4 71.9 L85.3 66.6 L85.5 61.2 L85.5 55.8 L85.5 50.4 L85.3 45 L83.6 40 L79.9 36 L74.9 34.1 L69.5 34 L64.2 34 L59.5 36.4 L58.1 41.4 L60.9 45.9 L66 47 L71.4 47 L72.5 51.4 L72.5 56.7 L72.5 62.1 L72.1 67.5 L70.4 72.6 L67.5 77.2 L63.4 80.6 L58.3 82.3 L53 81.6 L47.7 81.4 L42.4 82.3 L37.2 81 L33 77.7 L29.9 73.3 L28.1 68.2 L27.5 62.9 L27.9 57.5 L29.5 52.4 L32.7 48.1 L37.8 47.2 L42.3 50 L47.6 50.1 L51.1 46.3 L50.7 41.1ZM53 31.5 L56.2 21.3 L62.1 26Z M57 20.3 L63 24.9 L69.7 16.3 L63.7 11.6Z M64.5 10.6 L70.5 15.2 L72.1 13.2 L72.6 12.3 L72.9 11.4 L72.9 10.4 L72.7 9.4 L72.2 8.6 L71.5 7.9 L70.6 7.4 L69.7 7.1 L68.7 7.1 L67.7 7.3 L66.8 7.8 L66.1 8.5 L66.1 8.5Z',
} as const;

/** Inline SVG (or a pre-rendered PNG) for one divider look. */
export function wechatDivider(
  variant: string,
  label: string | undefined,
  opts: WechatOptions = {}
): string {
  const ctx = makeCtx(opts);
  return dividerWx(variantOf(variant) ?? 'line', label, ctx, false);
}

/** Divider looks the WeChat serializer draws; anything else falls back to `line`. */
export const WECHAT_DIVIDER_VARIANTS = [
  'line',
  'dashed',
  'dotted',
  'double',
  'short',
  'dots',
  'stars',
  'text',
  'number',
  'gradient',
  'diamond',
  'trio',
  'wave',
  'starsea',
  'leaf',
  'end',
  'bar',
  'pen',
  'ribbon',
  'ink',
  'fade',
  'chenji',
] as const;

function dividerWx(variant: string, label: string | undefined, ctx: Ctx, last: boolean): string {
  const { accent, accent2, rose, amber, line } = ctx.c;
  const known = (WECHAT_DIVIDER_VARIANTS as readonly string[]).includes(variant) ? variant : 'line';
  const wrap = (inner: string) =>
    tag(
      'section',
      css({ margin: last ? '28px 0 0' : '28px 0', textAlign: 'center', lineHeight: 0 }),
      inner
    );

  if (
    ctx.o.dividerMode === 'img' &&
    !(known === 'text' || known === 'number') &&
    known !== 'line'
  ) {
    const base =
      ctx.o.dividerImageBase ?? `${(ctx.o.assetBase ?? '').replace(/\/$/, '')}/materials/dividers`;
    const src = `${base}/${known}.png`;
    return wrap(
      `<img src="${escapeHtml(src)}" alt="" style="${escapeAttr(css({ display: 'block', margin: '0 auto', width: '100%', maxWidth: '320px', height: 'auto' }))}">`
    );
  }

  const W = 320;
  const mid = W / 2;
  const fadeLine = (
    x0: number,
    x1: number,
    color: string,
    peak: number,
    y = 0,
    h = 1,
    rise: 'in' | 'out' | 'both' = 'both'
  ) =>
    segments(
      x0,
      x1,
      24,
      h,
      (t) => {
        const k = rise === 'in' ? t : rise === 'out' ? 1 - t : 1 - Math.abs(t - 0.5) * 2;
        return [color, Math.max(0, Math.min(1, k * 1.25)) * peak];
      },
      y
    );

  switch (known) {
    case 'dashed':
      return wrap(
        svg(
          W,
          2,
          Array.from(
            { length: 40 },
            (_, i) => `<rect x="${i * 8}" y="0" width="5" height="1" fill="${line}"/>`
          ).join('')
        )
      );
    case 'dotted':
      return wrap(
        svg(
          W,
          4,
          Array.from(
            { length: 40 },
            (_, i) =>
              `<circle cx="${i * 8 + 4}" cy="2" r="1.2" fill="${accent}" fill-opacity="0.45"/>`
          ).join('')
        )
      );
    case 'double':
      return wrap(
        svg(
          W,
          5,
          `<rect x="0" y="0" width="${W}" height="1" fill="${line}"/><rect x="0" y="4" width="${W}" height="1" fill="${line}"/>`
        )
      );
    case 'short':
      return wrap(svg(W, 2, `<rect x="${mid - 40}" y="0" width="80" height="1" fill="${line}"/>`));
    case 'dots':
      return wrap(
        svg(
          60,
          8,
          [10, 30, 50].map((x) => `<circle cx="${x}" cy="4" r="2.2" fill="#999999"/>`).join('')
        )
      );
    case 'stars':
      return wrap(
        svg(
          80,
          12,
          [16, 40, 64].map((x) => `<path d="${star4(x, 6, 5)}" fill="#999999"/>`).join('')
        )
      );
    case 'text':
    case 'number': {
      const side = (dir: 'in' | 'out') =>
        svg(
          100,
          2,
          fadeLine(0, 100, '#bbbbbb', 1, 0, 1, dir),
          css({ display: 'inline-block', verticalAlign: 'middle', width: '30%', height: '2px' })
        );
      const text = label ? escapeHtml(label) : '';
      return tag(
        'section',
        css({ margin: last ? '28px 0 0' : '28px 0', textAlign: 'center', lineHeight: 1 }),
        `${side('in')}${tag('span', css({ display: 'inline-block', margin: '0 12px', verticalAlign: 'middle', fontSize: '13px', color: '#999999', letterSpacing: '1px' }), text)}${side('out')}`
      );
    }
    case 'fade':
      return wrap(svg(W, 2, fadeLine(0, W, '#000000', 0.25)));
    case 'gradient':
      return wrap(
        svg(
          W,
          2,
          segments(0, W, 40, 2, (t) => {
            const color =
              t < 0.6 ? mix(accent, accent2, t / 0.6) : mix(accent2, rose, (t - 0.6) / 0.4);
            const alpha = t < 0.22 ? t / 0.22 : t > 0.85 ? (1 - t) / 0.15 : 1;
            return [color, alpha];
          })
        )
      );
    case 'bar':
      return wrap(
        svg(
          56,
          4,
          `<rect x="0" y="0" width="56" height="4" rx="2" fill="${accent}"/><rect x="28" y="0" width="28" height="4" rx="2" fill="${accent2}"/><rect x="24" y="0" width="8" height="4" fill="${mix(accent, accent2, 0.5)}"/>`
        )
      );
    case 'diamond':
      return wrap(
        svg(
          W,
          14,
          fadeLine(0, mid - 24, accent, 0.55, 7, 1, 'in') +
            fadeLine(mid + 24, W, accent, 0.55, 7, 1, 'out') +
            `<path d="M${mid} 2.5L${mid + 4.5} 7L${mid} 11.5L${mid - 4.5} 7Z" fill="${accent}"/>` +
            `<path d="M${mid - 15} 5L${mid - 13} 7L${mid - 15} 9L${mid - 17} 7Z" fill="${accent}" fill-opacity="0.45"/>` +
            `<path d="M${mid + 15} 5L${mid + 17} 7L${mid + 15} 9L${mid + 13} 7Z" fill="${accent}" fill-opacity="0.45"/>`
        )
      );
    case 'trio':
      return wrap(
        svg(
          48,
          12,
          `<circle cx="6" cy="6" r="3.6" fill="${accent}"/><circle cx="24" cy="6" r="3.6" fill="${rose}"/><circle cx="42" cy="6" r="3.6" fill="${amber}"/>`
        )
      );
    case 'wave': {
      const tiles = 8;
      const path = Array.from(
        { length: tiles },
        (_, i) =>
          `<path d="${PATHS.wave}" transform="translate(${i * 24} 0)" fill="none" stroke="${mix(accent, i < tiles / 2 ? accent2 : rose, (i % (tiles / 2)) / (tiles / 2))}" stroke-width="1.6" stroke-linecap="round"/>`
      ).join('');
      return wrap(svg(tiles * 24, 8, path));
    }
    case 'starsea':
      return wrap(
        svg(
          160,
          32,
          `<path d="M6 25C26 19 46 19 66 25S106 31 126 25S148 21 154 23" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="1.6" stroke-linecap="round"/>` +
            `<path d="${star4(54, 11, 5)}" fill="${amber}"/><path d="${star4(80, 7, 7.5)}" fill="${accent}"/><path d="${star4(104, 13, 4)}" fill="${amber}" fill-opacity="0.8"/>` +
            `<circle cx="67" cy="16" r="1" fill="${accent}" fill-opacity="0.5"/><circle cx="93" cy="4" r="1" fill="${accent}" fill-opacity="0.5"/>`
        )
      );
    case 'leaf':
      return wrap(
        svg(
          W,
          16,
          fadeLine(0, mid - 30, accent, 0.5, 8, 1, 'in') +
            fadeLine(mid + 30, W, accent, 0.5, 8, 1, 'out') +
            `<g transform="translate(${mid - 24} 0)"><path d="M3 8.5H45" stroke="${accent}" stroke-opacity="0.6" stroke-width="1" stroke-linecap="round"/>${PATHS.leaf
              .map(
                (d, i) => `<path d="${d}" fill="${accent}"${i > 1 ? ' fill-opacity="0.7"' : ''}/>`
              )
              .join('')}</g>`
        )
      );
    case 'pen':
      return wrap(
        svg(
          W,
          16,
          Array.from({ length: 18 }, (_, i) => i * 8)
            .flatMap((x) => [x, W - x - 5])
            .filter((x) => x < mid - 20 || x > mid + 15)
            .map(
              (x) =>
                `<rect x="${x}" y="8" width="5" height="1" fill="${accent}" fill-opacity="0.55"/>`
            )
            .join('') +
            `<g transform="translate(${mid - 8} 0)"><path d="${PATHS.pen}" fill="${accent}" fill-rule="evenodd"/><path d="${PATHS.penCap}" fill="${accent}"/></g>`
        )
      );
    case 'ribbon':
      return wrap(
        svg(
          W,
          24,
          `<rect x="0" y="11" width="${mid - 44}" height="1" fill="${accent}" fill-opacity="0.35"/><rect x="${mid + 44}" y="11" width="${mid - 44}" height="1" fill="${accent}" fill-opacity="0.35"/>` +
            `<g transform="translate(${mid - 36} 0)"><path d="M2 8H18V22H2L7 15Z" fill="${darken(accent, 0.2)}" fill-opacity="0.75"/><path d="M70 8H54V22H70L65 15Z" fill="${darken(accent, 0.2)}" fill-opacity="0.75"/><path d="M12 18L18 22V18Z" fill="${darken(accent, 0.45)}"/><path d="M60 18L54 22V18Z" fill="${darken(accent, 0.45)}"/><path d="M12 3H60V18H12Z" fill="${accent}"/></g>`
        )
      );
    case 'ink':
      return wrap(
        svg(
          240,
          16,
          `<g transform="scale(0.8)"><path d="${PATHS.ink}" fill="${accent}" fill-opacity="0.88" fill-rule="evenodd"/><circle cx="287" cy="15.5" r="1.1" fill="${accent}"/><circle cx="293" cy="13.8" r="0.7" fill="${accent}"/></g>`
        )
      );
    case 'end': {
      const side = (dir: 'in' | 'out') =>
        svg(
          64,
          2,
          fadeLine(0, 64, accent, 0.6, 0, 1, dir),
          css({ display: 'inline-block', verticalAlign: 'middle', width: '64px', height: '2px' })
        );
      return tag(
        'section',
        css({ margin: last ? '28px 0 0' : '28px 0', textAlign: 'center', lineHeight: 1 }),
        `${side('in')}${tag('span', css({ display: 'inline-block', margin: '0 10px 0 14px', verticalAlign: 'middle', fontSize: '12px', fontWeight: 700, letterSpacing: '4px', color: accent }), 'END')}${side('out')}`
      );
    }
    case 'chenji':
      return wrap(
        svg(
          W,
          20,
          fadeLine(0, mid - 22, accent, 0.45, 10, 1, 'in') +
            fadeLine(mid + 22, W, accent, 0.45, 10, 1, 'out') +
            `<g transform="translate(${mid - 9} 1) scale(0.18)"><path d="${PATHS.chenji}" fill="${accent}" fill-rule="evenodd"/></g>`
        )
      );
    case 'line':
    default:
      return wrap(svg(W, 2, `<rect x="0" y="0" width="${W}" height="1" fill="${line}"/>`));
  }
}

/* ------------------------------------------------------------------------ */
/* entry                                                                    */
/* ------------------------------------------------------------------------ */

function makeCtx(opts: WechatOptions): Ctx {
  const accent = safeColor(opts.accent)?.startsWith('#') ? opts.accent! : '#6918b4';
  const accent2 = safeColor(opts.accent2)?.startsWith('#') ? opts.accent2! : '#6a5ef0';
  return withTheme(opts, {
    o: { dividerMode: 'svg', fontSize: 15, linksTitle: '参考链接', ...opts },
    c: {
      accent,
      accent2,
      rose: '#ff6b8b',
      amber: '#f5a524',
      ink: '#333333',
      heading: '#1f1f1f',
      muted: '#999999',
      line: '#e5e5e5',
    },
    images: [],
    links: [],
    counters: {},
    dark: false,
  });
}

/**
 * Converts a note to HTML the 公众号 editor keeps: one root `<section>` with
 * the body typography, every block styled inline, ornamental dividers as
 * inline SVG and external links collected into a reference list.
 */
export function convertWechat(json: TiptapJSON, opts: WechatOptions = {}): WechatResult {
  const source: TiptapJSON = json && typeof json === 'object' ? json : { type: 'doc', content: [] };
  const maskOpts = resolveMask(opts.mask);
  const masked = maskOpts ? maskTree(source, maskOpts) : null;
  const out = convertWechatTree(masked ? masked.json : source, opts);
  if (maskOpts?.preview && masked?.hits.length)
    out.html = maskPreviewHtml(convertWechatTree(source, opts).html, maskOpts);
  const report: ReportItem[] = [];
  const maskSummary: MaskSummary | undefined = masked
    ? { count: masked.hits.length, hits: masked.hits }
    : undefined;
  report.push(...maskReport(maskSummary, opts.lang));
  const mobile =
    opts.mobile === undefined || opts.mobile === true ? mobileOptionsFor('wechat') : opts.mobile;
  if (mobile) {
    const m = mobileHtml(out.html, opts.lang ? { ...mobile, lang: opts.lang } : mobile);
    out.html = m.html;
    report.push(...m.report);
  }
  return {
    ...out,
    ...(maskSummary ? { masked: maskSummary } : {}),
    ...(report.length ? { report } : {}),
  };
}

function convertWechatTree(root: TiptapJSON, opts: WechatOptions): WechatResult {
  const ctx = makeCtx(opts);
  const body = blocksWx(root.type === 'doc' ? root.content : [root], ctx);
  let refs = '';
  if (ctx.links.length) {
    refs =
      dividerWx('fade', undefined, ctx, false) +
      tag(
        'p',
        css({ margin: '0 0 8px', fontSize: '13px', fontWeight: 700, color: '#666666' }),
        escapeHtml(ctx.o.linksTitle)
      ) +
      ctx.links
        .map((l, i) =>
          tag(
            'p',
            css({
              margin: '0 0 4px',
              fontSize: '12px',
              lineHeight: 1.6,
              color: '#888888',
              wordBreak: 'break-all',
            }),
            `[${i + 1}] ${escapeHtml(l.text)}: ${escapeHtml(l.href)}`
          )
        )
        .join('');
  }
  const html = tag(
    'section',
    css({
      fontSize: `${ctx.o.fontSize}px`,
      lineHeight: 1.75,
      color: ctx.c.ink,
      letterSpacing: '0.5px',
      wordBreak: 'break-word',
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
      ...themeRootCss(ctx),
    }),
    body + refs
  );
  return { html, images: ctx.images, links: ctx.links };
}

/* ------------------------------------------------------------------------ */
/* article themes (CONTRACTS-r9 §1)                                          */
/* ------------------------------------------------------------------------ */
/*
 * `opts.theme` restyles only the plain blocks (headings / quotes without a variant, plain dividers,
 * captions, paragraphs) and the palette. The same looks are written in CSS by the editor SDK's
 * `src/styles/themes.scss`; keep the two in step. Without a theme every helper returns
 * `undefined` / `{}` and the output is unchanged.
 */

const CTX_THEMES = new WeakMap<Ctx, ArticleTheme>();

/** Cards whose corner radius follows the theme (the others keep their speech-bubble / tab shapes). */
const THEMED_CARDS = new Set(['soft', 'outline', 'shadow', 'accent', 'ticket', 'dark']);

/** Attaches `opts.theme` to a new context: palette and body size, unless given explicitly. */
function withTheme(opts: WechatOptions, ctx: Ctx): Ctx {
  const t = resolveArticleTheme(opts.theme);
  if (!t) return ctx;
  CTX_THEMES.set(ctx, t);
  if (!safeColor(opts.accent)?.startsWith('#')) ctx.c.accent = t.accent;
  if (!safeColor(opts.accent2)?.startsWith('#')) ctx.c.accent2 = t.accent2;
  ctx.c.ink = t.ink;
  ctx.c.heading = t.heading;
  ctx.c.muted = t.muted;
  if (typeof opts.fontSize !== 'number') ctx.o.fontSize = t.fontSize;
  return ctx;
}

/** Root `<section>` overrides: line height, letter spacing, justified text. */
function themeRootCss(ctx: Ctx): Record<string, string | number> {
  const t = CTX_THEMES.get(ctx);
  if (!t) return {};
  return {
    lineHeight: t.lineHeight,
    letterSpacing: `${t.letterSpacing}px`,
    ...(t.justify ? { textAlign: 'justify' } : {}),
  };
}

/** Paragraph style under a theme (justify is inherited from the root, so centred containers stay centred). */
function themePStyle(ctx: Ctx, last: boolean, align?: string): string | undefined {
  const t = CTX_THEMES.get(ctx);
  if (!t) return undefined;
  return css({
    margin: last ? '0' : `0 0 ${t.paragraphGap}px`,
    lineHeight: t.lineHeight,
    textAlign: align && ['center', 'right', 'justify'].includes(align) ? align : undefined,
  });
}

/** h2 / h3 without a variant, in the theme's look. */
function themeHeadingWx(
  h: string,
  level: number,
  text: string,
  ctx: Ctx,
  last: boolean
): string | undefined {
  const t = CTX_THEMES.get(ctx);
  if (!t || (level !== 2 && level !== 3)) return undefined;
  const { accent } = ctx.c;
  const color = ctx.dark ? '#ffffff' : ctx.c.heading;
  const margin =
    level === 2 ? (last ? '28px 0 0' : '28px 0 14px') : last ? '24px 0 0' : '24px 0 12px';
  const base = {
    margin,
    fontSize: `${t.fontSize + (level === 2 ? 4 : 2)}px`,
    fontWeight: 700,
    lineHeight: 1.5,
    color,
    letterSpacing: '0.5px',
  };
  if (level === 3) {
    switch (t.h3) {
      case 'accent':
        return tag(h, css({ ...base, color: ctx.dark ? '#ffffff' : accent }), text);
      case 'dot':
        return tag(
          h,
          css(base),
          svg(
            8,
            8,
            `<circle cx="4" cy="4" r="4" fill="${accent}"/>`,
            css({
              display: 'inline-block',
              verticalAlign: 'middle',
              width: '8px',
              height: '8px',
              marginRight: '8px',
            })
          ) + text
        );
      case 'plain':
      default:
        return tag(h, css(base), text);
    }
  }
  switch (t.h2) {
    case 'bar':
      return tag(
        h,
        css({ ...base, padding: '2px 0 2px 12px', borderLeft: `4px solid ${accent}` }),
        text
      );
    case 'tag':
      return tag(
        h,
        css(base),
        tag(
          'span',
          css({
            display: 'inline-block',
            padding: '4px 14px',
            borderRadius: '4px',
            backgroundColor: accent,
            color: '#ffffff',
          }),
          text
        )
      );
    case 'center':
      return tag(
        'section',
        css({ margin }),
        tag(h, css({ ...base, margin: '0', textAlign: 'center' }), text) +
          svg(
            28,
            3,
            `<rect x="0" y="0" width="28" height="3" rx="1.5" fill="${accent}"/>`,
            css({ display: 'block', margin: '10px auto 0', width: '28px', height: '3px' })
          )
      );
    case 'underline': {
      const hair = rgba(t.heading, 0.15);
      return tag(
        h,
        css({
          ...base,
          paddingBottom: '10px',
          backgroundImage: `linear-gradient(${accent}, ${accent}), linear-gradient(${hair}, ${hair})`,
          backgroundSize: '48px 3px, 100% 1px',
          backgroundPosition: 'left bottom, left bottom',
          backgroundRepeat: 'no-repeat',
        }),
        text
      );
    }
    case 'soft':
    default:
      return tag(
        h,
        css({
          ...base,
          padding: '6px 14px',
          borderRadius: '8px',
          backgroundColor: rgba(accent, 0.1),
          color: ctx.dark ? '#ffffff' : darken(accent, 0.25),
        }),
        text
      );
  }
}

/** A quote without a variant, in the theme's look. */
function themeQuoteWx(body: string, ctx: Ctx, last: boolean): string | undefined {
  const t = CTX_THEMES.get(ctx);
  if (!t) return undefined;
  const { accent } = ctx.c;
  const margin = last ? '20px 0 0' : '20px 0';
  const r = `${t.cardRadius}px`;
  switch (t.quote) {
    case 'line':
      return tag(
        'section',
        css({
          margin,
          padding: '4px 0 4px 14px',
          borderLeft: `3px solid ${accent}`,
          color: ctx.dark ? '#f3eefe' : mix(t.ink, t.muted, 0.5),
        }),
        body
      );
    case 'card':
      return tag(
        'section',
        css({ margin, padding: '14px 18px', borderRadius: r, backgroundColor: rgba(accent, 0.06) }),
        body
      );
    case 'center':
      return tag(
        'section',
        css({
          margin,
          padding: '4px 24px',
          textAlign: 'center',
          fontSize: `${t.fontSize + 1}px`,
          color: ctx.dark ? '#ffffff' : darken(accent, 0.1),
        }),
        body
      );
    case 'rule':
      return tag(
        'section',
        css({
          margin,
          padding: '12px 4px',
          borderTop: `1px solid ${t.heading}`,
          borderBottom: `1px solid ${t.heading}`,
          fontSize: `${t.fontSize + 1}px`,
          color: ctx.dark ? '#ffffff' : t.heading,
        }),
        body
      );
    case 'soft':
    default:
      return tag(
        'section',
        css({
          margin,
          padding: '12px 16px',
          borderLeft: `4px solid ${rgba(accent, 0.45)}`,
          borderRadius: `0 ${r} ${r} 0`,
          backgroundColor: rgba(accent, 0.08),
        }),
        body
      );
  }
}

/** A plain divider (`horizontalRule`, or `divider` of variant `line`) in the theme's look. */
function themeHrWx(ctx: Ctx, last: boolean, variant = 'line'): string | undefined {
  const t = CTX_THEMES.get(ctx);
  if (!t || variant !== 'line') return undefined;
  const { accent, accent2 } = ctx.c;
  const W = 320;
  const mid = W / 2;
  let drawing: string;
  switch (t.hr) {
    case 'short':
      drawing = svg(
        W,
        2,
        `<rect x="${mid - 24}" y="0" width="48" height="2" rx="1" fill="${accent}"/>`
      );
      break;
    case 'gradient':
      drawing = svg(
        W,
        2,
        segments(0, W, 40, 2, (x) => {
          const color = mix(accent, accent2, Math.min(1, Math.max(0, (x - 0.3) / 0.4)));
          const alpha = x < 0.3 ? x / 0.3 : x > 0.7 ? (1 - x) / 0.3 : 1;
          return [color, alpha];
        })
      );
      break;
    case 'dots':
      drawing = svg(
        48,
        6,
        [8, 24, 40]
          .map((x) => `<circle cx="${x}" cy="3" r="2.5" fill="${accent}" fill-opacity="0.7"/>`)
          .join('')
      );
      break;
    case 'double':
      drawing = svg(
        W,
        5,
        `<rect x="0" y="0" width="${W}" height="1" fill="${t.heading}"/><rect x="0" y="4" width="${W}" height="1" fill="${t.heading}"/>`
      );
      break;
    case 'dashed':
    default:
      drawing = svg(
        W,
        1,
        Array.from(
          { length: W / 10 },
          (_, i) =>
            `<rect x="${i * 10}" y="0" width="6" height="1" fill="${accent}" fill-opacity="0.5"/>`
        ).join('')
      );
  }
  return tag(
    'section',
    css({ margin: last ? '28px 0 0' : '28px 0', textAlign: 'center', lineHeight: 0 }),
    drawing
  );
}

/** Image caption style under a theme. */
function themeCaptionCss(ctx: Ctx, last: boolean): string | undefined {
  const t = CTX_THEMES.get(ctx);
  if (!t) return undefined;
  return css({
    margin: last ? '0' : '0 0 16px',
    textAlign: t.caption.align,
    fontSize: `${t.caption.size}px`,
    lineHeight: 1.6,
    color: t.caption.color,
    fontStyle: t.caption.italic ? 'italic' : undefined,
  });
}

/** `{borderRadius}` for a card the theme rounds; `{}` otherwise. */
function themeCardRadius(ctx: Ctx, variant: string): Record<string, string> {
  const t = CTX_THEMES.get(ctx);
  return t && THEMED_CARDS.has(variant) ? { borderRadius: `${t.cardRadius}px` } : {};
}
