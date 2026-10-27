/**
 * Media limits per platform (SPEC-r12 §3): what a platform accepts for the cover, images and videos, and
 * `checkMedia`, the pure check the publish panel's checklist and the adapters' renderers run before publishing.
 *
 * Values come from the platforms' official documentation where we found it; ⚠️ marks numbers that are not from an
 * official page (help-centre answers, editor behaviour, common practice) or not checked with a real account. What we
 * could not find is left out — a missing limit is never checked. The registry carries them as
 * `PlatformMeta.limits.media`, so hosts can check platforms whose adapter is not loaded (小红书 has none).
 */
import type { MediaAsset, PublishContent } from './content';
import type { PlatformKey } from './platforms';
import type { ReportItem } from './report';
import type { CommonFormShape } from './types';

/** Width ÷ height. */
export interface AspectRange {
  min?: number;
  max?: number;
  /**
   * A recommendation, not a rule: outside it the platform crops or letterboxes, so the check is a `warn` instead
   * of an `error`. `min === max` names one recommended ratio.
   */
  soft?: boolean;
}

export interface MediaLimits {
  image?: {
    maxBytes?: number;
    /** Lower-case file types without the dot (`jpeg` covers `jpg`). */
    formats?: string[];
    maxCount?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    aspect?: AspectRange;
  };
  video?: {
    maxBytes?: number;
    formats?: string[];
    maxSeconds?: number;
    minSeconds?: number;
    aspect?: AspectRange;
  };
  /**
   * The cover, checked only against these rules (never the image rules: most platforms do not upload it). Platforms
   * that post the cover as an image (Instagram, Pinterest, Telegram's photo) name its format / size here too.
   */
  cover?: {
    minWidth?: number;
    minHeight?: number;
    aspect?: AspectRange;
    maxBytes?: number;
    formats?: string[];
    maxWidth?: number;
    maxHeight?: number;
  };
}

/** One file to check. Unknown fields are not checked. */
export interface MediaItem {
  role: 'cover' | 'image' | 'video';
  bytes?: number;
  width?: number;
  height?: number;
  /** `jpeg`, `image/png`, `photo.webp`… — normalized by `checkMedia`. */
  format?: string;
  seconds?: number;
}

const KB = 1024;
const MB = 1024 * 1024;

/**
 * Per platform. Registry keys (`wechat` is 公众号). Sources are named next to each entry; ⚠️ = not from an official
 * page or not verified with a real account (see the file comment).
 */
