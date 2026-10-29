import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { zennAdapter, zennBinding, renderZenn } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('Zenn i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = zennAdapter.schema.parse({ published: false });
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderZenn(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain(
      '以下書き（published: false）提交，在 Zenn 上检查后把 published 改为 true'
    );
    expect(texts('zh-TW')).toContain(
      '以下書き（published: false）提交，在 Zenn 上檢查後把 published 改為 true'
    );
    expect(texts('en')).toContain(
      'Committed as a draft (published: false): check it on Zenn, then set published to true'
    );
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(zennAdapter, lang)).find((f) => f.name === 'emoji')?.description;
    expect(label('zh-TW')).toBe('圖示 emoji');
    expect(label('en')).toBe('Icon emoji');
    expect(bindingInstructions(zennBinding, 'en')?.[0]).toMatch(/^First link a GitHub repository/);
  });
});
