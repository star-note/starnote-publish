import { bindingForm, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  renderWordpress,
  wordpressBinding,
  wordpressSchema,
  wordpressSchemaFor,
} from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
});

describe('SPEC-r14 B5: WordPress in three languages', () => {
  it('labels the forms per language', () => {
    const label = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(wordpressSchemaFor(lang)).find((f) => f.name === 'categories')?.description;
    expect(label('en')).toBe('Categories');
    expect(label('zh-TW')).toBe('分類');
    const key = zodFieldMeta(bindingForm(wordpressBinding, 'zh-TW')!);
    expect(key.find((f) => f.name === 'username')?.description).toBe('使用者名稱');
  });

  it('reports in the language', () => {
    const form = wordpressSchema.parse({ status: 'pending' });
    const text = (lang: 'en' | 'zh-TW') =>
      renderWordpress(doc, form, {}, undefined, { lang }).report.find(
        (i) => i.kind === 'draft.only'
      )?.text;
    expect(text('en')).toBe(
      'Submitted as “Pending review”: a site editor publishes it after review'
    );
    expect(text('zh-TW')).toBe('送出為「待審」，由網站編輯審核後發布');
  });
});
