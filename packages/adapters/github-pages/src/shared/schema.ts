import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';
import { GITHUB_PAGES_LANGUAGES, GITHUB_PAGES_LAYOUT } from './layout';

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const githubPagesSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    repo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, t.repoFormat)
      .describe(t.repo),
    branch: z.string().trim().min(1, t.branchRequired).default('main').describe(t.branch),
    dir: z
      .string()
      .trim()
      .regex(/^(?!.*\.\.)[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, t.dirFormat)
      .default(GITHUB_PAGES_LAYOUT.contentDir)
      .describe(t.dir),
    lang: z.enum(GITHUB_PAGES_LANGUAGES).default('zh-CN').describe(t.lang),
    /** URL segment of the post; defaults to one derived from the note id. */
    post_id: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, t.postIdFormat)
      .optional()
      .describe(t.postId),
    /** Custom domain or project URL; derived from the repository when empty. */
    site_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.siteUrl),
    /** Which copy search engines treat as the original. */
    canonical: z.enum(['self', 'chenji']).default('self').describe(t.canonical),
  });
});

export const githubPagesSchema = githubPagesSchemaFor('zh-CN');

export type GithubPagesForm = z.infer<typeof githubPagesSchema>;
export type GithubPagesFormInput = z.input<typeof githubPagesSchema>;
