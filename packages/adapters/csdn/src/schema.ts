import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';

/** CSDN's own (Chinese) names of the article types, as its publish dialog shows them: not translated. */
export const CSDN_ARTICLE_TYPES = { original: '原创', repost: '转载', translated: '翻译' } as const;

/** The form in a language (SPEC-r14 B5). */
export const csdnSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z
    .object({
      /**
       * CSDN 必选的文章类型。声明类由用户自己选（SPEC-r15）：不预设，交接时在 CSDN 的发布弹窗里选；这里选了的话只用来提醒。
       */
      article_type: z.enum(['original', 'repost', 'translated']).optional().describe(t.articleType),
      /** 转载必须填原文链接。 */
      original_url: z
        .string()
        .trim()
        .regex(/^https?:\/\/\S+$/, t.httpUrl)
        .optional()
        .describe(t.originalUrl),
    })
    .refine((v) => v.article_type !== 'repost' || !!v.original_url, {
      message: t.repostNeedsUrl,
      path: ['original_url'],
    });
});

export const csdnSchema = csdnSchemaFor('zh-CN');

export type CsdnForm = z.infer<typeof csdnSchema>;
export type CsdnFormInput = z.input<typeof csdnSchema>;
