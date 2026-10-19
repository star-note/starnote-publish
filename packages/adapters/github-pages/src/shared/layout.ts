/**
 * Repository layout of the GitHub Pages template (SPEC-r8 §4.2, §4.7). The template repository is not
 * final yet, so every path is a constant here and can be overridden per adapter (`layout` option).
 */
export interface GithubPagesLayout {
  /** `owner/name` of the template repository new blogs are generated from. */
  templateRepo: string;
  /** Posts root; one directory per post id below it. */
  contentDir: string;
  /** File name of one language version; `{lang}` is replaced, e.g. `index.zh-CN.html`. */
  postFile: string;
  /** Images of a post, next to its files. */
  assetsDir: string;
  /** Hex chars of the image's sha256 used as its file name. */
  assetHashLength: number;
  /** First line of every article body (same marker as the 辰记 blog). */
  marker: string;
  /** The language served at the site root; others get a path prefix. */
  defaultLanguage: string;
  /** URL prefix per non-default language (`en` → `/en/<id>/`); unknown languages use their lower-cased tag. */
  langPathPrefix: Record<string, string>;
  /** Site config (the template reads `content/site.json`); 辰记 keeps its `starnote`, `cname` and `adsense` in sync. */
  siteConfigFile: string;
}

export const GITHUB_PAGES_LAYOUT: GithubPagesLayout = {
  templateRepo: 'star-note/starnote-blog-template',
  contentDir: 'content/posts',
  postFile: 'index.{lang}.html',
  assetsDir: 'assets',
  assetHashLength: 12,
  marker: '<!--sn:article 1-->',
  defaultLanguage: 'zh-CN',
  langPathPrefix: { en: 'en', 'zh-CN': 'zh' },
  siteConfigFile: 'content/site.json',
};

/** Languages the form offers. */
export const GITHUB_PAGES_LANGUAGES = ['zh-CN', 'en'] as const;
export type GithubPagesLanguage = (typeof GITHUB_PAGES_LANGUAGES)[number];

export const GENERATOR = 'starnote-publish/github-pages';

export function resolveLayout(override?: Partial<GithubPagesLayout>): GithubPagesLayout {
  return { ...GITHUB_PAGES_LAYOUT, ...override };
}

export function postFileName(layout: GithubPagesLayout, lang: string): string {
  return layout.postFile.replace('{lang}', lang);
}

/** `https://<owner>.github.io` for `<owner>.github.io`, else `https://<owner>.github.io/<repo>`; no trailing slash. */
export function siteBaseUrl(repo: string, siteUrl?: string): string {
  if (siteUrl) return siteUrl.replace(/\/+$/, '');
  const [owner = '', name = ''] = repo.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}` : `https://${host}/${name}`;
}

/** Default language at `/<id>/`, others at `/<prefix>/<id>/` (static sites cannot use `?lang=`). */
export function postUrl(
  layout: GithubPagesLayout,
  base: string,
  postId: string,
  lang: string
): string {
  if (lang === layout.defaultLanguage) return `${base}/${postId}/`;
  const prefix = layout.langPathPrefix[lang] ?? lang.toLowerCase();
  return `${base}/${prefix}/${postId}/`;
}
