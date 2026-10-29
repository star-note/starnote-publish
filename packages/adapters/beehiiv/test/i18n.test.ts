import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { beehiivAdapter, beehiivBinding, renderBeehiiv } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('beehiiv i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = beehiivAdapter.schema.parse({});
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderBeehiiv(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain('存为 beehiiv 草稿，在 beehiiv 里检查后发布');
    expect(texts('zh-TW')).toContain('存為 beehiiv 草稿，在 beehiiv 裡檢查後發布');
    expect(texts('en')).toContain('Saved as a beehiiv draft: check it in beehiiv, then publish');
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(beehiivAdapter, lang)).find((f) => f.name === 'status')
        ?.description;
    expect(label('zh-TW')).toBe('發布方式');
    expect(label('en')).toBe('Publishing');
    expect(bindingInstructions(beehiivBinding, 'en')?.[0]).toMatch(/^Note: beehiiv/);
  });
});