export const MEDIA_LIMITS: Partial<Record<PlatformKey, MediaLimits>> = {
  // DEV (developers.forem.com / editor guide): the cover shows at 1000×420 — recommended, DEV crops others.
  devto: { cover: { aspect: { min: 1000 / 420, max: 1000 / 420, soft: true } } },
  // ⚠️ Hashnode editor: cover recommended 1600×840; no upload limit documented.
  hashnode: { cover: { aspect: { min: 1600 / 840, max: 1600 / 840, soft: true } } },
  // Self-hosted WordPress: the upload size and types depend on the site (php.ini, plugins) ⚠️ — nothing checked.
  wordpress: {},
  // Ghost Admin API `images/upload`: WEBP, JPEG, GIF, PNG, SVG (docs). Size limit depends on the host ⚠️.
  ghost: { image: { formats: ['webp', 'jpeg', 'gif', 'png', 'svg'] } },
  // Mastodon defaults (MediaAttachment IMAGE_LIMIT 16 MB, VIDEO_LIMIT 99 MB; 4 attachments per status). Each instance
  // may change them (`/api/v2/instance` → `configuration.media_attachments`) ⚠️.
  mastodon: {
    image: { maxBytes: 16 * MB, maxCount: 4, formats: ['jpeg', 'png', 'gif', 'webp'] },
    video: { maxBytes: 99 * MB },
  },
  // Bluesky lexicons: `app.bsky.embed.images` 4 images, each ≤ 1,000,000 bytes ⚠️ (the PDS may compress);
  // `app.bsky.embed.video` ≤ 100,000,000 bytes; video up to 3 minutes ⚠️ (2025 announcement).
  bluesky: {
    image: { maxBytes: 1_000_000, maxCount: 4 },
    video: { maxBytes: 100_000_000, maxSeconds: 180 },
  },
  // Threads API (media specifications): images JPEG / PNG ≤ 8 MB, width 320–1440 (Threads scales outside that, so
  // only the scaling down is reported), ratio up to 10:1;
  // videos MOV / MP4 ≤ 1 GB, ≤ 5 min. Carousel 2–20 items ⚠️.
  threads: {
    image: {
      maxBytes: 8 * MB,
      formats: ['jpeg', 'png'],
      maxWidth: 1440,
      maxCount: 20,
      aspect: { min: 1 / 10, max: 10 },
    },
    video: { maxBytes: 1024 * MB, formats: ['mp4', 'mov'], maxSeconds: 300 },
  },
  // LinkedIn Images / Videos API: JPG, GIF, PNG; videos 3 s – 30 min, ≤ 500 MB ⚠️; multi-image posts 2–20 ⚠️.
  linkedin: {
    image: { formats: ['jpeg', 'png', 'gif'], maxCount: 20 },
    video: { maxBytes: 500 * MB, minSeconds: 3, maxSeconds: 30 * 60, formats: ['mp4'] },
  },
  // ⚠️ Graph API Page photos: JPEG, BMP, PNG, GIF, TIFF, under 4 MB (PNG under 1 MB recommended).
  facebook: { image: { maxBytes: 4 * MB, formats: ['jpeg', 'bmp', 'png', 'gif', 'tiff'] } },
  // Instagram content publishing (✅ developers.facebook.com): JPEG only, ≤ 8 MB, ratio 4:5 – 1.91:1, width
  // 320–1440 (Instagram scales outside that: only the scaling down is reported); carousels up to 10. Reels: MP4 / MOV, 3 s – 15 min, ≤ 300 MB ⚠️.
  instagram: {
    image: {
      maxBytes: 8 * MB,
      formats: ['jpeg'],
      maxCount: 10,
      maxWidth: 1440,
      aspect: { min: 4 / 5, max: 1.91 },
    },
    // the cover is the first image of the post
    cover: {
      maxBytes: 8 * MB,
      formats: ['jpeg'],
      maxWidth: 1440,
      aspect: { min: 4 / 5, max: 1.91 },
    },
    video: { formats: ['mp4', 'mov'], minSeconds: 3, maxSeconds: 15 * 60, maxBytes: 300 * MB },
  },
  // Pinterest product specs: BMP, JPEG, PNG, TIFF, WEBP, ≤ 20 MB ⚠️; 2:3 recommended (1000×1500).
  pinterest: {
    image: { maxBytes: 20 * MB, formats: ['bmp', 'jpeg', 'png', 'tiff', 'webp'] },
    // the cover is the Pin's image
    cover: {
      maxBytes: 20 * MB,
      formats: ['bmp', 'jpeg', 'png', 'tiff', 'webp'],
      aspect: { min: 2 / 3, max: 2 / 3, soft: true },
    },
  },
  // Telegram Bot API `sendPhoto`: ≤ 10 MB, width + height ≤ 10000, ratio ≤ 20; bots send files ≤ 50 MB; albums 2–10.
  telegram: {
    image: { maxBytes: 10 * MB, maxCount: 10, aspect: { min: 1 / 20, max: 20 } },
    cover: { maxBytes: 10 * MB, aspect: { min: 1 / 20, max: 20 } },
    video: { maxBytes: 50 * MB },
  },
  // Discord: 10 embeds / attachments per message. Webhook upload size (10 MB without boosts) ⚠️ — 辰记 posts image
  // links in embeds, nothing is uploaded.
  discord: { image: { maxCount: 10 } },
  // Slack Block Kit image block: png, jpg, jpeg, gif.
  slack: { image: { formats: ['png', 'jpeg', 'gif'] } },
  // ⚠️ Reddit help: images ≤ 20 MB, galleries up to 20; videos ≤ 1 GB, ≤ 15 min.
  reddit: {
    image: { maxBytes: 20 * MB, maxCount: 20 },
    video: { maxBytes: 1024 * MB, maxSeconds: 15 * 60 },
  },
  // Tumblr: no official numbers found ⚠️ — nothing checked.
  tumblr: {},
  // 公众号: 封面 2.35:1 (900×383, the editor crops) ✅; 素材库图片 bmp/png/jpeg/jpg/gif ≤ 10 MB (素材管理接口 ⚠️,
  // the editor's paste upload may differ).
  wechat: {
    image: { maxBytes: 10 * MB, formats: ['bmp', 'png', 'jpeg', 'gif'] },
    cover: { aspect: { min: 2.35, max: 2.35, soft: true } },
  },
  // 知乎 / CSDN: no published limits found ⚠️ — nothing checked.
  zhihu: {},
  csdn: {},
  // ⚠️ 掘金 editor: cover suggested 192×128 (3:2).
  juejin: { cover: { aspect: { min: 1.5, max: 1.5, soft: true } } },
  // ⚠️ 小红书 creator help: up to 18 images; 3:4 recommended (1:1 and 4:3 are cropped to fit).
  xiaohongshu: {
    image: { maxCount: 18, aspect: { min: 3 / 4, max: 4 / 3, soft: true } },
    cover: { aspect: { min: 3 / 4, max: 3 / 4, soft: true } },
  },
};

