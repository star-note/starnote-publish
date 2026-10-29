import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';

/** The form in a language (SPEC-r14 B5). */
export const wechatMpSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** 作者（公众号后台的「作者」栏，过长会截短）。 */
    author: z.string().trim().max(16, t.authorMax).optional().describe(t.author),
    /** 「阅读原文」链接；留空时用辰记原文地址。 */
    source_url: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.sourceUrl),
    /** 打开留言。 */
    open_comment: z.boolean().default(true).describe(t.openComment),
  });
});

export const wechatMpSchema = wechatMpSchemaFor('zh-CN');

export type WechatMpForm = z.infer<typeof wechatMpSchema>;
export type WechatMpFormInput = z.input<typeof wechatMpSchema>;
