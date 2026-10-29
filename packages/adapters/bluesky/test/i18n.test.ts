import {
  adapterSchema,
  bindingForm,
  bindingInstructions,
  zodFieldMeta,
} from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { fixtureDoc } from '../../kit/test/helpers';
import { blueskyAdapter, blueskyBinding, renderBluesky } from '../src/index';

const doc = fixtureDoc();
const form = blueskyAdapter.schema.parse({});

describe('Bluesky i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW; zh-CN stays the default', () => {
    const content = { kind: 'article' as const, doc };
    expect(renderBluesky(doc, form, {}, content).report.map((i) => i.text)).toContain(
      '还没有辰记原文链接，这条帖子不带链接（先发布到辰记再同步可以带上原文卡片）'
    );
    expect(renderBluesky(doc, form, {}, content, { lang: 'en' }).report[0]!.text).toMatch(
      /^No StarNote original yet/
    );
    expect(renderBluesky(doc, form, {}, content, { lang: 'zh-TW' }).report[0]!.text).toContain(
      '還沒有辰記原文連結'
    );
  });

  it('labels, key form and binding help per language', () => {
    const labels = zodFieldMeta(adapterSchema(blueskyAdapter, 'en')).map((f) => f.description);
    expect(labels).toContain('Post text');
    expect(zodFieldMeta(adapterSchema(blueskyAdapter, 'zh-TW'))[0]!.description).toBe('貼文文字');
    expect(zodFieldMeta(bindingForm(blueskyBinding, 'en')!)[0]!.description).toBe(
      'Handle (optional)'
    );
    expect(bindingInstructions(blueskyBinding, 'en')![1]).toBe(
      'Sign in on the Bluesky authorization page and allow StarNote'
    );
  });
});
