/**
 * The content pipeline (SPEC-r15 §2): one entry point that turns a note into what a platform's editor takes —
 * HTML (every ProseMirror / tiptap editor: paste `text/html`), Markdown (掘金, CSDN, 博客园, 语雀, 抖音 `.md`
 * import) or the 公众号's inline-styled HTML — and says what the host still has to do:
 *
 * - **rasters**: blocks the platform cannot show (formulas, merged tables, code blocks on editors without them)
 *   become image nodes `starnote-raster:<id>`; the host draws each job on a canvas, uploads it and calls
 *   `applyRasters` with the URLs (pure here: no canvas in core);
 * - **images**: `planImage` sizes every image for the platform (long edge, bytes, format) before upload;
 * - **watermark**: `watermarkPolicy` drops the QR code on platforms that forbid 导流二维码.
 *
 * Degrade order for a block: native → a close native form (callout → quote) → text → image. Every change is in
 * the report, so the user sees what happened. Profiles come from the 2026-10 hands-on checks
 * (`docs/platforms/`); a platform without one gets `DEFAULT_PROFILE` (portable HTML, nothing rasterized).
 */
import { convert } from './convert';
import { coreMessages } from './i18n/messages';
import { mediaLimitsOf } from './media';
import { degradeTree, rewriteImageSrcs } from './render-steps';
import { platformRules } from './rules';
import { convertWechat } from './wechat';

import type { SdkLang } from './i18n/lang';
import type { ReportItem } from './report';
import type { Doc, TiptapJSON } from './types';
import type { WechatOptions } from './wechat';

export type BodyFormat = 'html' | 'markdown' | 'wechat-html';

export interface ContentProfile {
  format: BodyFormat;
  /** `platform-image`: the adapter gives a URL per formula (知乎); `raster`: drawn by the host. */
  math: 'source' | 'platform-image' | 'raster';
  /** `merged-raster`: tables with merged cells become images, plain tables stay. */
  tables: 'keep' | 'merged-raster' | 'raster';
  /** `raster`: editors without code blocks (小红书长文, 抖音文章, 微博头条文章, 企鹅号). */
  code: 'keep' | 'raster';
  /** `text`: links stay as their text (platforms that strip or punish outbound links). */
  links: 'keep' | 'text';
  taskList: 'keep' | 'symbols';
}

const HTML: ContentProfile = {
  format: 'html',
  math: 'raster',
  tables: 'merged-raster',
  code: 'keep',
  links: 'keep',
  taskList: 'symbols',
};
const MARKDOWN: ContentProfile = {
  format: 'markdown',
  math: 'source',
  tables: 'keep',
  code: 'keep',
  links: 'keep',
  taskList: 'keep',
};

export const DEFAULT_PROFILE: ContentProfile = { ...HTML, math: 'source', tables: 'keep' };

/** Keys are registry keys plus the split targets (`xiaohongshu-article`, `douyin-article`, `weibo-article`). */
export const CONTENT_PROFILES: Readonly<Record<string, ContentProfile>> = {
  wechat: { ...HTML, format: 'wechat-html', tables: 'keep' },
  zhihu: { ...HTML, math: 'platform-image', tables: 'keep' },
  juejin: MARKDOWN,
  csdn: MARKDOWN,
  cnblogs: MARKDOWN,
  yuque: MARKDOWN,
  'douyin-article': {
    ...MARKDOWN,
    math: 'raster',
    code: 'raster',
    tables: 'raster',
    links: 'text',
  },
  jianshu: { ...HTML, links: 'keep' },
  toutiao: { ...HTML, tables: 'keep', links: 'text' },
  baijiahao: { ...HTML, links: 'text' },
  bilibili: { ...HTML, links: 'text' },
  'xiaohongshu-article': { ...HTML, tables: 'raster', code: 'raster', links: 'text' },
  'weibo-article': { ...HTML, tables: 'raster', code: 'raster' },
  sohu: HTML,
  'qq-om': { ...HTML, code: 'raster' },
  netease: { ...HTML, tables: 'raster', code: 'raster' },
};

