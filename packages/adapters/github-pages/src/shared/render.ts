import { escapeHtml } from '@starnote/publish-core';

import { GENERATOR, postFileName, postUrl, resolveLayout, siteBaseUrl } from './layout';

import { msg } from './i18n';

import type { CommonFormShape, Doc, ReportItem, SdkLang } from '@starnote/publish-core';
import type { GithubPagesLayout } from './layout';
import type { GithubPagesForm } from './schema';

export interface RenderPostInput {
  doc: Doc;
  form: GithubPagesForm;
  common?: CommonFormShape;
  noteId: string;
  /** Other language versions of the note (`{ en: Doc }`). */
  translations?: Record<string, Doc>;
  /**
   * The post on 辰记 (`https://starnote.app/@<handle>/<short_id>`): written as `starnote_url` (the template shows
   * the comments preview only when it is there) and used as `canonical` when `form.canonical` is `chenji`.
   */
  canonicalUrl?: string;
  /** The 辰记 post's `short_id` → `starnote_id` (never the directory id). */
  starnoteId?: string;
  /** The 辰记 blog category → `category: {slug, name}`. */
  category?: { slug: string; name: string };
  /** First publication time (ISO 8601); defaults to `common.scheduleAt`, then `now`. */
  publishedAt?: string;
  /** Image `src` → path relative to the post directory (`assets/<hash>.<ext>`), for rehosted images. */
  assets?: ReadonlyMap<string, string>;
  layout?: Partial<GithubPagesLayout>;
  now?: Date;
  /** SPEC-r14 B5: language of the report (the post itself is not translated). Default `zh-CN`. */
  lang?: SdkLang;
}

export interface RenderedFile {
  /** Path in the repository. */
  path: string;
  content: string;
  lang: string;
}

export interface RenderedPost {
  postId: string;
  /** Post directory in the repository. */
  dir: string;
  files: RenderedFile[];
  /** URL of the main language version. */
  url: string;
  urls: Record<string, string>;
  report: ReportItem[];
}

/** A URL-safe id from the note id: its first 8 alphanumerics, lower-cased. */
export function defaultPostId(noteId: string): string {
  return (
    noteId
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 8) || 'post'
  );
}

/**
 * YAML front matter. Every value is written as JSON, which is valid YAML flow syntax, so titles with
 * `:` / `#` / quotes and nested values (toc, translations) need no YAML escaping rules of their own.
 */
export function frontMatter(fields: Record<string, unknown>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

/** Points `src` attributes at rehosted copies (raw and HTML-escaped spellings). */
export function rewriteImageSources(html: string, assets?: ReadonlyMap<string, string>): string {
  if (!assets?.size) return html;
  let out = html;
  for (const [src, path] of assets) {
    for (const spelled of new Set([src, escapeHtml(src)])) {
      out = out.split(`src="${spelled}"`).join(`src="${path}"`);
    }
  }
  return out;
}

/**
 * Pure: the files one post becomes (SPEC-r8-github-template §2). One directory per post id (the directory
 * name is the URL), one `index.<lang>.html` per language (front matter + our HTML, first line the article
 * marker); languages without a version get no file. Images are not fetched here — pass `assets` once they
 * are rehosted.
 *
 * Front matter fields, in this order: title, summary, lang, published_at, updated_at, category, tags, cover,
 * canonical, starnote_url, starnote_id, note_id, translations, toc, generator. There is no `id` (easy to mistake for
 * the 辰记 short_id) and no `slug` (the directory name is the URL): the template ignores both.
 *
 * Mirrored by `starnote-api/app/services/github_publish.py` (`render_post`), which the API runs for
 * `POST /notes/{id}/publish/github-pages`; keep both in step (same fields, order and JSON spelling).
 */
export function renderPost(input: RenderPostInput): RenderedPost {
  const layout = resolveLayout(input.layout);
  const { doc, form, common = {} } = input;
  const postId = form.post_id ?? defaultPostId(input.noteId);
  const dir = `${form.dir}/${postId}`;
  const base = siteBaseUrl(form.repo, form.site_url);
  const now = (input.now ?? new Date()).toISOString();

  const versions: Array<{ lang: string; doc: Doc; main: boolean }> = [
    { lang: form.lang, doc, main: true },
    ...Object.entries(input.translations ?? {})
      .filter(([lang]) => lang !== form.lang)
      .map(([lang, d]) => ({ lang, doc: d, main: false })),
  ];
  const urls: Record<string, string> = {};
  for (const v of versions) urls[v.lang] = postUrl(layout, base, postId, v.lang);
  const useChenji = form.canonical === 'chenji' && !!input.canonicalUrl;
  // a rehosted cover is a path relative to the post directory; otherwise only an absolute URL is usable
  const cover = common.cover
    ? (input.assets?.get(common.cover) ??
      (/^https?:\/\//.test(common.cover) ? common.cover : undefined))
    : undefined;

  const files = versions.map(({ lang, doc: d, main }) => {
    const title = (main ? common.title : undefined) || d.title;
    const others = Object.fromEntries(
      versions.filter((o) => o.lang !== lang).map((o) => [o.lang, postFileName(layout, o.lang)])
    );
    const head = frontMatter({
      title,
      summary: (main ? common.summary : undefined) || d.summary,
      lang,
      published_at: input.publishedAt ?? common.scheduleAt ?? now,
      updated_at: now,
      category: input.category,
      tags: common.tags?.length ? common.tags : undefined,
      cover,
      canonical: useChenji ? input.canonicalUrl : urls[lang],
      starnote_url: input.canonicalUrl,
      starnote_id: input.starnoteId,
      note_id: input.noteId,
      translations: Object.keys(others).length ? others : undefined,
      toc: d.toc.length ? d.toc : undefined,
      generator: GENERATOR,
    });
    const body = rewriteImageSources(d.html, input.assets);
    return {
      path: `${dir}/${postFileName(layout, lang)}`,
      content: `${head}${layout.marker}\n${body}\n`,
      lang,
    };
  });

  const report: ReportItem[] = [];
  const m = msg(input.lang).render;
  if (versions.length > 1) {
    const langs = versions.filter((v) => !v.main).map((v) => v.lang);
    report.push({
      kind: 'translated',
      text: m.translated(langs.join(m.langSeparator)),
      count: langs.length,
    });
  }
  if (useChenji) report.push({ kind: 'canonical.set', text: m.canonicalChenji });

  return { postId, dir, files, url: urls[form.lang] ?? `${base}/${postId}/`, urls, report };
}
