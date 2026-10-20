import { z } from 'zod';

import { GITHUB_PAGES_LANGUAGES, GITHUB_PAGES_LAYOUT } from './layout';

export const githubPagesSchema = z.object({
  repo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, '仓库格式为 owner/name')
    .describe('仓库'),
  branch: z.string().trim().min(1, '请填写分支').default('main').describe('分支'),
  dir: z
    .string()
    .trim()
    .regex(
      /^(?!.*\.\.)[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
      '目录不能以 / 开头或结尾，也不能含 ..'
    )
    .default(GITHUB_PAGES_LAYOUT.contentDir)
    .describe('目录'),
  lang: z.enum(GITHUB_PAGES_LANGUAGES).default('zh-CN').describe('语言'),
  /** URL segment of the post; defaults to one derived from the note id. */
  post_id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, '只能用小写字母、数字和 -')
    .optional()
    .describe('文章标识'),
  /** Custom domain or project URL; derived from the repository when empty. */
  site_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('站点地址'),
  /** Which copy search engines treat as the original. */
  canonical: z.enum(['self', 'chenji']).default('self').describe('规范链接'),
});

export type GithubPagesForm = z.infer<typeof githubPagesSchema>;
export type GithubPagesFormInput = z.input<typeof githubPagesSchema>;