export function contentProfileOf(platform: string): ContentProfile {
  return CONTENT_PROFILES[platform] ?? DEFAULT_PROFILE;
}

// ---------------------------------------------------------------------------
// Rasters
// ---------------------------------------------------------------------------

export const RASTER_SCHEME = 'starnote-raster:';

export type RasterJob =
  | { id: string; kind: 'math'; tex: string; display: boolean }
  | { id: string; kind: 'table'; html: string }
  | { id: string; kind: 'code'; code: string; language?: string };

/** A job before it gets its id (distributes over the union, so each kind keeps its own fields). */
type RasterInput = RasterJob extends infer J
  ? J extends RasterJob
    ? Omit<J, 'id'>
    : never
  : never;

const rasterNode = (id: string, alt: string): TiptapJSON => ({
  type: 'image',
  attrs: { src: `${RASTER_SCHEME}${id}`, alt },
});

function textOf(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

function hasMergedCells(table: TiptapJSON): boolean {
  return (table.content ?? []).some((row) =>
    (row.content ?? []).some((c) => Number(c.attrs?.colspan) > 1 || Number(c.attrs?.rowspan) > 1)
  );
}

/** Pure: replaces what the profile cannot show by raster placeholders and links by their text. */
export function extractRasters(
  json: TiptapJSON,
  profile: ContentProfile
): { json: TiptapJSON; jobs: RasterJob[]; linksTextified: number } {
  const jobs: RasterJob[] = [];
  let linksTextified = 0;
  const next = (job: RasterInput): string => {
    const id = `r${jobs.length + 1}`;
    jobs.push({ id, ...job } as RasterJob);
    return id;
  };
  const walk = (node: TiptapJSON, parent: TiptapJSON | null): TiptapJSON => {
    const a = node.attrs ?? {};
    if (node.type === 'katex' && profile.math === 'raster') {
      const tex = String(a.text ?? '');
      const display = parent?.type === 'doc' || a.display === true;
      return rasterNode(next({ kind: 'math', tex, display }), tex);
    }
    if (
      node.type === 'table' &&
      (profile.tables === 'raster' || (profile.tables === 'merged-raster' && hasMergedCells(node)))
    ) {
      const html = convert({ type: 'doc', content: [node] }).portableHtml;
      return rasterNode(next({ kind: 'table', html }), textOf(node).slice(0, 60));
    }
    if (node.type === 'codeBlock' && profile.code === 'raster') {
      const code = textOf(node);
      const language = typeof a.language === 'string' && a.language ? a.language : undefined;
      return rasterNode(
        next({ kind: 'code', code, ...(language ? { language } : {}) }),
        language ? `${language} code` : 'code'
      );
    }
    if (
      node.type === 'text' &&
      profile.links === 'text' &&
      node.marks?.some((m) => m.type === 'link')
    ) {
      linksTextified++;
      const marks = node.marks.filter((m) => m.type !== 'link');
      return marks.length ? { ...node, marks } : { type: 'text', text: node.text ?? '' };
    }
    return node.content ? { ...node, content: node.content.map((c) => walk(c, node)) } : node;
  };
  const root = json && typeof json === 'object' ? json : { type: 'doc', content: [] };
  return { json: walk(root, null), jobs, linksTextified };
}

/** The drawn rasters (`id` → uploaded URL) put back into the tree. Missing ids stay placeholders. */
export function applyRasters(json: TiptapJSON, urls: ReadonlyMap<string, string>): TiptapJSON {
  const map = new Map<string, string>();
  for (const [id, url] of urls) map.set(`${RASTER_SCHEME}${id}`, url);
  return rewriteImageSrcs(json, map);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface ImageFacts {
  width?: number;
  height?: number;
  bytes?: number;
  /** `jpeg`, `png`, `webp`, `gif`… */
  format?: string;
}

export interface ImagePlan {
  /** Resize to fit (keeps the ratio); absent = keep the size. */
  resize?: { width: number; height: number };
  /** Re-encode to this format; absent = keep the file as is. */
  format?: 'jpeg' | 'png' | 'webp';
  /** 0–1, for jpeg / webp. */
  quality?: number;
  maxBytes: number;
}

/** Long edge of a body image: enough for a phone screen at 2× and a desktop column. */
export const IMAGE_MAX_EDGE = 1920;
/** Upload size we aim for, under every platform's own limit. */
export const IMAGE_TARGET_BYTES = 2 * 1024 * 1024;

/**
 * How to prepare one body image for `platform` (the host does the decoding and encoding): fit the long edge,
 * re-encode what the platform does not take or what is too heavy (photos → jpeg 0.85; graphics with few colours
 * stay png), keep animated gifs when the platform takes gif.
 */
export function planImage(platform: string, facts: ImageFacts): ImagePlan {
  const limits = mediaLimitsOf(baseKey(platform))?.image;
  const maxBytes = Math.min(limits?.maxBytes ?? Infinity, IMAGE_TARGET_BYTES);
  const maxW = Math.min(limits?.maxWidth ?? IMAGE_MAX_EDGE, IMAGE_MAX_EDGE);
  const maxH = Math.min(limits?.maxHeight ?? IMAGE_MAX_EDGE, IMAGE_MAX_EDGE);
  const format = facts.format?.toLowerCase().replace('jpg', 'jpeg');
  const accepts = (f: string) => !limits?.formats || limits.formats.includes(f);
  const plan: ImagePlan = { maxBytes };
  if (facts.width && facts.height) {
    const scale = Math.min(1, maxW / facts.width, maxH / facts.height);
    if (scale < 1)
      plan.resize = {
        width: Math.max(1, Math.round(facts.width * scale)),
        height: Math.max(1, Math.round(facts.height * scale)),
      };
  }
  if (format === 'gif' && accepts('gif')) return plan;
  const tooHeavy = facts.bytes !== undefined && facts.bytes > maxBytes;
  if (
    !format ||
    !accepts(format) ||
    format === 'bmp' ||
    format === 'tiff' ||
    format === 'heic' ||
    tooHeavy
  ) {
    plan.format = format === 'png' && accepts('png') && !tooHeavy ? 'png' : 'jpeg';
    if (plan.format === 'jpeg') plan.quality = 0.85;
  } else if (plan.resize && (format === 'jpeg' || format === 'webp')) {
    plan.format = format;
    plan.quality = 0.85;
  }
  return plan;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** 「我们帮你做了什么」 for the images the host prepared with `planImage` (only the ones it changed). */
export function imagesReport(
  done: ReadonlyArray<{ beforeBytes?: number; afterBytes?: number }>,
  lang?: SdkLang
): ReportItem[] {
  if (!done.length) return [];
  const saved = done.reduce(
    (sum, d) => sum + Math.max(0, (d.beforeBytes ?? 0) - (d.afterBytes ?? d.beforeBytes ?? 0)),
    0
  );
  return [
    {
      kind: 'image.optimized',
      text: coreMessages(lang).pipeline.imagesOptimized(
        done.length,
        saved > 0 ? formatBytes(saved) : ''
      ),
      count: done.length,
      level: 'info',
    },
  ];
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

/** 辰记's image watermark: the QR code is left out where 导流二维码 are forbidden (`PlatformRules.noQrcode`). */
export function watermarkPolicy(platform: string): { qrcode: boolean } {
  return { qrcode: !platformRules(baseKey(platform))?.noQrcode };
}

/** `xiaohongshu-article` → `xiaohongshu`: the split targets share the platform's rules and media limits. */
export function baseKey(platform: string): string {
  return platform.replace(/-article$/, '');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  /** Drops a leading h1 equal to the title (platforms show the title themselves). Default `doc.title`. */
  title?: string;
  /** `math: 'platform-image'`: the platform's formula image URL (知乎 `equation?tex=`). */
  mathImageUrl?: (tex: string) => string;
  /** Options for the 公众号 serializer (theme, asset base, mask…). */
  wechat?: WechatOptions;
  lang?: SdkLang;
}

export interface PipelineResult {
  format: BodyFormat;
  /** HTML or Markdown to put into the platform editor. Raster placeholders stay until `finish`. */
  body: string;
  /** The tree the body came from (after degrade and raster extraction). */
  json: TiptapJSON;
  /** Images to upload, in document order, without raster placeholders. */
  images: string[];
  rasters: RasterJob[];
  watermark: { qrcode: boolean };
  report: ReportItem[];
  /** Re-renders with the rasters drawn and the images uploaded (`src` → platform URL). */
  finish(urls: {
    rasters?: ReadonlyMap<string, string>;
    images?: ReadonlyMap<string, string>;
  }): string;
}

function serialize(
  format: BodyFormat,
  json: TiptapJSON,
  opts: PipelineOptions
): { body: string; images: string[] } {
  if (format === 'wechat-html') {
    const out = convertWechat(json, { ...(opts.lang ? { lang: opts.lang } : {}), ...opts.wechat });
    return { body: out.html, images: out.images };
  }
  const out = convert(json);
  return { body: format === 'markdown' ? out.markdown : out.portableHtml, images: out.images };
}

export function renderForPlatform(
  platform: string,
  doc: Doc,
  opts: PipelineOptions = {}
): PipelineResult {
  const profile = contentProfileOf(platform);
  const m = coreMessages(opts.lang).pipeline;
  const report: ReportItem[] = [];
  // rasters first: what becomes an image is not degraded (and not reported as 「kept, may look misaligned」)
  const extracted = extractRasters(doc.json, profile);
  let json = extracted.json;
  // 公众号's serializer draws our blocks itself; everything else goes through the shared degrade steps
  if (profile.format !== 'wechat-html') {
    const mathPlatform = profile.math === 'platform-image' && opts.mathImageUrl;
    const degraded = degradeTree(json, {
      headings: { min: 2, max: 3 },
      dropTitleHeading: opts.title ?? doc.title,
      callouts: { style: profile.format === 'markdown' ? 'markdown' : 'html' },
      ...(mathPlatform
        ? { math: { mode: 'image', url: opts.mathImageUrl! } }
        : profile.math === 'source'
          ? { math: { mode: 'source' } }
          : {}),
      taskList: profile.taskList,
      flattenDetails: true,
      ...(opts.lang ? { lang: opts.lang } : {}),
    });
    json = degraded.json;
    report.push(...degraded.report);
  }
  const counts = { math: 0, table: 0, code: 0 };
  for (const j of extracted.jobs) counts[j.kind]++;
  if (extracted.jobs.length)
    report.push({
      kind: 'block.rasterized',
      text: m.rasterized(counts),
      count: extracted.jobs.length,
      level: 'info',
    });
  if (extracted.linksTextified)
    report.push({
      kind: 'link.textified',
      text: m.linksTextified(extracted.linksTextified),
      count: extracted.linksTextified,
      level: 'notice',
    });
  const watermark = watermarkPolicy(platform);
  if (!watermark.qrcode)
    report.push({ kind: 'watermark.no-qrcode', text: m.noQrcode, level: 'info' });

  const first = serialize(profile.format, json, opts);
  const images = first.images.filter((src) => !src.startsWith(RASTER_SCHEME));
  return {
    format: profile.format,
    body: first.body,
    json,
    images,
    rasters: extracted.jobs,
    watermark,
    report,
    finish(urls) {
      let tree = urls.rasters?.size ? applyRasters(json, urls.rasters) : json;
      if (urls.images?.size) tree = rewriteImageSrcs(tree, urls.images);
      return serialize(profile.format, tree, opts).body;
    },
  };
}
