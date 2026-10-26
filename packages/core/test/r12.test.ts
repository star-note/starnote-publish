import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { articleContent, visibleLinkOf, withTrackingUrl } from '../src/content';
import { convert } from '../src/convert';
import { defineAdapter } from '../src/define';
import { checkMedia, formatRatio, mediaFormat, mediaItemsOf, mediaReport } from '../src/media';
import { platformMeta } from '../src/platforms';
import {
  isUrlExternalId,
  normalizePostUrl,
  parsePostUrl,
  POST_URL_PLATFORMS,
  shortcodeOf,
} from '../src/post-url';
import { toScheduleTasks } from '../src/prepare';
import { createPublisher } from '../src/publisher';
import { followUpKeyOf } from '../src/targets';

import type {
  Adapter,
  FollowUpInput,
  FollowUpParent,
  PublishContext,
  PublishEvent,
  PublishJob,
  PublishOutput,
} from '../src/types';

const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'hi there' }] },
  ],
});

function job(extra: Partial<PublishJob> = {}): PublishJob {
  return { noteId: 'n1', doc, common: { title: 'T' }, perPlatform: {}, ...extra };
}

/* ---------------- §1.1 parsePostUrl ---------------- */

describe('parsePostUrl (SPEC-r12 §1.1)', () => {
  const cases: Array<[string, string, string | null, string?]> = [
    [
      'zhihu',
      'https://zhuanlan.zhihu.com/p/123456?utm_source=x',
      '123456',
      'https://zhuanlan.zhihu.com/p/123456',
    ],
    [
      'zhihu',
      'https://www.zhihu.com/question/11/answer/22',
      'answer:22',
      'https://www.zhihu.com/question/11/answer/22',
    ],
    ['zhihu', 'https://juejin.cn/post/7300000000000000000', null],
    [
      'juejin',
      'juejin.cn/post/7300000000000000000',
      '7300000000000000000',
      'https://juejin.cn/post/7300000000000000000',
    ],
    [
      'csdn',
      'https://blog.csdn.net/me/article/details/1357?spm=1001',
      '1357',
      'https://blog.csdn.net/me/article/details/1357',
    ],
    [
      'wechat',
      'https://mp.weixin.qq.com/s/AbCdEf_123-x#rd',
      'https://mp.weixin.qq.com/s/AbCdEf_123-x',
    ],
    [
      'wechat',
      'http://mp.weixin.qq.com/s?__biz=MzA&mid=2650&idx=1&sn=abc&chksm=zz&scene=21#wechat_redirect',
      'https://mp.weixin.qq.com/s?__biz=MzA&mid=2650&idx=1&sn=abc',
    ],
    ['devto', 'https://dev.to/me/my-post-1a2b/', 'https://dev.to/me/my-post-1a2b'],
    ['devto', 'https://dev.to/t/javascript', null],
    ['hashnode', 'https://me.hashnode.dev/my-post?source=feed', 'https://me.hashnode.dev/my-post'],
    ['mastodon', 'https://mastodon.social/@me/1131', '1131', 'https://mastodon.social/@me/1131'],
    [
      'mastodon',
      'https://fosstodon.org/users/me/statuses/77',
      '77',
      'https://fosstodon.org/@me/77',
    ],
    [
      'bluesky',
      'https://bsky.app/profile/me.bsky.social/post/3kabc2',
      '3kabc2',
      'https://bsky.app/profile/me.bsky.social/post/3kabc2',
    ],
    [
      'reddit',
      'https://www.reddit.com/r/typescript/comments/1AbCd/some_title/',
      '1abcd',
      'https://www.reddit.com/r/typescript/comments/1abcd/',
    ],
    ['reddit', 'https://redd.it/xyz9', 'xyz9'],
    ['x', 'https://x.com/u/status/123?s=20', '123', 'https://x.com/u/status/123'],
    ['x', 'https://twitter.com/u/status/456', '456', 'https://x.com/u/status/456'],
    ['x', 'https://x.com/u', null],
    [
      'threads',
      'https://www.threads.net/@me/post/C1a-B_2',
      'code:C1a-B_2',
      'https://www.threads.net/@me/post/C1a-B_2',
    ],
    ['threads', 'https://www.threads.com/@me/post/DdD', 'code:DdD'],
    [
      'linkedin',
      'https://www.linkedin.com/feed/update/urn:li:share:7001/',
      'urn:li:share:7001',
      'https://www.linkedin.com/feed/update/urn:li:share:7001',
    ],
    [
      'linkedin',
      'https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A42',
      'urn:li:ugcPost:42',
    ],
    [
      'linkedin',
      'https://www.linkedin.com/posts/me_some-title-activity-7123-AbCd?utm_source=share',
      'urn:li:activity:7123',
    ],
    [
      'facebook',
      'https://www.facebook.com/permalink.php?story_fbid=200&id=100&ref=x',
      '100_200',
      'https://www.facebook.com/permalink.php?story_fbid=200&id=100',
    ],
    ['facebook', 'https://www.facebook.com/100/posts/200', '100_200'],
    [
      'facebook',
      'https://www.facebook.com/mypage/posts/pfbid02abc',
      'https://www.facebook.com/mypage/posts/pfbid02abc',
    ],
    [
      'instagram',
      'https://www.instagram.com/reel/C9xYz/?igsh=1',
      'code:C9xYz',
      'https://www.instagram.com/reel/C9xYz/',
    ],
    ['instagram', 'https://www.instagram.com/p/AbC12/', 'code:AbC12'],
    ['pinterest', 'https://www.pinterest.com/pin/998877/', '998877'],
    ['pinterest', 'https://jp.pinterest.com/pin/123/', '123'],
    ['telegram', 'https://t.me/mychannel/42', '@mychannel:42', 'https://t.me/mychannel/42'],
    ['telegram', 'https://t.me/c/1234567/9', '-1001234567:9'],
    ['tumblr', 'https://me.tumblr.com/post/7654321/slug', '7654321'],
    [
      'tumblr',
      'https://www.tumblr.com/me/7654321/slug',
      '7654321',
      'https://www.tumblr.com/me/7654321',
    ],
    [
      'xiaohongshu',
      'https://www.xiaohongshu.com/explore/64a1b2c3d4e5f60718293a4b?xsec=1',
      '64a1b2c3d4e5f60718293a4b',
    ],
    [
      'xiaohongshu',
      'https://www.xiaohongshu.com/discovery/item/64a1b2c3d4e5f60718293a4b',
      '64a1b2c3d4e5f60718293a4b',
    ],
    ['xiaohongshu', 'http://xhslink.com/a/AbCd', 'https://xhslink.com/a/AbCd'],
    [
      'medium',
      'https://medium.com/@me/a-story-123abc?source=rss',
      'https://medium.com/@me/a-story-123abc',
    ],
    ['substack', 'https://me.substack.com/p/hello', 'https://me.substack.com/p/hello'],
  ];

  it.each(cases)('%s: %s', (platform, url, externalId, normalized) => {
    const r = parsePostUrl(platform, url);
    if (externalId === null) return expect(r).toBeNull();
    expect(r?.externalId).toBe(externalId);
    if (normalized) expect(r?.url).toBe(normalized);
  });

  it('rejects what is not an http(s) link, for every platform', () => {
    for (const p of [...POST_URL_PLATFORMS, 'medium', 'unknown']) {
      expect(parsePostUrl(p, '')).toBeNull();
      expect(parsePostUrl(p, 'not a link')).toBeNull();
      expect(parsePostUrl(p, 'ftp://x.com/u/status/1')).toBeNull();
      expect(parsePostUrl(p, 'javascript:alert(1)')).toBeNull();
    }
  });

  it('adapters get the same rules from defineAdapter (unless they bring their own)', () => {
    const base = {
      label: 'X',
      runtimes: [{ runtime: 'web' as const, mode: 'handoff' as const }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      publish: async () => ({ url: '' }),
    };
    const x = defineAdapter({ ...base, key: 'x' });
    expect(x.parsePostUrl?.('https://x.com/a/status/9')).toEqual({
      externalId: '9',
      url: 'https://x.com/a/status/9',
    });
    expect(x.parsePostUrl?.('https://juejin.cn/post/1')).toBeNull();
    const own = defineAdapter({ ...base, key: 'x', parsePostUrl: () => null });
    expect(own.parsePostUrl?.('https://x.com/a/status/9')).toBeNull();
  });

  it('helpers for stats readers', () => {
    expect(isUrlExternalId('https://dev.to/a/b')).toBe(true);
    expect(isUrlExternalId('123')).toBe(false);
    expect(shortcodeOf('code:AbC_1')).toBe('AbC_1');
    expect(shortcodeOf('1789')).toBeUndefined();
    expect(normalizePostUrl('https://a.com/x/?utm_source=t&p=2#h')).toBe('https://a.com/x?p=2');
  });
});

/* ---------------- §3 checkMedia ---------------- */

describe('parsePostUrl hardening (review)', () => {
  it('refuses overlong input and stays linear on long LinkedIn slugs', () => {
    expect(parsePostUrl('x', `https://x.com/u/status/1?${'a'.repeat(2100)}`)).toBeNull();
    const slug = '-a'.repeat(1000);
    const t = Date.now();
    expect(parsePostUrl('linkedin', `https://www.linkedin.com/posts/me${slug}`)).toBeNull();
    expect(
      parsePostUrl(
        'linkedin',
        `https://www.linkedin.com/posts/me${'-ab'.repeat(300)}-activity-77-Xy`
      )?.externalId
    ).toBe('urn:li:activity:77');
    expect(Date.now() - t).toBeLessThan(200);
  });

  it('Pinterest only on its own domains', () => {
    expect(parsePostUrl('pinterest', 'https://www.pinterest.co.uk/pin/5/')?.externalId).toBe('5');
    expect(parsePostUrl('pinterest', 'https://pinterest.com.io/pin/5/')).toBeNull();
    expect(parsePostUrl('pinterest', 'https://pinterest.ev.il/pin/5/')).toBeNull();
  });

  it('Mastodon: a remote post seen through another instance is kept as its link', () => {
    expect(parsePostUrl('mastodon', 'https://mastodon.social/@bob@other.org/123')).toEqual({
      externalId: 'https://mastodon.social/@bob@other.org/123',
      url: 'https://mastodon.social/@bob@other.org/123',
    });
  });
});

describe('checkMedia (SPEC-r12 §3)', () => {
  it('Instagram: a 3:1 cover is an error that names the allowed ratio', () => {
    const items = checkMedia(
      platformMeta('instagram')?.limits?.media,
      [{ role: 'cover', width: 1200, height: 400 }],
      { platform: 'Instagram' }
    );
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'media.cover.aspect',
        level: 'error',
        text: '封面太宽（3:1），Instagram 要求宽高比在 4:5 到 1.91:1 之间',
      }),
    ]);
    // 1080×1350 (4:5) and 1080×566 (1.91:1) are fine
    expect(
      checkMedia(platformMeta('instagram')?.limits?.media, [
        { role: 'cover', width: 1080, height: 1350 },
        { role: 'image', width: 1080, height: 566, format: 'image/jpeg', bytes: 1000 },
      ])
    ).toEqual([]);
  });

  it('warns for what is fixed for the user, errors for what is refused; one item per role and problem', () => {
    const limits = {
      image: {
        maxBytes: 1000,
        formats: ['jpeg', 'png'],
        maxCount: 2,
        minWidth: 100,
        maxWidth: 2000,
      },
      video: { maxSeconds: 60, minSeconds: 3, maxBytes: 5000 },
      cover: { aspect: { min: 2, max: 2, soft: true } },
    };
    const items = checkMedia(
      limits,
      [
        { role: 'image', bytes: 2000, format: 'jpg', width: 300, height: 300 },
        { role: 'image', bytes: 3000, format: 'webp', width: 50, height: 50 },
        { role: 'image', width: 3000, height: 3000 },
        { role: 'video', seconds: 90, bytes: 9000 },
        { role: 'cover', width: 1000, height: 1000 },
      ],
      { platform: 'P' }
    );
    const by = Object.fromEntries(items.map((i) => [i.kind, i]));
    expect(by['media.image.count']).toMatchObject({ level: 'warn' });
    expect(by['media.image.too_large']).toMatchObject({ level: 'warn', count: 2 });
    expect(by['media.image.too_large']!.samples).toHaveLength(2);
    expect(by['media.image.format']).toMatchObject({
      level: 'error',
      samples: ['第 2 个图片：WEBP'],
    });
    // too small (error) wins over too large (warn) in the same item
    expect(by['media.image.size']).toMatchObject({ level: 'error', count: 2 });
    expect(by['media.video.duration']).toMatchObject({ level: 'error' });
    expect(by['media.video.too_large']).toMatchObject({ level: 'error' });
    expect(by['media.cover.aspect']).toMatchObject({ level: 'warn' });
    expect(by['media.cover.aspect']!.text).toContain('建议宽高比为 2:1');
  });

  it('hard ratios are exact; images Instagram scales up are not errors; covers use cover rules only', () => {
    const ig = platformMeta('instagram')?.limits?.media;
    expect(checkMedia(ig, [{ role: 'image', width: 1080, height: 1360 }])).toEqual([
      expect.objectContaining({ kind: 'media.image.aspect', level: 'error' }),
    ]);
    expect(checkMedia(ig, [{ role: 'image', width: 300, height: 300 }])).toEqual([]);
    expect(checkMedia(ig, [{ role: 'cover', format: 'image/webp' }])).toEqual([
      expect.objectContaining({ kind: 'media.cover.format', level: 'error' }),
    ]);
    // platforms that do not upload the cover: no image rules on it
    for (const p of ['facebook', 'threads', 'linkedin', 'slack'])
      expect(
        checkMedia(platformMeta(p)?.limits?.media, [
          { role: 'cover', format: 'webp', width: 10, height: 1 },
        ])
      ).toEqual([]);
  });

  it('skips what is not known, and platforms without limits', () => {
    expect(checkMedia(undefined, [{ role: 'image', bytes: 1e12 }])).toEqual([]);
    expect(checkMedia({ image: { maxBytes: 1 } }, [{ role: 'image' }])).toEqual([]);
    expect(
      mediaReport('github-pages', 'GitHub Pages', undefined, { coverMeta: { width: 1, height: 9 } })
    ).toEqual([]);
  });

  it('collects the media of a publish (cover metadata, image set, video)', () => {
    const items = mediaItemsOf(
      {
        kind: 'image-set',
        title: 't',
        caption: 'c',
        images: [{ url: 'https://a/1.PNG', width: 10, height: 20, bytes: 5 }],
      },
      { coverMeta: { width: 3, height: 1, mime: 'image/webp' } }
    );
    expect(items).toEqual([
      { role: 'cover', width: 3, height: 1, format: 'webp' },
      { role: 'image', width: 10, height: 20, bytes: 5, format: 'png' },
    ]);
    expect(
      mediaItemsOf({
        kind: 'video',
        title: 't',
        description: '',
        video: { url: 'v.mp4', durationSec: 12 },
      })
    ).toEqual([{ role: 'video', format: 'mp4', seconds: 12 }]);
    expect(mediaFormat('image/jpg')).toBe('jpeg');
    expect(mediaFormat('video/quicktime')).toBe('mov');
    expect(formatRatio(1.91)).toBe('1.91:1');
    expect(formatRatio(0.8)).toBe('4:5');
  });

  it('the registry carries the limits and the link placement', () => {
    expect(platformMeta('bluesky')?.limits?.media?.image).toMatchObject({
      maxBytes: 1_000_000,
      maxCount: 4,
    });
    expect(platformMeta('telegram')?.limits?.media?.image?.maxBytes).toBe(10 * 1024 * 1024);
    expect(platformMeta('xiaohongshu')?.limits?.media?.image?.maxCount).toBe(18);
    expect(platformMeta('linkedin')?.linkPlacement).toEqual({
      supported: true,
      default: 'first_comment',
    });
    expect(platformMeta('mastodon')?.linkPlacement).toEqual({ supported: true, default: 'body' });
    expect(platformMeta('x')?.linkPlacement).toBeUndefined();
  });
});

