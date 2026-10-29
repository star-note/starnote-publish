/**
 * Zenn through its GitHub integration (✅ zenn.dev/zenn/articles/connect-to-github, zenn-cli-guide, what-is-slug;
 * validator: github.com/zenn-dev/zenn-editor `packages/zenn-model/src/utils.ts`): an article is the file
 * `articles/<slug>.md` in a repository linked to Zenn; a push to the registered branch deploys it. Front matter:
 * `title` (≤ 70), `emoji` (one), `type` (`tech` | `idea`), `topics` (≤ 5, each ≤ 18, no ASCII symbols or spaces),
 * `published` (false = 下書き), `published_at` (`YYYY-MM-DD[ hh:mm]`, JST; a future date with `published: true` is a
 * scheduled post; can be set only once). Slug: `^[0-9a-z_-]{12,50}$`, unique on Zenn, fixed once created. Public URL
 * `https://zenn.dev/<username>/articles/<slug>`.
 *
 * The commit is the GitHub Pages machinery on the server (`app/services/github_publish.py` `commit_files`, the twin of
 * this repo's `@starnote/publish-github-pages` `commitFiles`); the front matter is written by github-pages'
 * `frontMatter` (JSON values, valid YAML). Browser-safe: render + relay body only; 辰记's Python API holds the GitHub
 * token (the one bound for GitHub Pages, or one given for Zenn) and commits.
 *
 * ⚠️ Not verified: which branch Zenn deploys by default (we commit to the repository's default branch), whether
 * topics are lowercased by Zenn, deploy status (no API: the author checks Zenn's deploy history).
 */
import { byLang, defineAdapter, mediaReport, mergeReports } from '@starnote/publish-core';
import { frontMatter } from '@starnote/publish-github-pages';
import {
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitTags,
  fitTitle,
  guard,
  linkedImagesReport,
  originLinkOf,
  originNoteMarkdown,
  relayPublish,
  relayRequestOf,
} from '@starnote/publish-kit';
import { z } from 'zod';

import { msg } from './i18n';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  SdkLang,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const ZENN_LIMITS = {
  /** ✅ zenn-model: title ≤ 70 */
  titleMax: 70,
  /** ✅ zenn-model: topics ≤ 5, each ≤ 18 */
  topics: 5,
  topicMax: 18,
} as const;

/** ✅ what-is-slug / zenn-model `validateSlug`. */
export const ZENN_SLUG = /^[0-9a-z_-]{12,50}$/;
const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

/**
 * A Zenn topic: lower case, `C++` → `cpp`, `C#` → `csharp` (✅ the guide's examples), other ASCII symbols and spaces
 * dropped, ≤ 18 characters. `null` when nothing is left.
 */
