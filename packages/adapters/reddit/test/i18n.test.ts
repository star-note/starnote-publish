import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc } from '../../kit/test/helpers';
import { redditAdapter, renderReddit } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const form = redditAdapter.schema.parse({ subreddit: 'test' });
const texts = (lang?: 'en' | 'zh-TW') =>
  renderReddit(doc, form, {}, article, lang ? { lang } : {}).report.map((i) => i.text);

describe('reddit i18n (SPEC-r14 B5)', () => {
  it('report in en and zh-TW', () => {
    expect(texts()).toContain(`以链接帖发布，指向 ${CANONICAL}`);
    expect(texts('en')).toContain(`Posted as a link post to ${CANONICAL}`);
    expect(texts('zh-TW')).toContain(`以連結貼文發布，指向 ${CANONICAL}`);
  });

  it('validation messages per language', () => {
    const r = adapterSchema(redditAdapter, 'en').safeParse({ subreddit: 'a b' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('letters, digits and underscores');
    const tw = zodFieldMeta(adapterSchema(redditAdapter, 'zh-TW'));
    expect(tw.find((f) => f.name === 'kind')?.description).toBe('貼文類型');
  });
});
