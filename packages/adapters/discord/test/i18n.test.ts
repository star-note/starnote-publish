import { adapterSchema, bindingForm, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { discordAdapter, discordBinding, discordHandoff, renderDiscord } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = discordAdapter.schema.parse({});

describe('Discord i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW', () => {
    const texts = (lang?: 'en' | 'zh-TW') =>
      renderDiscord(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);
    expect(texts()).toContain('以卡片发出：标题链接到原文');
    expect(texts('en')).toContain('Sent as a card whose title links to the original');
    expect(texts('zh-TW')).toContain('以卡片發出：標題連結到原文');
    const r = renderDiscord(doc, form, {}, article);
    expect(discordHandoff(r, 'en').report[0]!.text).toMatch(/^No Discord webhook connected yet/);
  });

  it('labels per language', () => {
    expect(zodFieldMeta(adapterSchema(discordAdapter, 'en'))[0]!.description).toBe(
      'Note above the card'
    );
    expect(zodFieldMeta(bindingForm(discordBinding, 'zh-TW')!)[0]!.description).toBe(
      'Webhook 網址'
    );
  });
});
