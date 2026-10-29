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
import { byLang, defineAdapter, mediaReport, visibleLinkOf } from '@starnote/publish-core';
import {
  absoluteUrl,
  codePoints,
  guard,
  helpError,
  linkCost,
  refIn,
  truncate,
} from '@starnote/publish-kit';
import { z } from 'zod';

import { msg } from './i18n';

import type {
  Adapter,
  AdapterPreview,
  CommonFormShape,
  Doc,
  PublishContent,
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
  SdkLang,
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

/** The form in a language (SPEC-r14 B5). */
export const instagramSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** Your own caption instead of title + summary. */
    caption: z.string().trim().max(5000).optional().describe(t.caption),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    include_tags: z.boolean().default(true).describe(t.includeTags),
    /** Links in captions are not clickable: we add it as plain text. */
    include_link: z.boolean().default(true).describe(t.includeLink),
    max_images: z
      .number()
      .int()
      .min(1)
      .max(INSTAGRAM_LIMITS.images)
      .default(INSTAGRAM_LIMITS.images)
      .describe(t.maxImages),
  });
});

export const instagramSchema = instagramSchemaFor('zh-CN');

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
  opts: { assetBase?: string; lang?: SdkLang } = {}
): InstagramRendered {
  const t = msg(opts.lang);
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('instagram', 'Instagram', content, common, opts.lang));
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
      text: t.imagesTrimmed(form.max_images, usable.length - picked.length),
      count: usable.length - picked.length,
    });
  if (dropped)
    report.push({
      kind: 'image.failed',
      level: 'warn',
      text: t.imagesSkipped(dropped),
      count: dropped,
    });
  const files = picked.map((p, i) => ({
    url: p.url,
    filename: `starnote-${String(i + 1).padStart(2, '0')}.${extOf(p.url, p.mime)}`,
    ...(p.mime ? { mime: p.mime } : {}),
  }));

  // caption
  const link = visibleLinkOf(content);
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
      text: t.tagsTrimmed(INSTAGRAM_LIMITS.hashtags),
    });
  const tail = [
    tags.map((t) => `#${t}`).join(' '),
    form.include_link && link ? `原文：${link}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  let body = [head, summary].filter(Boolean).join('\n\n');
  // a scheduled batch's link placeholder is budgeted at the real link's length (`linkCost`)
  const tailCost =
    codePoints(tail) +
    (form.include_link && link && tail.includes(link) ? linkCost(link) - codePoints(link) : 0);
  const room = INSTAGRAM_LIMITS.captionMax - (tail ? tailCost + 2 : 0);
  if (codePoints(body) > room) {
    body = truncate(body, Math.max(1, room));
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: t.captionTruncated(INSTAGRAM_LIMITS.captionMax),
    });
  }
  const caption = [body, tail].filter(Boolean).join('\n\n');
  if (form.include_link && link)
    report.push({
      kind: 'link.not-clickable',
      level: 'notice',
      text: t.linkNotClickable,
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
    text: t.handoff,
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

/** Computer: what the host shows next to the download button (`zh-CN`; `instagramManualSteps(lang)` for others). */
export const INSTAGRAM_MANUAL_STEPS = [
  '下载图片（按顺序命名 starnote-01、02…）',
  '复制文案',
  '在手机 Instagram App（或 instagram.com）新建帖子，按顺序选图并粘贴文案后发布',
] as const;

/** `INSTAGRAM_MANUAL_STEPS` in `lang` (SPEC-r14 B5). */
export function instagramManualSteps(lang?: SdkLang): readonly string[] {
  return msg(lang).manualSteps;
}

/* ---------------- adapter ---------------- */

export function instagramRef(links?: ErrorLinks): PlatformRef {
  return { key: 'instagram', label: 'Instagram', ...(links ? { links } : {}) };
}

export interface InstagramAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

const notes = (key: 'notePhone' | 'noteComputer' | 'noteDesktop') => ({
  note: msg('zh-CN')[key],
  notes: { 'zh-TW': msg('zh-TW')[key], en: msg('en')[key] },
});

export const INSTAGRAM_RUNTIMES: RuntimeSupport[] = [
  {
    runtime: 'web',
    mode: 'handoff',
    handoff: { via: 'web-share', url: INSTAGRAM_HOME },
    ...notes('notePhone'),
  },
  { runtime: 'web', mode: 'manual', ...notes('noteComputer') },
  { runtime: 'electron', mode: 'manual', ...notes('noteDesktop') },
];

export function createInstagramAdapter(
  opts: InstagramAdapterOptions = {}
): Adapter<typeof instagramSchema> {
  const ref = instagramRef(opts.links);
  const base = opts.assetBase ? { assetBase: opts.assetBase } : {};
  const renderOpts = (lang?: SdkLang) => ({ ...base, ...(lang ? { lang } : {}) });
  return defineAdapter({
    key: 'instagram',
    label: 'Instagram',
    runtimes: opts.runtimes ?? INSTAGRAM_RUNTIMES,
    contentTypes: ['image-set', 'article'],
    binding: { kind: 'none', store: 'none' },
    capabilities: { supportsUpdate: false, needsLogin: false },
    schema: instagramSchema,
    schemaFor: instagramSchemaFor,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderInstagram(doc, form, common, content, renderOpts(popts?.lang));
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
        const r = renderInstagram(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        if (!r.files.length)
          throw helpError(refIn(ref, ctx.lang), t.needsImage, { code: 'invalid' });
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 100, text: t.ready });
        return { url: '', state: 'handoff' as const, report: r.report, handoff: r.handoff };
      });
    },
  });
}
