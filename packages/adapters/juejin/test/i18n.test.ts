import { adapterSchema, bindingInstructions, bundledScript, convert } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { createJuejinAdapter, JUEJIN_SITE_SCRIPT, juejinBrief, renderJuejin } from '../src/index';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '短' }] }],
});

describe('掘金 i18n (SPEC-r14 B5)', () => {
  const adapter = createJuejinAdapter();

  it('reports in English and 繁體', () => {
    expect(juejinBrief('短', '短', 50, 100, 'en').report[0]!.text).toBe(
      'The body is shorter than 50 characters; Juejin may refuse it'
    );
    const tw = renderJuejin(
      doc,
      { title: '長'.repeat(120) },
      bundledScript(JUEJIN_SITE_SCRIPT),
      undefined,
      'zh-TW'
    );
    expect(tw.report.map((r) => r.text)).toContain('標題超過 100 字，已截短');
  });

  it('validation messages follow the language', () => {
    const r = adapterSchema(adapter, 'en').safeParse({ mode: 'publish' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).toEqual([
      'Choose a Juejin category',
      'Choose at least 1 tag',
    ]);
    expect(bindingInstructions(adapter.binding, 'en')![0]).toContain('Log in to Juejin');
  });
});
