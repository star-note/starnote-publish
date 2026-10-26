/**
 * Hashnode (GraphQL). Field names follow Hashnode's own `gql-skill` schema (github.com/Hashnode/gql-skill,
 * `references/schema.graphql`, read 2026-10): `publishPost(input: PublishPostInput!)`,
 * `updatePost(input: UpdatePostInput!)`, `createDraft(input: CreateDraftInput!)`, `me { publications }`.
 *
 * ✅ from that repo: PAT in `Authorization` (the `Bearer ` prefix is optional); errors come as HTTP 200 with
 * `errors[].extensions.code` (UNAUTHENTICATED / FORBIDDEN / NOT_FOUND / BAD_USER_INPUT /
 * INTERNAL_SERVER_ERROR); **every write mutation needs the target publication on the Pro plan** (else
 * FORBIDDEN 「Publication does not have an active Pro plan」); request body ≤ 100 KB; ≤ 15 tags; rate limits
 * (500 mutations/min) published but not enforced.
 *
 * ⚠️ 待核实: the skill names `https://gql-beta.hashnode.com` as production; older docs and clients use
 * `https://gql.hashnode.com` with a different cover / TOC shape (`coverImageOptions`, `settings`). The
 * endpoint is an option; we only send fields both schemas share plus `coverImage` / `enableToc`.
 */
