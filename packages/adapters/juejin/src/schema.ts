import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';

/** The form in a language (SPEC-r14 B5). */
export const juejinSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z
    .object({
      /** 掘金分类 id（`publish` 时必填，见 `juejinCategories`；默认交接时在掘金的发布弹窗里选）。 */
      category_id: z.string().trim().min(1, t.pickCategory).optional().describe(t.category),
      /** 掘金标签 id（`publish` 时 1–3 个，见 `juejinSearchTags`）。 */
      tag_ids: z.array(z.string().trim().min(1)).max(3, t.tagsMax).optional().describe(t.tags),
      /** 摘要（50–100 字；留空时用文章摘要补齐）。 */
      brief: z.string().trim().max(100, t.briefMax).optional().describe(t.brief),
      /**
       * `draft` (default, SPEC-r15): a 掘金 draft with every field filled (category, tags and brief guessed when
       * empty), opened in the 发布台; the user publishes. `prefill`: the blank editor with title and Markdown, the
       * user picks the fields in 掘金's dialog (also the fallback of `draft`). `review` / `publish`: earlier API
       * paths, kept as they were.
       */
      mode: z.enum(['draft', 'prefill', 'review', 'publish']).default('draft').describe(t.mode),
    })
    .superRefine((v, ctx) => {
      if (v.mode !== 'publish') return;
      if (!v.category_id)
        ctx.addIssue({ code: 'custom', path: ['category_id'], message: t.pickCategory });
      if (!v.tag_ids?.length)
        ctx.addIssue({ code: 'custom', path: ['tag_ids'], message: t.tagsMin });
    });
});

export const juejinSchema = juejinSchemaFor('zh-CN');

export type JuejinForm = z.infer<typeof juejinSchema>;
export type JuejinFormInput = z.input<typeof juejinSchema>;
