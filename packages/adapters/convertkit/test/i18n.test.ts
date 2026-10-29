import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { convertkitAdapter, convertkitBinding, renderConvertkit } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('Kit i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = convertkitAdapter.schema.parse({});
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderConvertkit(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain('存为 Kit 草稿，在 Kit 里检查收件人后发送');
    expect(texts('zh-TW')).toContain('存為 Kit 草稿，在 Kit 裡檢查收件人後發送');
    expect(texts('en')).toContain('Saved as a Kit draft: check the recipients in Kit, then send');
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(convertkitAdapter, lang)).find((f) => f.name === 'canonical_url')
        ?.description;
    expect(label('zh-TW')).toBe('原文連結');
    expect(label('en')).toBe('Canonical link');
    expect(bindingInstructions(convertkitBinding, 'en')?.[0]).toMatch(/^In Kit, open Settings/);
  });
});
