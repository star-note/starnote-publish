import { planRuntime } from '@starnote/publish-core';
import { xWeightedLength } from '@starnote/publish-kit';
import { describe, expect, it, vi } from 'vitest';

import { CANONICAL, fixtureDoc, runPublish } from '../../kit/test/helpers';
import {
  buildShare,
  createShareAdapter,
  handoffOf,
  SHARE_KEYS,
  SHARE_PLATFORMS,
  shareAdapters,
} from '../src/index';

const LINK = 'https://starnote.app/@me/abc123?ref=a&b=c d';
const base = {
  title: 'Hello & welcome',
  summary: 'Short summary.',
  tags: ['Type Script', 'web'],
  link: LINK,
};

function params(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe('buildShare: URLs', () => {
  it('X: intent/tweet with text, url and comma hashtags, all encoded', () => {
    const r = buildShare('x', base);
    expect(r.openUrl.startsWith('https://x.com/intent/tweet?')).toBe(true);
    expect(params(r.openUrl)).toEqual({
      text: 'Hello & welcome\n\nShort summary.',
      url: LINK,
      hashtags: 'TypeScript,web',
    });
    expect(r.openUrl).toContain(
      'url=https%3A%2F%2Fstarnote.app%2F%40me%2Fabc123%3Fref%3Da%26b%3Dc+d'
    );
    expect(r.copyText).toBe(`Hello & welcome\n\nShort summary. #TypeScript #web ${LINK}`);
  });

  it('Threads, Telegram, 微博 carry the text; Reddit the title', () => {
    expect(params(buildShare('threads', base).openUrl)).toEqual({
      text: 'Hello & welcome\n\nShort summary.\n\n#TypeScript',
      url: LINK,
    });
    expect(
      buildShare('threads', base).openUrl.startsWith('https://www.threads.com/intent/post?')
    ).toBe(true);
    expect(params(buildShare('telegram', base).openUrl)).toEqual({
      url: LINK,
      text: 'Hello & welcome\n\nShort summary.\n\n#TypeScript #web',
    });
    expect(params(buildShare('weibo', { ...base, picture: 'https://cdn/c.png' }).openUrl)).toEqual({
      url: LINK,
      title: 'Hello & welcome\n\nShort summary.\n\n#TypeScript# #web#',
      pic: 'https://cdn/c.png',
    });
    const reddit = buildShare('reddit', { ...base, subreddit: 'webdev' });
    expect(reddit.openUrl.startsWith('https://www.reddit.com/r/webdev/submit?')).toBe(true);
    expect(params(reddit.openUrl)).toEqual({ url: LINK, title: 'Hello & welcome' });
  });

  it('LinkedIn / Facebook only take the link; the text is for the clipboard', () => {
    const li = buildShare('linkedin', base);
    expect(params(li.openUrl)).toEqual({ url: LINK });
    expect(li.copyText).toBe('Hello & welcome\n\nShort summary.\n\n#TypeScript #web');
    expect(li.report.map((i) => i.kind)).toContain('share.copy');
    expect(params(buildShare('facebook', base).openUrl)).toEqual({ u: LINK });
    const dialog = buildShare('facebook', { ...base, facebookAppId: '123' });
    expect(dialog.openUrl.startsWith('https://www.facebook.com/dialog/share?')).toBe(true);
    expect(params(dialog.openUrl)).toEqual({
      app_id: '123',
      display: 'page',
      href: LINK,
      hashtag: '#TypeScript',
    });
  });

  it('Medium: Import story page, copy the original link', () => {
    const r = buildShare('medium', base);
    expect(r.openUrl).toBe('https://medium.com/p/import');
    expect(r.copyText).toBe(LINK);
    expect(r.report.map((i) => i.kind)).toEqual(['handoff.pending', 'canonical.set']);
  });
});

describe('buildShare: Pinterest', () => {
  it('pin/create/button with the link, the cover as media and the description', () => {
    const r = buildShare('pinterest', { ...base, picture: 'https://starnote.app/covers/c.png' });
    expect(r.openUrl.startsWith('https://www.pinterest.com/pin/create/button/?')).toBe(true);
    expect(params(r.openUrl)).toEqual({
      url: LINK,
      media: 'https://starnote.app/covers/c.png',
      description: 'Hello & welcome\n\nShort summary.\n\n#TypeScript #web',
    });
    const noImage = buildShare('pinterest', base);
    expect(params(noImage.openUrl).media).toBeUndefined();
    expect(noImage.report.map((i) => i.kind)).toContain('share.no-image');
  });

  it('the adapter takes the cover from the common form', async () => {
    const a = createShareAdapter('pinterest', { assetBase: 'https://starnote.app/' });
    const { result } = await runPublish(
      a,
      { common: { title: 'T', cover: '/covers/c.png' } },
      { runtime: 'web' }
    );
    expect(params(result.handoff!.openUrl).media).toBe('https://starnote.app/covers/c.png');
  });
});

describe('buildShare: length fitting', () => {
  it('X counts CJK as 2, links as 23 and trims summary, then topics, then the title', () => {
    const long = buildShare('x', {
      ...base,
      title: '标题'.repeat(10),
      summary: '摘要内容'.repeat(60),
    });
    const total =
      xWeightedLength(long.text) +
      24 +
      long.hashtags.reduce((n, t) => n + 2 + xWeightedLength(t), 0);
    expect(total).toBeLessThanOrEqual(280);
    expect(long.text.startsWith('标题'.repeat(10))).toBe(true);
    expect(long.text.endsWith('…')).toBe(true);
    expect(long.report.find((i) => i.kind === 'share.truncated')?.text).toContain('280 字符');

    const huge = buildShare('x', { ...base, title: '长'.repeat(400), summary: '' });
    expect(huge.hashtags).toEqual([]);
    expect(xWeightedLength(huge.text) + 24).toBeLessThanOrEqual(280);
    expect(huge.report.find((i) => i.kind === 'tags.trimmed')?.count).toBe(2);
  });

  it('Reddit titles stop at 300; Threads at 500; 微博 counts ASCII as half', () => {
    expect([...buildShare('reddit', { ...base, title: 'a'.repeat(400) }).text]).toHaveLength(300);
    const t = buildShare('threads', { ...base, summary: 'x'.repeat(1000) });
    expect([...t.text].length + 1 + LINK.length + '\n\n#TypeScript'.length).toBeLessThanOrEqual(
      500
    );
    // 3000 ASCII chars weigh 1500 字 on 微博: fits without truncation.
    expect(
      buildShare('weibo', { ...base, summary: 'x'.repeat(3000) }).report.map((i) => i.kind)
    ).not.toContain('share.truncated');
  });

  it('caps topics per platform and normalizes them', () => {
    const r = buildShare('threads', { ...base, tags: ['a b', 'c', 'd'] });
    expect(r.hashtags).toEqual(['ab']);
    expect(r.report.find((i) => i.kind === 'tags.trimmed')?.count).toBe(2);
  });
});

describe('share adapters', () => {
  it('cover every platform on every runtime with no binding', () => {
    expect([...SHARE_KEYS].sort()).toEqual([
      'facebook',
      'linkedin',
      'medium',
      'pinterest',
      'reddit',
      'telegram',
      'threads',
      'weibo',
      'x',
    ]);
    for (const k of SHARE_KEYS) {
      const a = shareAdapters[k];
      expect(a.runtime).toEqual(['web', 'electron', 'server']);
      expect(a.binding).toEqual({ kind: 'none', store: 'none' });
      expect(a.runtimes?.[0]?.handoff?.url).toBe(SHARE_PLATFORMS[k].base);
    }
    const plan = planRuntime(shareAdapters.x, { runtime: 'web' });
    // Core's planRuntime still reads an electron `handoff` way as a desktop relay (suggested fix in core:
    // skip mode 'handoff' there); the hand-off guide is offered either way.
    expect(plan.guides.map((g) => g.kind)).toContain('handoff');
    expect(plan.guides.find((g) => g.kind === 'handoff')).toMatchObject({
      via: 'share-intent',
      href: 'https://x.com/intent/tweet',
    });
  });

  it('publish ends done with state handoff, an empty url and the hand-off report', async () => {
    const { result, terminal } = await runPublish(shareAdapters.x, {}, { runtime: 'web' });
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ type: 'done', url: '', state: 'handoff' });
    expect(result).toMatchObject({ ok: true, url: '', state: 'handoff' });
    const h = handoffOf(result.report)!;
    expect(h.via).toBe('share-intent');
    expect(params(h.openUrl).url).toBe(CANONICAL);
    expect(result.report?.find((i) => i.kind === 'handoff.pending')?.text).toBe(
      '已生成分享链接，需你在新窗口确认发出'
    );
  });

  it('takes short-text content and the user’s own text', async () => {
    const doc = fixtureDoc();
    const { result } = await runPublish(shareAdapters.telegram, {
      content: { kind: 'short-text', text: 'Read this', link: 'https://starnote.app/@me/x' },
      doc,
    });
    expect(params(handoffOf(result.report)!.openUrl)).toEqual({
      url: 'https://starnote.app/@me/x',
      text: 'Read this\n\n#TypeScript #webdev',
    });
  });

  it('uses the AI rewrite hook, still fitted to the limit, and falls back on errors', async () => {
    const rewrite = vi.fn(async () => 'AI says hi '.repeat(40));
    const ai = createShareAdapter('x', { rewrite });
    const { result } = await runPublish(ai, {});
    expect(rewrite).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'x', limit: 280, link: CANONICAL }),
      expect.anything()
    );
    const kinds = result.report?.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['summary.generated', 'share.truncated', 'handoff.pending'])
    );

    const broken = createShareAdapter('x', {
      rewrite: async () => {
        throw new Error('quota');
      },
    });
    const r2 = await runPublish(broken, {});
    expect(r2.result.ok).toBe(true);
    expect(r2.events.some((e) => e.type === 'log' && e.text.includes('AI 改写失败'))).toBe(true);
  });

  it('fails with help when there is no link to share', async () => {
    const doc = fixtureDoc();
    const { terminal } = await runPublish(
      shareAdapters.linkedin,
      { doc, content: { kind: 'article', doc } },
      { runtime: 'web' }
    );
    expect(terminal[0]).toMatchObject({ type: 'failed', code: 'no_link' });
    expect((terminal[0] as any).actions.map((a: any) => a.kind)).toEqual(['help']);
  });

  it('preview gives the URL and the copy text synchronously', () => {
    const doc = fixtureDoc();
    const p = shareAdapters.medium.preview!(
      doc,
      shareAdapters.medium.schema.parse({}),
      { title: 'T' },
      { kind: 'article', doc, canonicalUrl: CANONICAL }
    ) as any;
    expect(p).toMatchObject({
      format: 'text',
      url: 'https://medium.com/p/import',
      body: CANONICAL,
    });
  });
});
