/**
 * Phone-first output for `mobileFirst` platforms (公众号、小红书、知乎、头条号…, see the registry): images fit the
 * screen width (`max-width:100%; height:auto`, fixed sizes dropped; a narrower picture keeps its size — or, where the
 * platform's editor stretches pictures anyway (公众号: `imageWidth: 'fill'`), `width:100%`), tables go into a horizontally scrolling box —
 * or, where the platform strips such boxes (公众号: `scrollContainers: false`), a wide table (more than
 * `cardColumns` columns) becomes one card per row. Works on any converter's HTML (`convert`, `convertWechat`).
 */
import { escapeHtml } from './convert';
import { platformMeta } from './platforms';

import { coreMessages } from './i18n/messages';

import type { SdkLang } from './i18n/lang';
import type { ReportItem } from './report';

export interface MobileOptions {
  /** The platform keeps `overflow-x: auto` containers. Default true. */
  scrollTables?: boolean;
  /** Tables with more columns than this become cards when they cannot scroll. Default 4. */
  cardColumns?: number;
  /**
   * `fit` (default): `max-width:100%; height:auto` — a picture narrower than the column keeps its own size.
   * `fill`: `width:100%; height:auto` — for editors that stretch pictures to the column (公众号).
   */
  imageWidth?: 'fit' | 'fill';
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang;
}

export interface MobileResult {
  html: string;
  report: ReportItem[];
  counts: { images: number; scrolled: number; cards: number };
}

/** `convert`'s `mobile` option for a platform key: `false` when it is not mobile-first. */
export function mobileOptionsFor(platform: string): MobileOptions | false {
  const p = platformMeta(platform);
  if (!p?.mobileFirst) return false;
  return { scrollTables: p.scrollContainers !== false, imageWidth: p.imageWidth ?? 'fit' };
}

const IMG_RE = /<img\b[^>]*>/gi;
const TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi;

function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
}

/** Drops `width` / `height` / `max-width` declarations and appends the phone sizing. */
function phoneStyle(style: string | undefined, imageWidth: 'fit' | 'fill'): string {
  const kept = (style ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^(width|height|max-width|min-width|max-height)\s*:/i.test(d));
  return [...kept, imageWidth === 'fill' ? 'width:100%' : 'max-width:100%', 'height:auto'].join(
    ';'
  );
}

function phoneImage(tag: string, imageWidth: 'fit' | 'fill'): string {
  const style = attrValue(tag, 'style');
  const stripped = tag
    .replace(/\s(width|height|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s*\/?>$/, '');
  return `${stripped} style="${escapeHtml(phoneStyle(style, imageWidth))}">`;
}

interface Cell {
  header: boolean;
  html: string;
  span: number;
}

function rowsOf(table: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const tr of table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: Cell[] = [];
    const re = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tr))) {
      const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(m[2] ?? '')?.[1] ?? 1) || 1;
      // a cell's single paragraph is unwrapped (the card line is the paragraph)
      const html = (m[3] ?? '').trim().replace(/^<p\b[^>]*>([\s\S]*?)<\/p>$/i, '$1');
      cells.push({ header: m[1]!.toLowerCase() === 'th', html, span });
    }
    rows.push(cells);
  }
  return rows;
}

const CARD = 'margin:0 0 12px;padding:10px 12px;border:1px solid #e6e6e6;border-radius:8px;';
const CARD_LINE = 'margin:0 0 4px;line-height:1.6;';

/** One card per data row: 「列名：值」 lines; the first row is the header when it is all `<th>`. */
function tableCards(rows: Cell[][]): string {
  const first = rows[0] ?? [];
  const hasHeader = first.length > 0 && first.every((c) => c.header);
  const names = hasHeader ? first.map((c) => c.html.replace(/<[^>]+>/g, '').trim()) : [];
  const data = hasHeader ? rows.slice(1) : rows;
  const cards = data
    .filter((r) => r.length)
    .map(
      (r) =>
        `<section class="sn-table-card" style="${CARD}">${r
          .map((c, i) => {
            const name = names[i] || `第 ${i + 1} 列`;
            return `<p style="${CARD_LINE}"><strong>${escapeHtml(name)}</strong>：${c.html || '—'}</p>`;
          })
          .join('')}</section>`
    )
    .join('');
  return `<section class="sn-table-cards">${cards}</section>`;
}

/** Phone-first HTML and a report of what changed. Idempotent on its own output. */
export function mobileHtml(html: string, opts: MobileOptions = {}): MobileResult {
  const scroll = opts.scrollTables !== false;
  const maxCols = opts.cardColumns ?? 4;
  const imageWidth = opts.imageWidth ?? 'fit';
  const counts = { images: 0, scrolled: 0, cards: 0 };
  let out = html.replace(IMG_RE, (tag) => {
    counts.images += 1;
    return phoneImage(tag, imageWidth);
  });
  out = out.replace(TABLE_RE, (table, offset: number, all: string) => {
    const before = all.slice(Math.max(0, offset - 160), offset);
    if (/class="sn-table-scroll"[^>]*>\s*$/.test(before)) return table;
    const rows = rowsOf(table);
    const cols = Math.max(0, ...rows.map((r) => r.reduce((n, c) => n + c.span, 0)));
    if (!scroll && cols > maxCols) {
      counts.cards += 1;
      return tableCards(rows);
    }
    if (!scroll) return table;
    counts.scrolled += 1;
    return `<div class="sn-table-scroll" style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;">${table}</div>`;
  });
  const report: ReportItem[] = [];
  const m = coreMessages(opts.lang).mobile;
  if (counts.images)
    report.push({
      kind: 'mobile.images',
      text: imageWidth === 'fill' ? m.imagesFill(counts.images) : m.imagesFit(counts.images),
      count: counts.images,
    });
  if (counts.scrolled)
    report.push({
      kind: 'mobile.table-scroll',
      text: m.tableScroll(counts.scrolled),
      count: counts.scrolled,
    });
  if (counts.cards)
    report.push({
      kind: 'mobile.table-cards',
      level: 'notice',
      text: m.tableCards(counts.cards, maxCols),
      count: counts.cards,
    });
  return { html: out, report, counts };
}