/* ---------------- §5.3 tracking links ---------------- */

describe('tracking links (SPEC-r12 §5.3)', () => {
  const S = 'https://s.starnote.app/s/AbCd1234';
  it('visibleLinkOf prefers the short link; canonicalUrl is untouched', () => {
    const a = withTrackingUrl(articleContent(doc, { canonicalUrl: 'https://c/1' }), S);
    expect(a).toMatchObject({ canonicalUrl: 'https://c/1', trackingUrl: S });
    expect(visibleLinkOf(a)).toBe(S);
    expect(visibleLinkOf(articleContent(doc, { canonicalUrl: 'https://c/1' }))).toBe('https://c/1');
    expect(
      visibleLinkOf(withTrackingUrl({ kind: 'short-text', text: 't', link: 'https://c/1' }, S))
    ).toBe(S);
    const set = withTrackingUrl(
      { kind: 'image-set', title: '', caption: '', images: [], from: articleContent(doc) },
      S
    );
    expect(visibleLinkOf(set)).toBe(S);
    expect(withTrackingUrl(a, undefined)).toBe(a);
  });

  it('the publisher hands it to the adapter (ctx and content) and to preview', async () => {
    const seen: Array<{ ctx?: string; content?: string }> = [];
    const adapter = defineAdapter({
      key: 'p',
      label: 'P',
      runtimes: [{ runtime: 'web', mode: 'api' }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      preview: (_d, _f, _c, content, opts) => {
        seen.push({ ctx: opts?.trackingUrl, content: visibleLinkOf(content) });
        return { format: 'text', title: '', body: '', report: [] };
      },
      publish: async ({ ctx, content }) => {
        seen.push({ ctx: ctx.trackingUrl, content: visibleLinkOf(content) });
        return { url: 'u', externalId: '1' };
      },
    });
    const publisher = createPublisher({ adapters: [adapter], runtime: 'web' });
    await publisher.publish(
      job({
        targets: [{ platform: 'p', trackingUrl: S }],
        content: articleContent(doc, { canonicalUrl: 'https://c/1' }),
      })
    );
    await publisher.preview('p', { doc, trackingUrl: S });
    expect(seen).toEqual([
      { ctx: S, content: S },
      { ctx: S, content: S },
    ]);
  });
});

/* ---------------- §2.2 follow-up ---------------- */

function commenter(opts: {
  out?: Partial<PublishOutput>;
  followUp?: (
    post: FollowUpParent,
    input: FollowUpInput,
    ctx: PublishContext
  ) => Promise<{ externalId: string; url?: string }>;
  threeStage?: boolean;
}) {
  const order: string[] = [];
  const adapter: Adapter = defineAdapter({
    key: 'c',
    label: 'C',
    runtimes: [{ runtime: 'web', mode: 'api' }],
    capabilities: { supportsUpdate: false },
    schema: z.object({}),
    pollIntervalSec: 1,
    publish: async () => {
      order.push('publish');
      const follow = {
        followUp: { kind: 'link_comment' as const, text: '原文：https://s/1', meta: { cid: 'x' } },
      };
      return opts.threeStage
        ? { url: '', state: 'processing', pending: { container_id: 'k' }, ...follow }
        : { url: 'https://c/p/1', externalId: 'p1', ...follow, ...opts.out };
    },
    ...(opts.threeStage
      ? {
          checkStatus: async (pending: unknown) => {
            order.push('check');
            return { status: 'ready' as const, pending };
          },
          finalize: async () => {
            order.push('finalize');
            return { status: 'completed' as const, url: 'https://c/p/2', externalId: 'p2' };
          },
        }
      : {}),
    ...(opts.followUp
      ? {
          followUp: async (post: FollowUpParent, input: FollowUpInput, ctx: PublishContext) => {
            order.push(`followUp:${post.externalId}`);
            return opts.followUp!(post, input, ctx);
          },
        }
      : {}),
  });
  return { adapter, order };
}

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};

