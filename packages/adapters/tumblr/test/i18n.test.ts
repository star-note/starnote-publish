import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { renderTumblr, tumblrAdapter } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };

describe('Tumblr i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW', () => {
    const form = tumblrAdapter.schema.parse({ state: 'draft' });
    const texts = (lang?: 'en' | 'zh-TW') =>
      renderTumblr(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);
    expect(texts()).toContain('保存为 Tumblr 草稿');
    expect(texts('en')).toContain('Saved as a Tumblr draft');
    expect(texts('zh-TW')).toContain('儲存為 Tumblr 草稿');
  });

  it('labels per language', () => {
    const blog = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(adapterSchema(tumblrAdapter, lang)).find((f) => f.name === 'blog')!.description;
    expect(blog('en')).toBe('Blog');
    expect(blog('zh-TW')).toBe('部落格');
  });
});
