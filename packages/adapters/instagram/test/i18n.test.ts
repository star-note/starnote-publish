import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import {
  instagramAdapter,
  instagramManualSteps,
  INSTAGRAM_MANUAL_STEPS,
  renderInstagram,
  renderInstagramApi,
} from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = instagramAdapter.schema.parse({});
const common = { cover: 'https://cdn.example.com/c.jpg' };

describe('instagram i18n (SPEC-r14 B5)', () => {
  it('hand-off report in en and zh-TW; the caption is not translated', () => {
    const en = renderInstagram(doc, form, common, article, { lang: 'en' });
    expect(en.report.find((i) => i.kind === 'handoff.pending')?.text).toMatch(
      /^Finish in the Instagram app/
    );
    expect(en.caption).toContain(`原文：${CANONICAL}`);
    const tw = renderInstagram(doc, form, common, article, { lang: 'zh-TW' });
    expect(tw.report.find((i) => i.kind === 'link.not-clickable')?.text).toContain('無法點擊');
  });

  it('API mode, manual steps and labels', () => {
    const r = renderInstagramApi(doc, form, common, article, { lang: 'en' });
    expect(r.report.find((i) => i.kind === 'processing')?.text).toBe(
      'Single-image post: Instagram publishes it once processed'
    );
    expect(instagramManualSteps()).toEqual(INSTAGRAM_MANUAL_STEPS);
    expect(instagramManualSteps('en')[1]).toBe('Copy the caption');
    const tw = zodFieldMeta(adapterSchema(instagramAdapter, 'zh-TW'));
    expect(tw.find((f) => f.name === 'max_images')?.description).toBe('圖片張數');
  });
});
