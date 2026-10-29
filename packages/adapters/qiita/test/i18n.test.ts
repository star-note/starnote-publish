import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { qiitaAdapter, qiitaBinding, renderQiita } from '../src/index';

/** SPEC-r14 B5: the same render in 繁體中文 and English; no `lang` stays 简体. */
describe('Qiita i18n', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
  const form = qiitaAdapter.schema.parse({ private: true });
  const texts = (lang?: 'zh-TW' | 'en') =>
    renderQiita(doc, form, { title: 'Hello' }, content, lang ? { lang } : {}).report.map(
      (i) => i.text
    );

  it('reports in the requested language', () => {
    expect(texts()).toContain('以「限定共有」发出：只有拿到链接的人能看，可以在 Qiita 上改为公开');
    expect(texts('zh-TW')).toContain(
      '以「限定共有」發出：只有拿到連結的人能看，可以在 Qiita 上改為公開'
    );
    expect(texts('en')).toContain(
      'Posted as limited sharing (限定共有): only people with the link can read it; you can make it public on Qiita'
    );
  });

  it('labels the form and the binding help in the requested language', () => {
    const label = (lang: 'zh-TW' | 'en') =>
      zodFieldMeta(adapterSchema(qiitaAdapter, lang)).find((f) => f.name === 'private')
        ?.description;
    expect(label('zh-TW')).toBe('限定共有（不公開）');
    expect(label('en')).toBe('Limited sharing (限定共有, not public)');
    expect(bindingInstructions(qiitaBinding, 'en')?.[0]).toMatch(/^In Qiita/);
  });
});
