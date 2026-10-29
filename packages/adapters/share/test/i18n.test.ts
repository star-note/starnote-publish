import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { buildShare, createShareAdapter, shareInputOf, shareSchema } from '../src/index';

const input = { title: 'x'.repeat(400), link: 'https://starnote.app/p/1', tags: ['a', 'b', 'c'] };

describe('share i18n (SPEC-r14 B5)', () => {
  it('reports in en and zh-TW; zh-CN stays the default', () => {
    expect(buildShare('weibo', input).report.map((i) => i.text)).toContain(
      '已生成分享链接，需你在新窗口确认发出'
    );
    const en = buildShare('weibo', input, 'en').report.map((i) => i.text);
    expect(en).toContain('Share link ready: confirm the post in the new window');
    expect(en.some((t) => t.includes('Weibo'))).toBe(true);
    const tw = buildShare('x', { ...input, title: 'x'.repeat(400) }, 'zh-TW').report;
    expect(tw.find((i) => i.kind === 'share.truncated')?.text).toContain('字元');
  });

  it('form labels and errors per language', () => {
    const a = createShareAdapter('reddit');
    const meta = zodFieldMeta(adapterSchema(a, 'en'));
    expect(meta.find((f) => f.name === 'subreddit')?.description).toBe('Subreddit (r/…)');
    expect(zodFieldMeta(shareSchema).find((f) => f.name === 'link')?.description).toBe('分享链接');
    const doc = { title: 'T', images: [] } as never;
    const err = shareInputOf('x', doc, shareSchema.parse({}), {}, undefined, {}, 'zh-TW');
    expect(err).toEqual({ error: '還沒有可分享的連結：先發布到辰記（或在表單裡填寫連結）' });
  });
});