/** The limits of a platform (registry key), or `undefined` when none are known. */
export function mediaLimitsOf(platform: string): MediaLimits | undefined {
  return (MEDIA_LIMITS as Record<string, MediaLimits | undefined>)[platform];
}

/** Ratios within 1% count as equal (a 1000×421 cover is 1000:420). */
const TOLERANCE = 0.01;

const KNOWN_RATIOS: Array<[number, string]> = [
  [1, '1:1'],
  [4 / 5, '4:5'],
  [3 / 4, '3:4'],
  [4 / 3, '4:3'],
  [2 / 3, '2:3'],
  [3 / 2, '3:2'],
  [9 / 16, '9:16'],
  [16 / 9, '16:9'],
];

/** `0.8` → `4:5`, `1.91` → `1.91:1`. */
export function formatRatio(r: number): string {
  const known = KNOWN_RATIOS.find(([v]) => Math.abs(v - r) / v < TOLERANCE);
  if (known) return known[1];
  if (r < 1) return `1:${trim(1 / r)}`;
  return `${trim(r)}:1`;
}

function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function formatBytes(n: number): string {
  if (n >= MB) return `${trim(n / MB)} MB`;
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${n} B`;
}

/** `image/jpeg`, `JPG`, `a.jpg?x=1` → `jpeg`. */
export function mediaFormat(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let f = raw.trim().toLowerCase();
  if (f.includes('/')) f = f.split('/').pop()!;
  f = f.split(/[?#]/)[0]!;
  if (f.includes('.')) f = f.split('.').pop()!;
  f = f.replace(/^x-/, '').replace(/\+xml$/, '');
  if (f === 'jpg' || f === 'jpe' || f === 'pjpeg') return 'jpeg';
  if (f === 'tif') return 'tiff';
  if (f === 'quicktime') return 'mov';
  if (f === 'm4v') return 'mp4';
  return f || undefined;
}

const ROLE_NAME = { cover: '封面', image: '图片', video: '视频' } as const;

type Problem = 'count' | 'too_large' | 'format' | 'size' | 'aspect' | 'duration';

interface Finding {
  level: 'warn' | 'error';
  text: string;
  sample?: string;
}

/** Soft (recommended) ratios allow 1%; a platform's hard limit is exact (up to float noise). */
function inRange(r: number, range: AspectRange): boolean {
  const tol = range.soft ? TOLERANCE : 1e-9;
  if (range.min !== undefined && r < range.min * (1 - tol)) return false;
  if (range.max !== undefined && r > range.max * (1 + tol)) return false;
  return true;
}

function rangeText(range: AspectRange): string {
  const { min, max } = range;
  if (min !== undefined && max !== undefined)
    return Math.abs(min - max) / max < TOLERANCE
      ? `为 ${formatRatio(min)}`
      : `在 ${formatRatio(min)} 到 ${formatRatio(max)} 之间`;
  if (min !== undefined) return `不小于 ${formatRatio(min)}`;
  return `不大于 ${formatRatio(max!)}`;
}

/**
 * SPEC-r12 §3.1: checks files against a platform's limits. Pure; fields that are unknown on the item or not limited
 * by the platform are skipped. `warn`: the publish goes through but something is changed or looks off (an image
 * compressed or scaled down, a cover cropped to the recommended ratio, extra images left out); `error`: the platform
 * will refuse it (format, too small, ratio, video length / size). One report item per role and problem
 * (`media.{role}.{problem}`, e.g. `media.cover.aspect`), with `count` and up to 3 samples.
 */
export function checkMedia(
  limits: MediaLimits | undefined,
  items: readonly MediaItem[],
  opts: { platform?: string } = {}
): ReportItem[] {
  if (!limits) return [];
  const who = opts.platform ?? '平台';
  const found = new Map<string, { role: MediaItem['role']; problem: Problem; list: Finding[] }>();
  const add = (role: MediaItem['role'], problem: Problem, f: Finding) => {
    const key = `${role}.${problem}`;
    const entry = found.get(key) ?? { role, problem, list: [] };
    entry.list.push(f);
    found.set(key, entry);
  };

  const images = items.filter((i) => i.role === 'image');
  const maxCount = limits.image?.maxCount;
  if (maxCount !== undefined && images.length > maxCount)
    add('image', 'count', {
      level: 'warn',
      text: `${who} 最多 ${maxCount} 张图片，只会用前 ${maxCount} 张（共 ${images.length} 张）`,
    });

  const seen = { cover: 0, image: 0, video: 0 };
  for (const item of items) {
    const role = item.role;
    const name = ROLE_NAME[role];
    seen[role] += 1;
    const label = role === 'cover' ? name : `第 ${seen[role]} 个${name}`;
    const lim = role === 'video' ? limits.video : role === 'cover' ? limits.cover : limits.image;
    if (!lim) continue;
    const l = lim as NonNullable<MediaLimits['image']> & NonNullable<MediaLimits['video']>;

    if (l.maxBytes !== undefined && item.bytes !== undefined && item.bytes > l.maxBytes)
      add(role, 'too_large', {
        level: role === 'video' ? 'error' : 'warn',
        text:
          role === 'video'
            ? `${name}超过 ${who} 上限 ${formatBytes(l.maxBytes)}`
            : `${name}超过 ${who} 上限 ${formatBytes(l.maxBytes)}，会压缩后上传`,
        sample: `${label}：${formatBytes(item.bytes)}`,
      });

    const format = mediaFormat(item.format);
    if (l.formats?.length && format && !l.formats.includes(format))
      add(role, 'format', {
        level: 'error',
        text: `${who} 的${name}只支持 ${l.formats.map((f) => f.toUpperCase()).join(' / ')}`,
        sample: `${label}：${format.toUpperCase()}`,
      });

    const { width: w, height: h } = item;
    if (w !== undefined && h !== undefined && w > 0 && h > 0) {
      if (
        (l.minWidth !== undefined && w < l.minWidth) ||
        (l.minHeight !== undefined && h < l.minHeight)
      ) {
        const need =
          l.minWidth !== undefined && l.minHeight !== undefined
            ? `至少 ${l.minWidth}×${l.minHeight}`
            : l.minWidth !== undefined
              ? `宽至少 ${l.minWidth}`
              : `高至少 ${l.minHeight}`;
        add(role, 'size', {
          level: 'error',
          text: `${name}太小，${who} 要求${need}`,
          sample: `${label}：${w}×${h}`,
        });
      } else if (
        (l.maxWidth !== undefined && w > l.maxWidth) ||
        (l.maxHeight !== undefined && h > l.maxHeight)
      )
        add(role, 'size', {
          level: 'warn',
          text: `${name}超过 ${who} 的最大尺寸，会被缩小`,
          sample: `${label}：${w}×${h}`,
        });
      if (l.aspect && !inRange(w / h, l.aspect))
        add(role, 'aspect', {
          level: l.aspect.soft ? 'warn' : 'error',
          text: l.aspect.soft
            ? `${name}宽高比 ${formatRatio(w / h)}，${who} 建议宽高比${rangeText(l.aspect)}，可能会被裁切`
            : `${name}太${l.aspect.min !== undefined && w / h < l.aspect.min ? '窄' : '宽'}（${formatRatio(w / h)}），${who} 要求宽高比${rangeText(l.aspect)}`,
          sample: `${label}：${w}×${h}`,
        });
    }

    if (role === 'video' && item.seconds !== undefined) {
      if (l.maxSeconds !== undefined && item.seconds > l.maxSeconds)
        add(role, 'duration', {
          level: 'error',
          text: `视频超过 ${who} 时长上限 ${duration(l.maxSeconds)}`,
          sample: `${label}：${duration(item.seconds)}`,
        });
      else if (l.minSeconds !== undefined && item.seconds < l.minSeconds)
        add(role, 'duration', {
          level: 'error',
          text: `视频短于 ${who} 要求的 ${duration(l.minSeconds)}`,
          sample: `${label}：${duration(item.seconds)}`,
        });
    }
  }

  return [...found.values()].map(({ role, problem, list }) => {
    const level = list.some((f) => f.level === 'error') ? 'error' : 'warn';
    const first = list.find((f) => f.level === level)!;
    const samples = list.map((f) => f.sample).filter((s): s is string => !!s);
    return {
      kind: `media.${role}.${problem}`,
      level,
      text:
        list.length > 1 && problem !== 'count' ? `${first.text}（${list.length} 个）` : first.text,
      ...(problem !== 'count' ? { count: list.length } : {}),
      ...(samples.length ? { samples: samples.slice(0, 3) } : {}),
      detail: { role, problem },
    } satisfies ReportItem;
  });
}

function duration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

function itemOf(
  role: MediaItem['role'],
  a: Partial<MediaAsset> & { durationSec?: number }
): MediaItem {
  const format = mediaFormat(a.mime) ?? mediaFormat(a.url);
  return {
    role,
    ...(a.bytes !== undefined ? { bytes: a.bytes } : {}),
    ...(a.width !== undefined ? { width: a.width } : {}),
    ...(a.height !== undefined ? { height: a.height } : {}),
    ...(format ? { format } : {}),
    ...(a.durationSec !== undefined ? { seconds: a.durationSec } : {}),
  };
}

/**
 * The files a publish carries, with what is known about them: the cover (`common.coverMeta`), the image set's /
 * short post's images, the video and its cover. Article body images carry no metadata (only `Doc.images` URLs) and
 * are left out.
 */
export function mediaItemsOf(
  content: PublishContent | undefined,
  common: CommonFormShape = {}
): MediaItem[] {
  const out: MediaItem[] = [];
  if (common.coverMeta) out.push(itemOf('cover', common.coverMeta));
  if (content?.kind === 'image-set') for (const a of content.images) out.push(itemOf('image', a));
  if (content?.kind === 'short-text')
    for (const a of content.images ?? []) out.push(itemOf('image', a));
  if (content?.kind === 'video') {
    out.push(itemOf('video', content.video));
    if (content.cover) out.push(itemOf('cover', content.cover));
  }
  return out;
}

/**
 * What adapters merge into their render report: `checkMedia` with the platform's registry limits over
 * `mediaItemsOf(content, common)`.
 */
export function mediaReport(
  platform: string,
  label: string,
  content: PublishContent | undefined,
  common: CommonFormShape = {}
): ReportItem[] {
  return checkMedia(mediaLimitsOf(platform), mediaItemsOf(content, common), { platform: label });
}
