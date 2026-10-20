/**
 * Instagram — hand-off only. The publishing API needs Meta App Review and a professional account, and there is no web
 * share link (✅ developers.facebook.com/docs/instagram-platform/sharing-to-feed: only an Android intent and the iOS
 * document interaction). So we prepare the images and the caption and the user finishes in the Instagram app:
 *
 * - **phone** (`web` + `env.mobile`): the system share sheet with the files (`navigator.share({ files, text })`, ✅ MDN:
 *   check `navigator.canShare({ files })` first, only from a user gesture over HTTPS); the user picks Instagram.
 *   ⚠️ 待核实：iOS Safari / Android Chrome 是否把图片和文案一起交给 Instagram（文案可能被丢弃，所以同时复制到剪贴板）;
 * - **computer** (web / desktop): download the images and copy the caption, then post from the phone or instagram.com.
 *
 * `publish` ends with `state: 'handoff'` and `handoff: { via: 'web-share', openUrl, copyText, files }`; the host runs
 * `shareToInstagram` (phone) or downloads `files` (computer) inside the user's click.
 */
import { defineAdapter } from '@starnote/publish-core';
import { absoluteUrl, codePoints, guard, helpError, truncate } from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  CommonFormShape,
  Doc,
  PublishContent,
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef } from '@starnote/publish-kit';

export const INSTAGRAM_LIMITS = {
  /** ⚠️ 待核实：App 内单帖最多 20 张（2024 起，仅新闻报道）；内容发布 API 写的是轮播 10 张。按 10 张准备。 */
  images: 10,
  /** ⚠️ 待核实：文案 2200 字符、话题 30 个（社区通行说法）。 */
  captionMax: 2200,
  hashtags: 30,
} as const;

export const INSTAGRAM_HOME = 'https://www.instagram.com/';

