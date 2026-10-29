import { bindingInstructions, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { bloggerBinding, bloggerSchema, bloggerSchemaFor, renderBlogger } from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
});

describe('SPEC-r14 B5: Blogger in three languages', () => {
  it('labels the form per language', () => {
    const label = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(bloggerSchemaFor(lang)).find((f) => f.name === 'blog_id')?.description;
    expect(label('en')).toBe('Blog');
    expect(label('zh-TW')).toBe('部落格');
    expect(bindingInstructions(bloggerBinding, 'zh-TW')![1]).toBe('回到辰記後選擇要發布到的部落格');
  });

  it('reports in the language', () => {
    const form = bloggerSchema.parse({ status: 'draft' });
    const text = (lang: 'en' | 'zh-TW') =>
      renderBlogger(doc, form, { cover: 'https://cdn.starnote.app/c.png' }, undefined, {
        lang,
      }).report.find((i) => i.kind === 'cover.inline')?.text;
    expect(text('en')).toBe('Blogger has no cover field, so the cover goes at the top of the post');
    expect(text('zh-TW')).toBe('Blogger 沒有封面欄位，封面圖放在內文開頭');
  });
});
