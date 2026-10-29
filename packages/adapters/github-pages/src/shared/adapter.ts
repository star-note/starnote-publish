import { defineAdapter } from '@starnote/publish-core';

import { commitFiles, sha256Hex } from './git';
import { msg } from './i18n';
import { resolveLayout } from './layout';
import { defaultPostId, renderPost } from './render';
import { githubPagesSchema, githubPagesSchemaFor } from './schema';
import {
  applySiteSettings,
  dnsRecords,
  enforceHttps,
  readRepoText,
  setPagesDomain,
  siteConfigText,
} from './site';
import { githubPagesBinding } from './binding';

import type {
  Adapter,
  ArticleContent,
  AdapterPreview,
  CommonFormShape,
  Doc,
  PublishContent,
  PublishContext,
  ReportItem,
  RuntimeSupport,
  SdkLang,
} from '@starnote/publish-core';
import type { GitFile } from './git';
import type { GithubPagesLayout } from './layout';
import type { GithubPagesForm } from './schema';
import type { GithubSiteSettings } from './site';
import type { TokenContext } from './token';

export interface GithubPagesAdapterOptions {
  runtimes: RuntimeSupport[];
  /** A fine-grained token with Contents (and Pages) write on `form.repo`. */
  token(ctx: TokenContext, form?: GithubPagesForm): Promise<string>;
  /** Fetch for `api.github.com`. Default `ctx.fetch`. */
  githubFetch?: typeof fetch;
  /** Fetch for the note's images. Default `ctx.fetch`. */
  assetFetch?: typeof fetch;
  /** Resolves relative image URLs. Default `globalThis.location.href` when there is one. */
  assetBase?: string;
  /** Default `https://api.github.com`. */
  apiUrl?: string;
  layout?: Partial<GithubPagesLayout>;
  /** Copy the note's images into the repository. Default true. */
  rehostImages?: boolean;
  /**
   * Site-level settings to keep in `content/site.json` and on the Pages site (the 辰记 block, custom domain,
   * AdSense), read for each publish — on the server, from the platform account. Absent: site.json is left alone.
   */
  site?(ctx: PublishContext, form: GithubPagesForm): Promise<GithubSiteSettings | null>;
  now?: () => Date;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function extensionOf(src: string, mime: string | null): string {
  const byMime = mime ? EXT_BY_MIME[mime.split(';')[0]!.trim().toLowerCase()] : undefined;
  if (byMime) return byMime;
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(src);
  return m ? m[1]!.toLowerCase() : 'bin';
}

function resolveSrc(src: string, base?: string): string | null {
  if (src.startsWith('data:')) return null;
  try {
    const fallback = (globalThis as { location?: { href?: string } }).location?.href;
    return new URL(src, base ?? fallback).toString();
  } catch {
    return null;
  }
}

function articleOf(doc: Doc, content?: PublishContent): ArticleContent {
  return content?.kind === 'article' ? content : { kind: 'article', doc };
}

/** What the 辰记 post contributes to the front matter (starnote_url / starnote_id / category / date). */
function articleExtras(article: ArticleContent) {
  return {
    ...(article.canonicalUrl ? { canonicalUrl: article.canonicalUrl } : {}),
    ...(article.shortId ? { starnoteId: article.shortId } : {}),
    ...(article.category ? { category: article.category } : {}),
    ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
  };
}

function predictedReport(
  doc: Doc,
  translations: Record<string, Doc> | undefined,
  rehost: boolean,
  lang?: SdkLang
): ReportItem[] {
  const images = new Set([doc, ...Object.values(translations ?? {})].flatMap((d) => d.images));
  const n = [...images].filter((s) => !s.startsWith('data:')).length;
  return rehost && n
    ? [{ kind: 'image.rehosted', text: msg(lang).publish.imagesWillRehost(n), count: n }]
    : [];
}

/**
 * The GitHub Pages adapter over a token source. Browser-safe: only `fetch` and WebCrypto; the
 * `./web` and `./electron` entries differ only in where the token comes from.
 */
export function createGithubPagesAdapter(
  opts: GithubPagesAdapterOptions
): Adapter<typeof githubPagesSchema> {
  const layout = resolveLayout(opts.layout);
  const rehost = opts.rehostImages ?? true;

  return defineAdapter({
    key: 'github-pages',
    label: 'GitHub Pages',
    runtimes: opts.runtimes,
    contentTypes: ['article'],
    binding: githubPagesBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: githubPagesSchema,
    schemaFor: githubPagesSchemaFor,

    preview(
      doc: Doc,
      form: GithubPagesForm,
      common: CommonFormShape = {},
      content?: PublishContent,
      popts?: { lang?: SdkLang }
    ): AdapterPreview {
      const article = articleOf(doc, content);
      const lang = popts?.lang;
      const post = renderPost({
        doc: article.doc,
        form,
        common,
        noteId: 'preview',
        translations: article.translations,
        ...articleExtras(article),
        layout,
        ...(opts.now ? { now: opts.now() } : {}),
        ...(lang ? { lang } : {}),
      });
      const main = post.files[0]!;
      return {
        format: 'files',
        title: common.title || article.doc.title,
        body: main.content,
        previewHtml: article.doc.html,
        files: post.files.map(({ path, content: c }) => ({ path, content: c })),
        url: post.url,
        report: [
          ...predictedReport(article.doc, article.translations, rehost, lang),
          ...post.report,
        ],
      };
    },

    async publish({ doc, form, common, ctx, content }) {
      const article = articleOf(doc, content);
      const lang = ctx.lang;
      const t = msg(lang).publish;
      ctx.emit({ type: 'progress', percent: 5, text: t.authorize });
      const token = await opts.token(ctx, form);
      const postId = form.post_id ?? defaultPostId(ctx.noteId);
      const dir = `${form.dir}/${postId}`;

      // 1. Images → assets/<sha256-12>.<ext> next to the post.
      const assets = new Map<string, string>();
      const imageFiles: GitFile[] = [];
      const failed: string[] = [];
      if (rehost) {
        const sources = [
          ...new Set(
            [article.doc, ...Object.values(article.translations ?? {})]
              .flatMap((d) => d.images)
              .concat(
                common.cover && /^(https?:)?\/\/|^\//.test(common.cover) ? [common.cover] : []
              )
          ),
        ];
        const fetchAsset = opts.assetFetch ?? ctx.fetch;
        for (const [i, src] of sources.entries()) {
          const url = resolveSrc(src, opts.assetBase);
          if (!url) continue;
          ctx.emit({
            type: 'progress',
            percent: 10 + Math.round((30 * i) / sources.length),
            text: t.downloadImages,
          });
          try {
            const res = await fetchAsset(url, { signal: ctx.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const bytes = new Uint8Array(await res.arrayBuffer());
            const hash = (await sha256Hex(bytes)).slice(0, layout.assetHashLength);
            const rel = `${layout.assetsDir}/${hash}.${extensionOf(url, res.headers.get('content-type'))}`;
            assets.set(src, rel);
            if (!imageFiles.some((f) => f.path === `${dir}/${rel}`)) {
              imageFiles.push({ path: `${dir}/${rel}`, content: bytes });
            }
          } catch {
            failed.push(src);
          }
        }
      }

      // 2. Front matter + HTML per language (URLs on the custom domain when there is one).
      const site = opts.site ? await opts.site(ctx, form) : null;
      const domain = site?.monetize?.domain;
      const post = renderPost({
        doc: article.doc,
        form: domain && !form.site_url ? { ...form, site_url: `https://${domain}` } : form,
        common,
        noteId: ctx.noteId,
        translations: article.translations,
        ...articleExtras(article),
        assets,
        layout,
        ...(opts.now ? { now: opts.now() } : {}),
        ...(lang ? { lang } : {}),
      });

      // 3. Site settings → content/site.json (same commit).
      const github = {
        fetch: opts.githubFetch ?? ctx.fetch,
        token,
        ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}),
        ...(lang ? { lang } : {}),
      };
      const siteFiles: GitFile[] = [];
      if (site) {
        const before = await readRepoText({
          ...github,
          repo: form.repo,
          path: layout.siteConfigFile,
          branch: form.branch,
        });
        let parsed: Record<string, unknown> | null = {};
        try {
          parsed = before ? (JSON.parse(before) as Record<string, unknown>) : {};
        } catch {
          parsed = null;
          ctx.emit({
            type: 'log',
            level: 'warn',
            text: t.badSiteJson(layout.siteConfigFile),
          });
        }
        const after = parsed ? siteConfigText(applySiteSettings(parsed, site)) : before;
        if (after !== null && after !== before)
          siteFiles.push({ path: layout.siteConfigFile, content: after });
      }

      // 4. One commit.
      ctx.emit({ type: 'progress', percent: 45, text: t.commit });
      const title = common.title || article.doc.title || postId;
      const result = await commitFiles({
        fetch: opts.githubFetch ?? ctx.fetch,
        token,
        signal: ctx.signal,
        ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}),
        ...(lang ? { lang } : {}),
        repo: form.repo,
        branch: form.branch,
        files: [
          ...post.files.map(({ path, content: c }) => ({ path, content: c })),
          ...imageFiles,
          ...siteFiles,
        ],
        message: `publish: ${title} (#${postId})\n\nStarNote-Note: ${ctx.noteId}`,
        onStep: (text) => ctx.emit({ type: 'log', level: 'info', text }),
      });

      // 5. Custom domain on the Pages site, then HTTPS once the certificate is there.
      const domainReport: ReportItem[] = [];
      if (site && site.monetize !== undefined) {
        await setPagesDomain({ ...github, repo: form.repo, domain: domain ?? null });
        if (domain) {
          const https = await enforceHttps({ ...github, repo: form.repo });
          domainReport.push({
            kind: 'domain.set',
            level: 'notice',
            text: t.domainSet(domain),
            detail: {
              domain,
              dns: dnsRecords(domain, form.repo.split('/')[0]!),
              https: https.state,
            },
          });
        } else {
          domainReport.push({ kind: 'domain.cleared', text: t.domainCleared });
        }
      }

      // 6. What we did.
      const imagePaths = new Set(imageFiles.map((f) => f.path));
      const rehosted = result.written.filter((p) => imagePaths.has(p)).length;
      const reused = result.unchanged.filter((p) => imagePaths.has(p)).length;
      const report: ReportItem[] = [];
      if (rehosted)
        report.push({
          kind: 'image.rehosted',
          text: t.rehosted(rehosted),
          count: rehosted,
        });
      if (reused)
        report.push({
          kind: 'image.reused',
          text: t.reused(reused),
          count: reused,
        });
      if (failed.length) {
        report.push({
          kind: 'image.failed',
          level: 'warn',
          text: t.failed(failed.length),
          count: failed.length,
          samples: failed.slice(0, 3),
        });
      }
      report.push(...post.report, ...domainReport);
      if (result.commitSha === null) {
        report.push({ kind: 'unchanged', text: t.unchanged });
      } else {
        report.push({
          kind: 'build.pending',
          level: 'notice',
          text: t.building,
          detail: { commit: result.commitSha },
        });
      }
      ctx.emit({ type: 'report', items: report });
      ctx.emit({ type: 'progress', percent: 100, text: t.committed });
      return { url: post.url, externalId: `${form.repo}#${postId}`, state: 'published', report };
    },
  });
}
