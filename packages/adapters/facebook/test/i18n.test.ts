import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { facebookAdapter, facebookBinding, renderFacebook } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = facebookAdapter.schema.parse({});

describe('facebook i18n (SPEC-r14 B5)', () => {
  it('report in en and zh-TW', () => {
    expect(renderFacebook(doc, form, {}, article).report[0]!.text).toBe(
      'Facebook 会按链接生成预览卡片'
    );
    expect(renderFacebook(doc, form, {}, article, { lang: 'en' }).report[0]!.text).toBe(
      'Facebook will make a preview card from the link'
    );
    expect(renderFacebook(doc, form, {}, article, { lang: 'zh-TW' }).report[0]!.text).toBe(
      'Facebook 會依連結產生預覽卡片'
    );
  });

  it('form labels and binding help', () => {
    const en = zodFieldMeta(adapterSchema(facebookAdapter, 'en'));
    expect(en.find((f) => f.name === 'page_id')?.description).toBe('Page');
    expect(bindingInstructions(facebookBinding, 'zh-TW')?.[0]).toContain('授權');
  });
});
