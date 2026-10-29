import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { renderThreads, threadsAdapter } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = threadsAdapter.schema.parse({});
const texts = (lang?: 'en' | 'zh-TW') =>
  renderThreads(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);

describe('threads i18n (SPEC-r14 B5)', () => {
  it('report in en and zh-TW', () => {
    expect(texts()).toContain('以链接卡片发出');
    expect(texts('en')).toContain('Posted with a link card');
    expect(texts('zh-TW')).toContain('以連結卡片發出');
  });

  it('form labels', () => {
    const tw = zodFieldMeta(adapterSchema(threadsAdapter, 'zh-TW'));
    expect(tw.find((f) => f.name === 'text')?.description).toBe('貼文文案');
  });
});
