import { bindingInstructions, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { hashnodeBinding, hashnodeSchema, hashnodeSchemaFor, renderHashnode } from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
});

describe('SPEC-r14 B5: Hashnode in three languages', () => {
  it('labels the form per language', () => {
    const label = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(hashnodeSchemaFor(lang)).find((f) => f.name === 'subtitle')?.description;
    expect(label('en')).toBe('Subtitle');
    expect(label('zh-TW')).toBe('副標題');
    expect(bindingInstructions(hashnodeBinding, 'en')![0]).toContain('generate a new token');
  });

  it('reports in the language', () => {
    const form = hashnodeSchema.parse({ mode: 'draft' });
    const draft = (lang: 'en' | 'zh-TW') =>
      renderHashnode(doc, form, {}, undefined, { lang }).report.find((i) => i.kind === 'draft.only')
        ?.text;
    expect(draft('en')).toBe(
      'Saved to Hashnode unpublished: check it, then publish from the Hashnode dashboard'
    );
    expect(draft('zh-TW')).toBe('以未公開狀態儲存到 Hashnode，檢查後在 Hashnode 後台發布');
  });
});
