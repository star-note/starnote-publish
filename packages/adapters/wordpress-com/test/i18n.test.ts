import { bindingInstructions, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  renderWordpressCom,
  wordpressComBinding,
  wordpressComSchema,
  wordpressComSchemaFor,
} from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
});

describe('SPEC-r14 B5: WordPress.com in three languages', () => {
  it('labels the form per language', () => {
    const label = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(wordpressComSchemaFor(lang)).find((f) => f.name === 'site_id')?.description;
    expect(label('en')).toBe('Site');
    expect(label('zh-TW')).toBe('網站');
    expect(bindingInstructions(wordpressComBinding, 'en')![0]).toContain(
      'Authorize with WordPress.com'
    );
  });

  it('reports in the language', () => {
    const form = wordpressComSchema.parse({ status: 'private' });
    const text = (lang: 'en' | 'zh-TW') =>
      renderWordpressCom(doc, form, {}, undefined, { lang }).report.find(
        (i) => i.kind === 'draft.only'
      )?.text;
    expect(text('en')).toBe('Published as private: only site admins and editors can see it');
    expect(text('zh-TW')).toBe('以私密文章發布，只有網站管理員和編輯看得到');
  });
});
