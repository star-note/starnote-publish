import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { hatenaAdapter, hatenaBinding, renderHatena } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('Hatena Blog i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = hatenaAdapter.schema.parse({ draft: true });
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderHatena(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain('存为はてなブログ的下書き，检查后在后台公开');
    expect(texts('zh-TW')).toContain('存為はてなブログ的下書き，檢查後在後台公開');
    expect(texts('en')).toContain(
      'Saved as a Hatena Blog draft (下書き): check it and publish from the dashboard'
    );
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(hatenaAdapter, lang)).find((f) => f.name === 'syntax')
        ?.description;
    expect(label('zh-TW')).toBe('部落格編輯模式（Markdown / 見たまま）');
    expect(label('en')).toBe('Blog editing mode (Markdown / 見たまま WYSIWYG)');
    expect(bindingInstructions(hatenaBinding, 'en')?.[0]).toMatch(/^In Hatena Blog/);
  });
});