import {
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
} from '@starnote/publish-core';
import {
  articleOf,
  canonicalOf,
  CLIENT_RELAY,
  degradeArticle,
  fitSummary,
  fitTags,
  fitTitle,
  guard,
  helpError,
  linkedImagesReport,
  num,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PlatformStats,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  StatsContext,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const HASHNODE_GQL = 'https://gql-beta.hashnode.com/';

export const HASHNODE_LIMITS = {
  /** ✅ API: 15 per post. The editor UI offers 5 (⚠️ 待核实), so we keep 5 to match what authors see. */
  tags: 5,
  /** ⚠️ 待核实：标题上限文档未写，按 250。 */
  titleMax: 250,
  /** ⚠️ 待核实：副标题上限文档未写，按 150。 */
  subtitleMax: 150,
  /** ✅ request body ≤ 100 KB */
  bodyBytes: 100 * 1024,
} as const;

/** Hashnode tag slug: lowercase ASCII, other runs → `-`; `null` when nothing ASCII is left. */
export function hashnodeTagSlug(tag: string): string | null {
  const s = tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || null;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const hashnodeSchema = z.object({
  /** Which blog; defaults to the one picked when binding (`account.meta.publication_id`). */
  publication_id: z
    .string()
    .trim()
    .regex(OBJECT_ID, '博客 ID 是 24 位十六进制')
    .optional()
    .describe('博客'),
  mode: z.enum(['publish', 'draft']).default('publish').describe('发布方式'),
  subtitle: z.string().trim().optional().describe('副标题'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, '只能用小写字母、数字和 -')
    .optional()
    .describe('网址'),
  enable_toc: z.boolean().default(false).describe('显示目录'),
  series_id: z
    .string()
    .trim()
    .regex(OBJECT_ID, '系列 ID 是 24 位十六进制')
    .optional()
    .describe('系列'),
  set_canonical: z.boolean().default(true).describe('设置原文链接'),
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  /** The Hashnode post id from an earlier publish: set it to update instead of creating. */
  external_id: z
    .string()
    .trim()
    .regex(OBJECT_ID, '文章 ID 是 24 位十六进制')
    .optional()
    .describe('已发布文章 ID'),
});

export type HashnodeForm = z.infer<typeof hashnodeSchema>;
export type HashnodeFormInput = z.input<typeof hashnodeSchema>;

export interface HashnodeCredentials {
  token: string;
  /** The blog picked when binding. */
  publicationId?: string;
}

export const hashnodeTokenForm = z.object({
  token: z
    .string()
    .trim()
    .min(16, '请粘贴 Hashnode 开发者设置页生成的令牌')
    .describe('个人访问令牌'),
});

export const hashnodeBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'hashnode',
  fields: ['token'],
  form: hashnodeTokenForm,
  createUrl: 'https://hashnode.com/settings/developer',
  instructions: [
    '打开 hashnode.com/settings/developer，生成一个新令牌并复制',
    '粘贴到这里并点「测试连接」；有多个博客时选要发到哪一个',
    '注意：Hashnode 要求博客开通 Pro 才能通过接口发文',
  ],
  selects: [{ id: 'publication_id', title: '发布到哪个博客' }],
};

export interface HashnodeTagInput {
  slug: string;
  name: string;
}

export interface HashnodePostInput {
  publicationId?: string;
  id?: string;
  title: string;
  subtitle?: string;
  contentMarkdown: string;
  slug?: string;
  tags: HashnodeTagInput[];
  originalArticleURL?: string;
  coverImage?: string;
  enableToc?: boolean;
  seriesId?: string;
}

export interface HashnodeRendered {
  title: string;
  markdown: string;
  previewHtml: string;
  /** Without `publicationId` / `id`; the adapter adds them. */
  input: HashnodePostInput;
  report: ReportItem[];
}

function absolute(url: string | undefined, base?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (!base || !/^\/|^\.\.?\//.test(url)) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

/** Pure: Markdown, mutation input and predicted report. */
export function renderHashnode(
  doc: Doc,
  form: HashnodeForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): HashnodeRendered {
  const article = articleOf(doc, content);
  const degraded = degradeArticle(
    article.doc,
    {
      target: 'markdown',
      lang: article.lang,
      title: article.doc.title,
      math: 'dollar',
      video: 'link',
      stripHighlight: true,
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    },
    'Hashnode'
  );
  const title = fitTitle(
    common.title || article.doc.title || 'Untitled',
    HASHNODE_LIMITS.titleMax,
    'Hashnode'
  );
  const subtitle = fitSummary(form.subtitle, HASHNODE_LIMITS.subtitleMax, 'Hashnode');
  const slugs = fitTags(
    common.tags,
    { max: HASHNODE_LIMITS.tags, normalize: hashnodeTagSlug },
    'Hashnode'
  );
  // Keep the author's tag text as the display name of each slug.
  const names = new Map<string, string>();
  for (const t of common.tags ?? []) {
    const s = hashnodeTagSlug(t);
    if (s && !names.has(s)) names.set(s, t.trim());
  }
  const tags = slugs.tags.map((slug) => ({ slug, name: names.get(slug) ?? slug }));
  const canonical = canonicalOf(form, article, 'Hashnode');
  const cover = absolute(common.cover, opts.assetBase);

  const report: ReportItem[] = [
    ...degraded.report,
    ...linkedImagesReport(degraded.doc.images.length, 'Hashnode'),
    ...title.report,
    ...subtitle.report,
    // Slugs are an internal form; only report what was dropped.
    ...slugs.report.filter((i) => i.kind === 'tags.trimmed'),
    ...canonical.report,
  ];

  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video

  report.push(...mediaReport('hashnode', 'Hashnode', content, common));
  if (form.mode === 'draft')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text: '以未公开状态保存到 Hashnode，检查后在 Hashnode 后台发布',
    });

  return {
    title: title.title,
    markdown: degraded.body,
    previewHtml: degraded.doc.portableHtml,
    input: {
      title: title.title,
      ...(subtitle.summary ? { subtitle: subtitle.summary } : {}),
      contentMarkdown: degraded.body,
      ...(form.slug ? { slug: form.slug } : {}),
      tags,
      ...(canonical.url ? { originalArticleURL: canonical.url } : {}),
      ...(cover ? { coverImage: cover } : {}),
      ...(form.enable_toc ? { enableToc: true } : {}),
      ...(form.series_id ? { seriesId: form.series_id } : {}),
    },
    report,
  };
}

/* ---------------- server requests (described; sent by 辰记's Python API) ---------------- */

export function hashnodeRef(links?: ErrorLinks): PlatformRef {
  return { key: 'hashnode', label: 'Hashnode', ...(links ? { links } : {}) };
}

/** The GraphQL documents 辰记's API sends (`app/services/relay_platforms.py` keeps the same strings). */
export const HASHNODE_QUERIES = {
  me: `query Me { me { id username name profilePicture publications(first: 20) { edges { node { id title url } } } } }`,
  publish: `mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id slug url } } }`,
  update: `mutation UpdatePost($input: UpdatePostInput!) { updatePost(input: $input) { post { id slug url } } }`,
  draft: `mutation CreateDraft($input: CreateDraftInput!) { createDraft(input: $input) { draft { id slug } } }`,
} as const;

/**
 * verify: `me` (the publications to pick from); publish: `publishPost` with the relay input + the bound
 * `publicationId`; update: `updatePost` (no `publicationId`, + `id`); draft: `createDraft` (cover / TOC nested under
 * `coverImageOptions` / `settings`). Errors come as HTTP 200 + `errors[].extensions.code`; writes need a Pro blog.
 */
export const HASHNODE_REQUESTS = {
  verify: {
    method: 'POST',
    url: HASHNODE_GQL,
    auth: 'Authorization: <token>',
    body: 'HASHNODE_QUERIES.me',
  },
  publish: {
    method: 'POST',
    url: HASHNODE_GQL,
    auth: 'Authorization: <token>',
    body: 'HASHNODE_QUERIES.publish',
  },
  update: {
    method: 'POST',
    url: HASHNODE_GQL,
    auth: 'Authorization: <token>',
    body: 'HASHNODE_QUERIES.update',
  },
  draft: {
    method: 'POST',
    url: HASHNODE_GQL,
    auth: 'Authorization: <token>',
    body: 'HASHNODE_QUERIES.draft',
  },
} as const satisfies Record<string, RequestDescription>;

/**
 * What the browser posts to 辰记's API for Hashnode: the mutation input (the server adds `publicationId` from
 * the binding unless the form chose one) and whether to publish or save an unpublished version.
 */
export interface HashnodeRelayBody {
  mode: 'publish' | 'draft';
  input: HashnodePostInput;
}

export function hashnodeRelayBody(r: HashnodeRendered, form: HashnodeForm): HashnodeRelayBody {
  return {
    mode: form.mode,
    input: { ...r.input, ...(form.publication_id ? { publicationId: form.publication_id } : {}) },
  };
}

/* ---------------- adapter ---------------- */

/** ⚠️ 待核实：`post(id)` 的 `views` 只对作者可见（需要令牌），字段名按 SPEC-r11 §7.3。 */
export const HASHNODE_STATS_QUERY =
  'query PostStats($id: ID!) { post(id: $id) { id views reactionCount responseCount } }';

/** A pasted-back link (SPEC-r12 §1.1): the post by its blog host and slug. */
export const HASHNODE_STATS_BY_SLUG_QUERY =
  'query PostStatsBySlug($host: String!, $slug: String!) { publication(host: $host) { post(slug: $slug) { id views reactionCount responseCount } } }';

/**
 * SPEC-r11 §7: views, reactions and responses of a post (GraphQL, the user's token). A link (SPEC-r12 §1.1) is looked
 * up by host + slug; a link that names no post gives `null`.
 */
export async function fetchHashnodeStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const token = ctx.credential?.api_key ?? ctx.credential?.access_token;
  let byLink: { host: string; slug: string } | undefined;
  if (isUrlExternalId(externalId)) {
    const parsed = parsePostUrl('hashnode', externalId);
    const u = parsed ? new URL(parsed.url) : undefined;
    const slug = u?.pathname.split('/').filter(Boolean).pop();
    if (!u || !slug) return null;
    byLink = { host: u.host, slug };
  }
  const res = await readJson<{
    data?: {
      post?: Record<string, unknown> | null;
      publication?: { post?: Record<string, unknown> | null } | null;
    };
  }>(ctx, hashnodeRef(), HASHNODE_GQL, {
    method: 'POST',
    body: byLink
      ? { query: HASHNODE_STATS_BY_SLUG_QUERY, variables: byLink }
      : { query: HASHNODE_STATS_QUERY, variables: { id: externalId } },
    ...(token ? { headers: { Authorization: token } } : {}),
  });
  const post = byLink ? res?.data?.publication?.post : res?.data?.post;
  if (!post) return null;
  return stats('official-api', {
    views: num(post.views),
    likes: num(post.reactionCount),
    comments: num(post.responseCount),
  });
}