describe('link comment follow-up (SPEC-r12 §2.2)', () => {
  it('posts once after the post, with the meta, and reports success', async () => {
    const fn = vi.fn(async () => ({ externalId: 'c9', url: '' }));
    const { adapter } = commenter({ followUp: fn });
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [adapter],
      runtime: 'web',
      onEvent: (_k, e) => events.push(e),
    });
    const { results } = await publisher.publish(job({ platforms: ['c'] }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]!.slice(0, 2)).toEqual([
      { externalId: 'p1', url: 'https://c/p/1', meta: { cid: 'x' } },
      { kind: 'link_comment', text: '原文：https://s/1' },
    ]);
    expect(results.c).toMatchObject({
      ok: true,
      followUp: {
        kind: 'link_comment',
        state: 'succeeded',
        externalId: 'c9',
        text: '原文：https://s/1',
      },
    });
    // an empty comment url is left out
    expect(results.c!.followUp).not.toHaveProperty('url');
    expect(results.c!.report?.map((i) => i.kind)).toContain('followup.posted');
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ followUp: { state: 'succeeded' } });
  });

  it('a failed comment keeps the post a success, with a warn and the error', async () => {
    const { adapter } = commenter({
      followUp: async () => {
        throw Object.assign(new Error('nope'), { code: 'forbidden', errorKind: 'disconnect' });
      },
    });
    const publisher = createPublisher({ adapters: [adapter], runtime: 'web' });
    const { results } = await publisher.publish(job({ platforms: ['c'] }));
    expect(results.c).toMatchObject({
      ok: true,
      externalId: 'p1',
      followUp: {
        state: 'failed',
        text: '原文：https://s/1',
        error: { kind: 'disconnect', code: 'forbidden', message: 'nope' },
      },
    });
    expect(results.c!.report).toContainEqual(
      expect.objectContaining({
        kind: 'followup.failed',
        level: 'warn',
        text: '链接评论没发出去，可以手动补发',
      })
    );
    // no kind given: unknown (a write that may have gone through)
    const { adapter: b } = commenter({
      followUp: async () => {
        throw new Error('boom');
      },
    });
    const r2 = await createPublisher({ adapters: [b], runtime: 'web' }).publish(
      job({ platforms: ['c'] })
    );
    expect(r2.results.c!.followUp?.error).toEqual({
      kind: 'unknown',
      code: 'failed',
      message: 'boom',
    });
  });

  it('three-stage platforms comment after finalize, on the published id', async () => {
    const { adapter, order } = commenter({
      threeStage: true,
      followUp: async () => ({ externalId: 'c1' }),
    });
    const publisher = createPublisher({ adapters: [adapter], runtime: 'web', clock: clock() });
    const { results } = await publisher.publish(job({ platforms: ['c'] }));
    expect(order).toEqual(['publish', 'check', 'finalize', 'followUp:p2']);
    expect(results.c).toMatchObject({
      ok: true,
      externalId: 'p2',
      followUp: { state: 'succeeded' },
    });
  });

  it('skips: not live yet, a pasted-back code id, no followUp on the adapter, a host-polled container', async () => {
    const fn = vi.fn(async () => ({ externalId: 'c' }));
    const run = async (
      a: Adapter,
      extra: Parameters<typeof createPublisher>[0] = { adapters: [a], runtime: 'web' }
    ) =>
      (await createPublisher({ ...extra, adapters: [a] }).publish(job({ platforms: ['c'] })))
        .results.c!;

    const draft = await run(commenter({ out: { state: 'draft' }, followUp: fn }).adapter);
    expect(draft.followUp?.state).toBe('skipped');
    const code = await run(commenter({ out: { externalId: 'code:AbC' }, followUp: fn }).adapter);
    expect(code.followUp?.state).toBe('skipped');
    expect(fn).not.toHaveBeenCalled();

    const none = await run(commenter({}).adapter);
    expect(none).toMatchObject({ ok: true, followUp: { state: 'skipped' } });
    expect(none.report?.map((i) => i.kind)).toContain('followup.failed');

    const { adapter } = commenter({ threeStage: true, followUp: fn });
    const handed = await run(adapter, {
      adapters: [adapter],
      runtime: 'web',
      pollProcessing: false,
    });
    expect(handed).toMatchObject({
      state: 'processing',
      followUp: { state: 'skipped', text: '原文：https://s/1' },
    });
  });

  it('a cancelled publish does not comment', async () => {
    const fn = vi.fn(async () => ({ externalId: 'c' }));
    const ac = new AbortController();
    const adapter = defineAdapter({
      key: 'c',
      label: 'C',
      runtimes: [{ runtime: 'web', mode: 'api' }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      publish: async () => {
        ac.abort();
        return {
          url: 'u',
          externalId: 'p1',
          followUp: { kind: 'link_comment' as const, text: 't' },
        };
      },
      followUp: fn,
    });
    const { results } = await createPublisher({ adapters: [adapter], runtime: 'web' }).publish(
      job({ platforms: ['c'] }),
      { signal: ac.signal }
    );
    expect(fn).not.toHaveBeenCalled();
    expect(results.c).toMatchObject({ ok: true, followUp: { state: 'skipped' } });
  });

  it('the comment key is one per post', () => {
    expect(followUpKeyOf('mastodon', '1131')).toBe('comment:mastodon:1131');
  });
});

