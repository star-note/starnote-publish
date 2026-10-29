import { bindingInstructions, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  githubPagesBinding,
  githubPagesSchema,
  githubPagesSchemaFor,
  normalizeDomain,
  renderPost,
} from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
});
const form = githubPagesSchema.parse({ repo: 'a/a.github.io', post_id: 'p1', canonical: 'chenji' });

describe('SPEC-r14 B5: GitHub Pages in three languages', () => {
  it('labels the form per language', () => {
    const label = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(githubPagesSchemaFor(lang)).find((f) => f.name === 'repo')?.description;
    expect(label('en')).toBe('Repository');
    expect(label('zh-TW')).toBe('儲存庫');
    expect(zodFieldMeta(githubPagesSchema).find((f) => f.name === 'repo')?.description).toBe(
      '仓库'
    );
  });

  it('reports and explains in the language', () => {
    const input = { doc, form, noteId: 'n', canonicalUrl: 'https://starnote.app/@a/1' };
    expect(renderPost({ ...input, lang: 'en' }).report[0]!.text).toBe(
      'Canonical link points to the StarNote original'
    );
    expect(renderPost({ ...input, lang: 'zh-TW' }).report[0]!.text).toBe('標準連結指向辰記原文');
    expect(bindingInstructions(githubPagesBinding, 'en')![2]).toContain('Permissions needed');
    expect(() => normalizeDomain('x', 'en')).toThrow('Enter a domain');
  });
});
