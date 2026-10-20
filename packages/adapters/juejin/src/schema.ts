import { z } from 'zod';

export const juejinSchema = z
  .object({
    /** 掘金分类 id（`publish` 时必填，见 `juejinCategories`；默认交接时在掘金的发布弹窗里选）。 */
    category_id: z.string().trim().min(1, '请选择掘金分类').optional().describe('分类'),
    /** 掘金标签 id（`publish` 时 1–3 个，见 `juejinSearchTags`）。 */
    tag_ids: z.array(z.string().trim().min(1)).max(3, '最多 3 个标签').optional().describe('标签'),
    /** 摘要（50–100 字；留空时用文章摘要补齐）。 */
    brief: z.string().trim().max(100, '摘要最多 100 字').optional().describe('摘要'),
    /**
     * `prefill` (default): open 掘金's editor, fill title and Markdown, the user publishes (发布台).
     * `review` / `publish`: earlier API paths, kept as they were.
     */
    mode: z.enum(['prefill', 'review', 'publish']).default('prefill').describe('发布方式'),
  })
  .superRefine((v, ctx) => {
    if (v.mode !== 'publish') return;
    if (!v.category_id)
      ctx.addIssue({ code: 'custom', path: ['category_id'], message: '请选择掘金分类' });
    if (!v.tag_ids?.length)
      ctx.addIssue({ code: 'custom', path: ['tag_ids'], message: '至少选 1 个标签' });
  });

export type JuejinForm = z.infer<typeof juejinSchema>;
export type JuejinFormInput = z.input<typeof juejinSchema>;
