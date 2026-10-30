import { bindingInstructions, convert, runtimeNote } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { createGenericDeskAdapter, renderGeneric } from '../src/index';

describe('发布台通用模式 i18n (SPEC-r14 B5)', () => {
  it('names the platform in the language', () => {
    const adapter = createGenericDeskAdapter('sspai');
    expect(runtimeNote(adapter.runtimes![0]!, 'en')).toBe(
      'The Publish Desk opens the Sspai editor with the title and body filled in; you pick the platform’s options and publish'
    );
    expect(bindingInstructions(adapter.binding, 'zh-TW')![0]).toBe(
      '在辰記桌面版點「在桌面版登入少數派」'
    );
  });

  it('reports in English and 繁體', () => {
    const doc = convert({ type: 'doc', content: [] });
    expect(renderGeneric(doc, { title: 'x'.repeat(120) }, undefined, 'en').report[0]!.text).toBe(
      'Title is over 100 characters and was shortened'
    );
    expect(renderGeneric(doc, { title: 'x'.repeat(120) }, undefined, 'zh-TW').report[0]!.text).toBe(
      '標題超過 100 字，已截短'
    );
  });
});
