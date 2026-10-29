import { adapterSchema, bindingInstructions, bundledScript, convert } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { createWechatMpAdapter, renderWechatMp, WECHAT_MP_SITE_SCRIPT } from '../src/index';

const doc = convert({ type: 'doc', content: [] });

describe('公众号 i18n (SPEC-r14 B5)', () => {
  it('reports in English and 繁體', () => {
    const script = bundledScript(WECHAT_MP_SITE_SCRIPT);
    expect(
      renderWechatMp(doc, { title: 'x'.repeat(80) }, script, { lang: 'en' }).report.map(
        (r) => r.text
      )
    ).toContain('Title is over 64 characters and was shortened');
    expect(
      renderWechatMp(doc, { title: 'x'.repeat(80) }, script, { lang: 'zh-TW' }).report.map(
        (r) => r.text
      )
    ).toContain('標題超過 64 字，已截短');
  });

  it('form and binding help follow the language', () => {
    const adapter = createWechatMpAdapter();
    const r = adapterSchema(adapter, 'en').safeParse({ source_url: 'ftp://x' });
    expect(r.error!.issues[0]!.message).toBe('Enter a link starting with http(s)://');
    expect(bindingInstructions(adapter.binding, 'zh-TW')![0]).toBe(
      '在辰記桌面版點「在桌面版登入微信公眾號」'
    );
  });
});
