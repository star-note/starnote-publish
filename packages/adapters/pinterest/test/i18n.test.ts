import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { pinterestAdapter, renderPinterest } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = pinterestAdapter.schema.parse({ board_id: '42' });
const common = { cover: 'https://cdn.example.com/c.jpg' };

describe('pinterest i18n (SPEC-r14 B5)', () => {
  it('report and errors in en and zh-TW', () => {
    const en = renderPinterest(doc, form, common, article, { lang: 'en' }).report.map(
      (i) => i.text
    );
    expect(en).toContain('Opening the Pin leads to the StarNote original');
    const tw = renderPinterest(doc, form, common, article, { lang: 'zh-TW' }).report;
    expect(tw.map((i) => i.text)).toContain('點開 Pin 會跳到辰記原文');
    expect(() =>
      renderPinterest(doc, pinterestAdapter.schema.parse({}), common, article, { lang: 'en' })
    ).toThrow('No board chosen yet');
  });

  it('form labels', () => {
    const tw = zodFieldMeta(adapterSchema(pinterestAdapter, 'zh-TW'));
    expect(tw.find((f) => f.name === 'board_id')?.description).toBe('圖版');
  });
});
