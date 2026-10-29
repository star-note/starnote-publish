import { adapterSchema, bindingForm, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { renderSlack, slackAdapter, slackBinding } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = slackAdapter.schema.parse({});

describe('Slack i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW', () => {
    const texts = (lang?: 'en' | 'zh-TW') =>
      renderSlack(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);
    expect(texts()).toContain('标题链接到辰记原文');
    expect(texts('en')).toContain('The title links to the StarNote original');
    expect(texts('zh-TW')).toContain('標題連結到辰記原文');
  });

  it('labels and validation messages per language', () => {
    expect(zodFieldMeta(adapterSchema(slackAdapter, 'zh-TW'))[1]!.description).toBe('連結');
    const r = bindingForm(slackBinding, 'en')!.safeParse({
      webhook_url: 'https://hooks.slack.com/services/T0/B0/x',
      label: '',
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Give this channel a name');
  });
});