export const instagramSchema = z.object({
  /** Your own caption instead of title + summary. */
  caption: z.string().trim().max(5000).optional().describe('文案'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  /** Links in captions are not clickable: we add it as plain text. */
  include_link: z.boolean().default(true).describe('文末写上原文地址'),
  max_images: z
    .number()
    .int()
    .min(1)
    .max(INSTAGRAM_LIMITS.images)
    .default(INSTAGRAM_LIMITS.images)
    .describe('图片张数'),
});

export type InstagramForm = z.infer<typeof instagramSchema>;
export type InstagramFormInput = z.input<typeof instagramSchema>;

export interface InstagramFile {
  url: string;
  filename: string;
  mime?: string;
}

export interface InstagramRendered {
  caption: string;
  files: InstagramFile[];
  handoff: PublishHandoff;
  report: ReportItem[];
}

function extOf(url: string, mime?: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  const m = /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.exec(url);
  return m ? m[1]!.toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function hashtag(t: string): string | null {
  const w = t.replace(/[^\p{L}\p{N}_]+/gu, '');
  return w && !/^\d+$/.test(w) ? w : null;
}

/** Pure: the caption, the files to hand over and the report. */
export function renderInstagram(
  doc: Doc,
  form: InstagramForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): InstagramRendered {
  const report: ReportItem[] = [];
  const set = content?.kind === 'image-set' ? content : undefined;
  const article = content?.kind === 'article' ? content : undefined;
  const d = article?.doc ?? doc;

  // images: the image set as is; an article gives its cover first, then its body images
  const candidates: Array<{ url: string; mime?: string }> = set
    ? set.images.map((i) => ({ url: i.url, ...(i.mime ? { mime: i.mime } : {}) }))
    : [...(common.cover ? [{ url: common.cover }] : []), ...d.images.map((u) => ({ url: u }))];
  const seen = new Set<string>();
  const usable: Array<{ url: string; mime?: string }> = [];
  let dropped = 0;
  for (const c of candidates) {
    const abs = absoluteUrl(c.url, opts.assetBase);
    if (!abs) {
      dropped += 1;
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    usable.push({ url: abs, ...(c.mime ? { mime: c.mime } : {}) });
  }
  const picked = usable.slice(0, form.max_images);
  if (usable.length > picked.length)
    report.push({
      kind: 'image.trimmed',
      level: 'notice',
      text: `Instagram 单帖按 ${form.max_images} 张准备，去掉 ${usable.length - picked.length} 张`,
      count: usable.length - picked.length,
    });
  if (dropped)
    report.push({
      kind: 'image.failed',
      level: 'warn',
      text: `${dropped} 张图片没有可下载的地址，已跳过`,
      count: dropped,
    });
  const files = picked.map((p, i) => ({
    url: p.url,
    filename: `starnote-${String(i + 1).padStart(2, '0')}.${extOf(p.url, p.mime)}`,
    ...(p.mime ? { mime: p.mime } : {}),
  }));

  // caption
  const link = article?.canonicalUrl ?? set?.from?.canonicalUrl;
  const head = (form.caption || set?.caption || common.title || d.title || set?.title || '').trim();
  const summary =
    form.caption || set || !form.include_summary ? '' : (common.summary || d.summary || '').trim();
  const allTags = form.include_tags
    ? [
        ...new Set(
          [...(set?.topics ?? []), ...(common.tags ?? [])]
            .map(hashtag)
            .filter((t): t is string => !!t)
        ),
      ]
    : [];
  const tags = allTags.slice(0, INSTAGRAM_LIMITS.hashtags);
  if (allTags.length > tags.length)
    report.push({
      kind: 'tags.trimmed',
      text: `Instagram 最多 ${INSTAGRAM_LIMITS.hashtags} 个话题，已去掉多余的`,
    });
  const tail = [
    tags.map((t) => `#${t}`).join(' '),
    form.include_link && link ? `原文：${link}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  let body = [head, summary].filter(Boolean).join('\n\n');
  const room = INSTAGRAM_LIMITS.captionMax - (tail ? codePoints(tail) + 2 : 0);
  if (codePoints(body) > room) {
    body = truncate(body, Math.max(1, room));
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `文案超过 ${INSTAGRAM_LIMITS.captionMax} 字，已截短`,
    });
  }
  const caption = [body, tail].filter(Boolean).join('\n\n');
  if (form.include_link && link)
    report.push({
      kind: 'link.not-clickable',
      level: 'notice',
      text: 'Instagram 文案里的链接不能点，原文地址以文字附在文末（可放到个人主页链接）',
    });

  const handoff: PublishHandoff = {
    via: 'web-share',
    openUrl: INSTAGRAM_HOME,
    copyText: caption,
    files,
  };
  report.push({
    kind: 'handoff.pending',
    level: 'notice',
    text: '需要在 Instagram App 里完成发布：手机上用系统分享选 Instagram；电脑上下载图片并复制文案，再到手机或 instagram.com 发布',
    detail: { via: 'web-share', openUrl: INSTAGRAM_HOME, copyText: caption, files: files.length },
  });
  return { caption, files, handoff, report };
}

/* ---------------- running the hand-off (host side, inside the user's click) ---------------- */

interface ShareNavigator {
  share?: (data: { files?: File[]; text?: string; title?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/**
 * Fetches the files **before** the click (fetching inside it can outlive the user activation that `share` needs).
 * Same-origin 辰记 assets; anything that is not an image is skipped.
 */
export async function prepareInstagramFiles(
  files: readonly InstagramFile[],
  fetchImpl: typeof fetch = fetch
): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    const res = await fetchImpl(f.url, { credentials: 'omit' });
    if (!res.ok) continue;
    const blob = await res.blob();
    const type = f.mime ?? (blob.type || 'image/jpeg');
    if (!type.startsWith('image/')) continue;
    out.push(new File([blob], f.filename, { type }));
  }
  return out;
}

export type InstagramShareOutcome = 'shared' | 'cancelled' | 'unsupported';

/**
 * Phone: hand the prepared files and the caption to the share sheet. The caption is also copied first, since some
 * share targets drop `text` when files are attached. Call it directly in the click handler.
 */
export async function shareToInstagram(
  files: File[],
  caption: string,
  nav: ShareNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as ShareNavigator)
): Promise<InstagramShareOutcome> {
  if (!nav?.share || !files.length || (nav.canShare && !nav.canShare({ files })))
    return 'unsupported';
  try {
    await nav.clipboard?.writeText?.(caption);
  } catch {
    /* clipboard may be refused; the share still carries the text */
  }
  try {
    await nav.share({ files, text: caption });
    return 'shared';
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

/** Computer: what the host shows next to the download button. */
export const INSTAGRAM_MANUAL_STEPS = [
  '下载图片（按顺序命名 starnote-01、02…）',
  '复制文案',
  '在手机 Instagram App（或 instagram.com）新建帖子，按顺序选图并粘贴文案后发布',
] as const;

/* ---------------- adapter ---------------- */

export function instagramRef(links?: ErrorLinks): PlatformRef {
  return { key: 'instagram', label: 'Instagram', ...(links ? { links } : {}) };
}

export interface InstagramAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

export const INSTAGRAM_RUNTIMES: RuntimeSupport[] = [
  {
    runtime: 'web',
    mode: 'handoff',
    handoff: { via: 'web-share', url: INSTAGRAM_HOME },
    note: '手机：系统分享面板选 Instagram，在 App 里完成发布',
  },
  { runtime: 'web', mode: 'manual', note: '电脑：下载图片 + 复制文案' },
  { runtime: 'electron', mode: 'manual', note: '下载图片 + 复制文案' },
];

export function createInstagramAdapter(
  opts: InstagramAdapterOptions = {}
): Adapter<typeof instagramSchema> {
  const ref = instagramRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'instagram',
    label: 'Instagram',
    runtimes: opts.runtimes ?? INSTAGRAM_RUNTIMES,
    contentTypes: ['image-set', 'article'],
    binding: { kind: 'none', store: 'none' },
    capabilities: { supportsUpdate: false, needsLogin: false },
    schema: instagramSchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderInstagram(doc, form, common, content, renderOpts);
      return {
        format: 'files',
        title: common?.title || doc.title,
        body: r.caption,
        files: r.files.map((f) => ({ path: f.filename, content: f.url })),
        report: r.report,
      };
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderInstagram(doc, form, common, content, renderOpts);
        if (!r.files.length)
          throw helpError(ref, 'Instagram 帖子至少要 1 张图片：给笔记加封面或插图后再试', {
            code: 'invalid',
          });
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 100, text: '图片和文案已备好' });
        return { url: '', state: 'handoff' as const, report: r.report, handoff: r.handoff };
      });
    },
  });
}
