import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { buttondownAdapter, buttondownBinding, renderButtondown } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('Buttondown i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = buttondownAdapter.schema.parse({});
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderButtondown(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain('存为 Buttondown 草稿，在 Buttondown 里检查后发送');
    expect(texts('zh-TW')).toContain('存為 Buttondown 草稿，在 Buttondown 裡檢查後發送');
    expect(texts('en')).toContain('Saved as a Buttondown draft: check it in Buttondown, then send');
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(buttondownAdapter, lang)).find((f) => f.name === 'slug')
        ?.description;
    expect(label('zh-TW')).toBe('網址');
    expect(label('en')).toBe('URL slug');
    expect(bindingInstructions(buttondownBinding, 'en')?.[0]).toMatch(/^Open Buttondown/);
  });
});
