import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { telegraphAdapter, telegraphBinding, renderTelegraph } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('Telegraph i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = telegraphAdapter.schema.parse({});
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderTelegraph(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain('文末注明首发于辰记并附原文链接');
    expect(texts('zh-TW')).toContain('文末註明首發於辰記並附上原文連結');
    expect(texts('en')).toContain(
      'Added a line at the end saying it first appeared on StarNote, with the link'
    );
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(telegraphAdapter, lang)).find((f) => f.name === 'author_url')
        ?.description;
    expect(label('zh-TW')).toBe('作者連結');
    expect(label('en')).toBe('Author link');
    expect(bindingInstructions(telegraphBinding, 'en')?.[0]).toMatch(/^Telegraph needs no sign-up/);
  });
});
