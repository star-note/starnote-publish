import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';

/** The form in a language (SPEC-r14 B5). */
export const zhihuSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** Keywords matched against 知乎 topics; the first match of each is attached (知乎 usually needs ≥ 1). */
    topics: z
      .array(z.string().trim().min(1).max(30))
      .max(3, t.topicsMax)
      .default([])
      .describe(t.topics),
    /**
     * `prefill` (default): open 知乎's editor, fill title and body, the user presses「发布」(发布台).
     * `review` / `publish`: earlier API paths, kept as they were.
     */
    mode: z.enum(['prefill', 'review', 'publish']).default('prefill').describe(t.mode),
  });
});

export const zhihuSchema = zhihuSchemaFor('zh-CN');

export type ZhihuForm = z.infer<typeof zhihuSchema>;
export type ZhihuFormInput = z.input<typeof zhihuSchema>;
