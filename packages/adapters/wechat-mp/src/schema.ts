import { z } from 'zod';

export const wechatMpSchema = z.object({
  /** 作者（公众号后台的「作者」栏，过长会截短）。 */
  author: z.string().trim().max(16, '作者最多 16 个字').optional().describe('作者'),
  /** 「阅读原文」链接；留空时用辰记原文地址。 */
  source_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的链接')
    .optional()
    .describe('原文链接'),
  /** 打开留言。 */
  open_comment: z.boolean().default(true).describe('留言'),
});

export type WechatMpForm = z.infer<typeof wechatMpSchema>;
export type WechatMpFormInput = z.input<typeof wechatMpSchema>;
