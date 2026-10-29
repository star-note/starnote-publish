import { adapterSchema, bindingInstructions, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { mastodonAdapter, mastodonBinding, renderMastodon } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = mastodonAdapter.schema.parse({});

describe('Mastodon i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW', () => {
    const texts = (lang?: 'en' | 'zh-TW') =>
      renderMastodon(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);
    expect(texts()).toContain('实例会按正文里的链接生成预览卡片');
    expect(texts('en')).toContain('The instance builds a preview card from the link in the post');
    expect(texts('zh-TW')).toContain('站台會依內文裡的連結產生預覽卡片');
  });

  it('labels and binding help per language', () => {
    const en = zodFieldMeta(adapterSchema(mastodonAdapter, 'en'));
    expect(en.find((f) => f.name === 'visibility')!.description).toBe('Visibility');
    const tw = zodFieldMeta(adapterSchema(mastodonAdapter, 'zh-TW'));
    expect(tw.find((f) => f.name === 'link')!.description).toBe('連結');
    expect(bindingInstructions(mastodonBinding, 'zh-TW')![0]).toContain('站台網域');
  });
});
