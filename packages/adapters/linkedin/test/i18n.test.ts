import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { linkedinAdapter, renderLinkedin } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = linkedinAdapter.schema.parse({ linkPlacement: 'body' });
const texts = (lang?: 'en' | 'zh-TW') =>
  renderLinkedin(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);

describe('linkedin i18n (SPEC-r14 B5)', () => {
  it('report in en and zh-TW', () => {
    expect(texts()).toContain('以文章卡片发出，点开是辰记原文');
    expect(texts('en')).toContain('Posted as an article card that opens the StarNote original');
    expect(texts('zh-TW')).toContain('以文章卡片發出，點開是辰記原文');
  });

  it('first-comment report and labels in en', () => {
    const r = renderLinkedin(doc, linkedinAdapter.schema.parse({}), {}, article, { lang: 'en' });
    expect(r.report.map((i) => i.text)).toContain(
      'The article link isn’t in the post; it’s posted as the first comment'
    );
    const en = zodFieldMeta(adapterSchema(linkedinAdapter, 'en'));
    expect(en.find((f) => f.name === 'visibility')?.description).toBe('Visibility');
  });
});