export function zennTopic(tag: string): string | null {
  const t = tag
    .trim()
    .toLowerCase()
    .replace(/\+\+/g, 'pp')
    .replace(/#/g, 'sharp')
    .replace(/[ -/:-@[-`{-~]/g, '');
  return t ? [...t].slice(0, ZENN_LIMITS.topicMax).join('') : null;
}

/** 32-bit FNV-1a, hex: a stable short id for a slug when the note has no 辰记 short id yet. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The default slug: `starnote-` + the 辰记 short id with each capital written `_` + lower case (Zenn slugs are lower
 * case; this keeps `aB` and `Ab` apart), else a hash of the title. Always 12–50 characters.
 */
export function zennSlugOf(shortId: string | undefined, title: string): string {
  const id = shortId
    ? shortId.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/[^0-9a-z_-]/g, '')
    : '';
  return `starnote-${(id || fnv1a(title)).slice(0, 41)}`;
}

export const zennSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** false: 下書き (only the author sees it on Zenn). */
    published: z.boolean().default(true).describe(t.published),
    type: z.enum(['tech', 'idea']).default('tech').describe(t.type),
    emoji: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .refine((s) => !/[\s\w]/.test(s), t.oneEmoji)
      .default('📝')
      .describe(t.emoji),
    /** File name: fixed once the article exists on Zenn (renaming it makes a new article). */
    slug: z.string().trim().regex(ZENN_SLUG, t.slugRule).optional().describe(t.slug),
    /** `YYYY-MM-DD hh:mm` (JST): a future time with 直接公开 is a scheduled post. Can be set only once. */
    published_at: z
      .string()
      .trim()
      .regex(PUBLISHED_AT, t.publishedAtRule)
      .optional()
      .describe(t.publishedAt),
    /** Publication (Zenn Publication) the article belongs to. */
    publication_name: z
      .string()
      .trim()
      .regex(/^[0-9a-z_]{2,15}$/, t.publicationRule)
      .optional()
      .describe(t.publication),
    origin_note: z.boolean().default(true).describe(t.originNote),
    canonical_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.canonicalUrl),
    /** The slug of an earlier publish (the article's id on Zenn). */
    external_id: z.string().trim().regex(ZENN_SLUG, t.badSlug).optional().describe(t.externalId),
  });
});

export const zennSchema = zennSchemaFor('zh-CN');

export type ZennForm = z.infer<typeof zennSchema>;
export type ZennFormInput = z.input<typeof zennSchema>;

export const zennKeyFormFor = byLang((lang) => {
  const k = msg(lang).key;
  return z.object({
    zenn_username: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,40}$/, k.usernameHint)
      .describe(k.username),
    repo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, k.repoHint)
      .describe(k.repo),
    /** Empty: the token bound for GitHub Pages is used (it must reach this repository with Contents: write). */
    token: z
      .string()
      .trim()
      .regex(/^github_pat_[A-Za-z0-9_]{20,}$/, k.tokenHint)
      .optional()
      .or(z.literal(''))
      .describe(k.token),
  });
});

export const zennKeyForm = zennKeyFormFor('zh-CN');

export const zennBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'github',
  fields: ['zenn_username', 'repo', 'token'],
  form: zennKeyForm,
  formFor: zennKeyFormFor,
  permissions: msg('zh-CN').permissions,
  permissionsFor: (lang) => msg(lang).permissions,
  // ⚠️ Zenn 后台「デプロイ管理」的地址按经验填写
  createUrl: 'https://zenn.dev/dashboard/deploys',
  helpUrl: 'https://zenn.dev/zenn/articles/connect-to-github',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface ZennArticleBody {
  article: {
    slug: string;
    /** The whole file: front matter + Markdown. Written as is to `articles/<slug>.md`. */
    content: string;
    published: boolean;
  };
}

export interface ZennRendered {
  title: string;
  slug: string;
  path: string;
  markdown: string;
  content: string;
  previewHtml: string;
  body: ZennArticleBody;
  report: ReportItem[];
}

/** Pure: the file, the request body and the predicted report. */
export function renderZenn(
  doc: Doc,
  form: ZennForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  /** `lang` (SPEC-r14 B5): language of the report. Default `zh-CN`. */
  opts: { assetBase?: string; previousSlug?: string; lang?: SdkLang } = {}
): ZennRendered {
  const article = articleOf(doc, content);
  const lang = opts.lang;
  const m = msg(lang);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'markdown',
      lang: article.lang,
      title: article.doc.title,
      // Zenn Markdown: KaTeX with `$…$` / `$$` (zenn.dev/zenn/articles/markdown-guide)
      math: 'dollar',
      video: 'link',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'Zenn',
    lang
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    ZENN_LIMITS.titleMax,
    'Zenn',
    lang
  );
  const topics = fitTags(
    common.tags,
    { max: ZENN_LIMITS.topics, normalize: zennTopic },
    'Zenn',
    lang
  );
  const slug =
    form.external_id || opts.previousSlug || form.slug || zennSlugOf(article.shortId, title.title);
  const report: ReportItem[] = [...mediaReport('zenn', 'Zenn', content, common, lang)];
  let markdown = degraded.body;
  const canonical = canonicalOf({ canonical_url: form.canonical_url }, article, 'Zenn', lang);
  if (form.origin_note && canonical.url) {
    markdown += originNoteMarkdown(originLinkOf(form, article, canonical.url), article.lang);
    report.push({ kind: 'origin.note', text: m.originNote });
  }
  const file =
    frontMatter({
      title: title.title,
      emoji: form.emoji,
      type: form.type,
      topics: topics.tags,
      published: form.published,
      ...(form.published_at ? { published_at: form.published_at } : {}),
      ...(form.publication_name ? { publication_name: form.publication_name } : {}),
    }) + `\n${markdown.replace(/\s+$/, '')}\n`;
  report.push(
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'Zenn', lang),
    ...title.report,
    ...topics.report,
    {
      kind: 'zenn.file',
      text: m.file(slug),
      detail: { slug },
    }
  );
  if (!form.published)
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: m.draftOnly,
    });
  if (form.published_at)
    report.push({
      kind: 'scheduled',
      level: 'notice',
      text: m.scheduled(form.published_at),
    });

  return {
    title: title.title,
    slug,
    path: `articles/${slug}.md`,
    markdown,
    content: file,
    previewHtml: degraded.doc.portableHtml,
    body: { article: { slug, content: file, published: form.published } },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function zennRef(links?: ErrorLinks): PlatformRef {
  return { key: 'zenn', label: 'Zenn', ...(links ? { links } : {}) };
}

/**
 * What 辰记's API does for Zenn: the GitHub REST calls of `commit_files` (Git Data API: ref → commit → tree → blob →
 * tree → commit → PATCH ref) on the bound repository's default branch, writing `articles/{slug}.md`.
 * verify: `GET /repos/{owner}/{repo}` must show `permissions.push`.
 */
export const ZENN_REQUESTS = {
  verify: {
    method: 'GET',
    url: 'https://api.github.com/repos/{owner}/{repo}',
    auth: 'Authorization: Bearer <github token>',
  },
  commit: {
    method: 'PATCH',
    url: 'https://api.github.com/repos/{owner}/{repo}/git/refs/heads/{branch}',
    auth: 'Authorization: Bearer <github token>',
    body: 'ZennArticleBody.article.content → articles/{slug}.md',
  },
} as const satisfies Record<string, RequestDescription>;

export function zennRelayBody(r: ZennRendered): ZennArticleBody {
  return r.body;
}

/* ---------------- adapter ---------------- */

export interface ZennAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop; 辰记's API commits the file (`POST /notes/{id}/publish/zenn`). */
export function createZennAdapter(opts: ZennAdapterOptions = {}): Adapter<typeof zennSchema> {
  const ref = zennRef(opts.links);
  const base = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'zenn',
    label: 'Zenn',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: zennBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: ZENN_LIMITS.titleMax },
    schema: zennSchema,
    schemaFor: zennSchemaFor,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderZenn(doc, form, common, content, {
        ...base,
        ...(popts?.lang ? { lang: popts.lang } : {}),
      });
      return {
        format: 'files',
        title: r.title,
        body: r.content,
        previewHtml: r.previewHtml,
        files: [{ path: r.path, content: r.content }],
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderZenn(doc, form, common, content, {
        ...base,
        ...(lang ? { lang } : {}),
        ...(previous?.externalId ? { previousSlug: previous.externalId } : {}),
      });
      return relayRequestOf(zennRelayBody(r), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const prev = ctx.previous?.externalId;
        const r = renderZenn(doc, form, common, content, {
          ...base,
          ...(ctx.lang ? { lang: ctx.lang } : {}),
          ...(prev ? { previousSlug: prev } : {}),
        });
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: msg(ctx.lang).relaying });
        const res = await relayPublish(ctx, ref, zennRelayBody(r), form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: msg(ctx.lang).done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.published ? 'published' : 'draft'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
