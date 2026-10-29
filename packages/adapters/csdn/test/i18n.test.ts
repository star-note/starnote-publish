import { adapterSchema, bundledScript, convert } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { createCsdnAdapter, CSDN_SITE_SCRIPT, renderCsdn } from '../src/index';

const doc = convert({ type: 'doc', content: [] });

describe('CSDN i18n (SPEC-r14 B5)', () => {
  it('reports in English and 繁體', () => {
    const script = bundledScript(CSDN_SITE_SCRIPT);
    expect(renderCsdn(doc, { title: 'abc' }, script, 'en').report[0]!.text).toBe(
      'CSDN needs a title of at least 5 characters: complete it in the editor'
    );
    expect(renderCsdn(doc, { title: 'abc' }, script, 'zh-TW').report[0]!.text).toBe(
      'CSDN 要求標題至少 5 個字，請在編輯器裡補齊'
    );
  });

  it('validation messages follow the language', () => {
    const r = adapterSchema(createCsdnAdapter(), 'zh-TW').safeParse({ article_type: 'repost' });
    expect(r.error!.issues[0]!.message).toBe('轉載文章需要填寫原文連結');
  });
});