export interface HashnodeAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** Renders in the browser / desktop; 辰记's API adds the token and sends it (服务器代发). */
export function createHashnodeAdapter(
  opts: HashnodeAdapterOptions = {}
): Adapter<typeof hashnodeSchema> {
  const ref = hashnodeRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'hashnode',
    label: 'Hashnode',
    runtimes: opts.runtimes ?? CLIENT_RELAY,
    contentTypes: ['article'],
    binding: hashnodeBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: HASHNODE_LIMITS.titleMax },
    schema: hashnodeSchema,
    statsRequires: 'token',
    fetchStats(externalId, ctx) {
      return fetchHashnodeStats(externalId, ctx);
    },
    preview(doc, form, common, content): AdapterPreview {
      const r = renderHashnode(doc, form, common, content, renderOpts);
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous }) {
      const r = renderHashnode(doc, form, common, content, renderOpts);
      return relayRequestOf(hashnodeRelayBody(r, form), previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const updating = !!(ctx.previous?.externalId ?? form.external_id);
        const r = renderHashnode(doc, form, common, content, renderOpts);
        const body = hashnodeRelayBody(r, form);
        // A body over Hashnode's 100 KB limit would only fail there; stop before sending.
        const size = new TextEncoder().encode(JSON.stringify(body)).length;
        if (size > HASHNODE_LIMITS.bodyBytes)
          throw helpError(
            ref,
            `正文太长：Hashnode 单次请求最多 100 KB，这篇约 ${Math.ceil(size / 1024)} KB`,
            { code: 'too_large' }
          );
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '由服务器代发到 Hashnode' });
        const res = await relayPublish(ctx, ref, body, form.external_id);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.mode === 'draft' && !updating ? 'draft' : 'published'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
