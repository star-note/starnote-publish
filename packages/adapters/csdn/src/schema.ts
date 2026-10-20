import { z } from 'zod';

export const CSDN_ARTICLE_TYPES = { original: '原创', repost: '转载', translated: '翻译' } as const;

export const csdnSchema = z
  .object({
    /** CSDN 必选的文章类型；交接模式下由你在 CSDN 的发布弹窗里选，这里用来提醒。 */
    article_type: z
      .enum(['original', 'repost', 'translated'])
      .default('original')
      .describe('文章类型'),
    /** 转载必须填原文链接。 */
    original_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的原文链接')
      .optional()
      .describe('原文链接'),
  })
  .refine((v) => v.article_type !== 'repost' || !!v.original_url, {
    message: '转载文章需要填写原文链接',
    path: ['original_url'],
  });

export type CsdnForm = z.infer<typeof csdnSchema>;
export type CsdnFormInput = z.input<typeof csdnSchema>;
