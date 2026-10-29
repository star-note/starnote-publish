import {
  adapterSchema,
  bindingForm,
  bindingPermissions,
  zodFieldMeta,
} from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { renderTelegram, telegramAdapter, telegramBinding } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = telegramAdapter.schema.parse({ with_cover: false });

describe('Telegram i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW', () => {
    const texts = (lang?: 'en' | 'zh-TW') =>
      renderTelegram(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);
    expect(texts()).toContain('Telegram 会按链接生成预览卡片');
    expect(texts('en')).toContain('Telegram builds a preview card from the link');
    expect(texts('zh-TW')).toContain('Telegram 會依連結產生預覽卡片');
  });

  it('labels, key form and permissions per language', () => {
    expect(zodFieldMeta(adapterSchema(telegramAdapter, 'en'))[0]!.description).toBe('Message text');
    expect(zodFieldMeta(bindingForm(telegramBinding, 'zh-TW')!)[0]!.description).toBe('機器人權杖');
    expect(bindingPermissions(telegramBinding, 'en')![1]).toMatch(/^Group:/);
  });
});
