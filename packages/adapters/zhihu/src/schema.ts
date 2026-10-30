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
     * `draft` (default, SPEC-r15): a 知乎 draft with title, body, cover and topics filled through the page's own
     * draft API, opened in the 发布台; the user picks the 创作声明 and presses「发布」.
     * `prefill`: open 知乎's blank editor, fill title and body, the user presses「发布」(also `draft`'s fallback).
     * `review` / `publish`: earlier API paths, kept as they were.
     */
    mode: z.enum(['draft', 'prefill', 'review', 'publish']).default('draft').describe(t.mode),
  });
});

export const zhihuSchema = zhihuSchemaFor('zh-CN');

export type ZhihuForm = z.infer<typeof zhihuSchema>;
export type ZhihuFormInput = z.input<typeof zhihuSchema>;
