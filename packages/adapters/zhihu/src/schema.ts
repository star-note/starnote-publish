import { z } from 'zod';

export const zhihuSchema = z.object({
  /** Keywords matched against 知乎 topics; the first match of each is attached (知乎 usually needs ≥ 1). */
  topics: z
    .array(z.string().trim().min(1).max(30))
    .max(3, '最多 3 个话题')
    .default([])
    .describe('话题'),
  /**
   * `prefill` (default): open 知乎's editor, fill title and body, the user presses「发布」(发布台).
   * `review` / `publish`: earlier API paths, kept as they were.
   */
  mode: z.enum(['prefill', 'review', 'publish']).default('prefill').describe('发布方式'),
});

export type ZhihuForm = z.infer<typeof zhihuSchema>;
export type ZhihuFormInput = z.input<typeof zhihuSchema>;
