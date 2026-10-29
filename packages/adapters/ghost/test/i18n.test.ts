import { bindingInstructions, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { ghostBinding, ghostSchema, ghostSchemaFor, renderGhost } from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'image', attrs: { src: 'https://cdn.starnote.app/a.png' } }],
});

describe('SPEC-r14 B5: Ghost in three languages', () => {
  it('labels the form per language', () => {
    const label = (lang: 'en' | 'zh-TW') =>
      zodFieldMeta(ghostSchemaFor(lang)).find((f) => f.name === 'visibility')?.description;
    expect(label('en')).toBe('Visibility');
    expect(label('zh-TW')).toBe('可見範圍');
    expect(bindingInstructions(ghostBinding, 'zh-TW')![2]).toBe(
      '在 Ghost 後台刪除這個整合，金鑰立即失效'
    );
  });

  it('reports in the language', () => {
    const form = ghostSchema.parse({});
    const text = (lang: 'en' | 'zh-TW') =>
      renderGhost(doc, form, {}, undefined, { lang }).report.find(
        (i) => i.kind === 'image.rehosted'
      )?.text;
    expect(text('en')).toBe('1 image will be uploaded to the Ghost site');
    expect(text('zh-TW')).toBe('1 張圖片將上傳到 Ghost 網站');
  });
});
