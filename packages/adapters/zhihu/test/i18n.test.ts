import { adapterSchema, bindingInstructions, convert, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { createZhihuAdapter, renderZhihu, ZHIHU_SITE_SCRIPT } from '../src/index';
import { bundledScript } from '@starnote/publish-core';

const long = 'あ'.repeat(120);
const doc = convert({
  type: 'doc',
  content: [{ type: 'imageBlock', attrs: { src: 'https://cdn.starnote.app/a.png' } }],
});

describe('知乎 i18n (SPEC-r14 B5)', () => {
  const adapter = createZhihuAdapter();
  const script = bundledScript(ZHIHU_SITE_SCRIPT);

  it('reports in English and 繁體', async () => {
    const en = await adapter.preview!(
      doc,
      { topics: [], mode: 'prefill' },
      { title: long },
      undefined,
      { lang: 'en' }
    );
    expect(en.report.map((r) => r.text)).toContain(
      'Title is over 100 characters and was shortened'
    );
    expect(en.report.map((r) => r.text)).toContain('1 image will be uploaded to Zhihu');
    const tw = renderZhihu(doc, { title: long }, script, 'zh-TW');
    expect(tw.report[0]!.text).toBe('標題超過 100 字，已截短');
    // default stays 简体
    expect(renderZhihu(doc, { title: long }, script).report[0]!.text).toBe(
      '标题超过 100 字，已截短'
    );
  });

  it('form labels, validation and binding help follow the language', () => {
    const en = adapterSchema(adapter, 'en');
    expect(zodFieldMeta(en).find((f) => f.name === 'topics')?.description).toBe('Topics');
    const bad = en.safeParse({ topics: ['a', 'b', 'c', 'd'] });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.message).toBe('At most 3 topics');
    expect(bindingInstructions(adapter.binding, 'zh-TW')![0]).toBe(
      '在辰記桌面版點「在桌面版登入知乎」'
    );
    expect(adapter.runtimes![0]!.notes?.en).toBe('Level 1: the platform website’s own API');
  });
});