/* ---------------- prepare ---------------- */

describe('publisher.prepare (SPEC-r12 §2.3, §5.3)', () => {
  it('puts follow_up next to the body and renders with the tracking link', () => {
    const seen: Array<string | undefined> = [];
    const adapter = defineAdapter({
      key: 'mastodon',
      label: 'Mastodon',
      runtimes: [{ runtime: 'server', mode: 'api', schedulable: true }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      publish: async () => ({ url: '' }),
      renderRequest: ({ content, trackingUrl }) => {
        seen.push(trackingUrl, visibleLinkOf(content));
        return {
          body: { status: 'hi' },
          follow_up: { kind: 'link_comment', text: `原文：${visibleLinkOf(content)}` },
        };
      },
    });
    const publisher = createPublisher({ adapters: [adapter], runtime: 'web' });
    const S = 'https://s/s/AbCd1234';
    const tasks = publisher.prepare({
      doc,
      targets: [{ platform: 'mastodon', accountId: 'a1', trackingUrl: S }],
      common: { title: 'T' },
      canonicalUrl: 'https://c/1',
      accounts: [{ platform: 'mastodon', accountId: 'a1', cloud: true, local: false }],
    });
    expect(seen).toEqual([S, S]);
    expect(tasks[0]!.request).toEqual({
      body: { status: 'hi' },
      follow_up: { kind: 'link_comment', text: `原文：${S}` },
    });
    expect(toScheduleTasks(tasks)[0]!.request?.follow_up).toEqual({
      kind: 'link_comment',
      text: `原文：${S}`,
    });
  });
});
