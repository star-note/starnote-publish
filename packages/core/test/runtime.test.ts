import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { needsBinding } from '../src/binding';
import { defineAdapter } from '../src/define';
import { PLATFORM_KEYS, PLATFORMS, listPlatforms, platformMeta } from '../src/platforms';
import { mergeReports } from '../src/report';
import { planPlatforms, planRuntime, resolveRuntimes, runtimeList } from '../src/runtime';

import type { PlanTarget } from '../src/runtime';

const kinds = (t: PlanTarget, env: Parameters<typeof planRuntime>[1], opts = {}) =>
  planRuntime(t, env, opts).guides.map((g) =>
    g.kind === 'desktop' ? `desktop:${g.online}` : g.kind
  );

const zhihu = platformMeta('zhihu')!;
const wechat = platformMeta('wechat')!;
const github = platformMeta('github-pages')!;
const chenji = platformMeta('chenji')!;

describe('planRuntime', () => {
  it('runs here when the current runtime is supported', () => {
    const plan = planRuntime(chenji, { runtime: 'web' });
    expect(plan.canPublish).toBe(true);
    expect(plan.primary).toMatchObject({ kind: 'run-here', mode: 'api', label: '本机直接发' });
    expect(plan.guides.at(-1)?.kind).toBe('copy');
  });

  it('desktop-only platform in a browser: download the desktop app, or queue for it', () => {
    expect(kinds(zhihu, { runtime: 'web' })).toEqual(['download-desktop', 'desktop:false', 'copy']);
    expect(kinds(zhihu, { runtime: 'web', desktopOnline: true })).toEqual(['desktop:true', 'copy']);
    // no download link on a phone
    expect(kinds(zhihu, { runtime: 'web', mobile: true })).toEqual(['desktop:false', 'copy']);
    expect(kinds(zhihu, { runtime: 'electron' })).toEqual(['run-here', 'copy']);
    const dl = planRuntime(zhihu, {
      runtime: 'web',
      links: { downloadDesktop: 'https://x/dl' },
    }).primary;
    expect(dl).toMatchObject({
      kind: 'download-desktop',
      label: '下载桌面端',
      href: 'https://x/dl',
    });
  });

  it('server relay comes first for API platforms the browser cannot call', () => {
    expect(kinds(wechat, { runtime: 'web', serverRelay: true })).toEqual([
      'server',
      'download-desktop',
      'desktop:false',
      'copy',
    ]);
    expect(planRuntime(wechat, { runtime: 'web', serverRelay: true }).primary).toMatchObject({
      label: '由服务器代发（支持定时）',
      schedulable: true,
    });
  });

  it('a scheduled post is not run in the browser even when it could be', () => {
    // Mastodon: page-memory token in the browser, 「云端代发」 on the server
    const mastodon = platformMeta('mastodon')!;
    const opts = { scheduleAt: '2026-11-01T00:00:00Z', contentKind: 'short-text' as const };
    expect(
      planRuntime(mastodon, { runtime: 'web', serverRelay: true }, { contentKind: 'short-text' })
        .canPublish
    ).toBe(true);
    const plan = planRuntime(mastodon, { runtime: 'web', serverRelay: true }, opts);
    expect(plan.canPublish).toBe(false);
    expect(plan.primary.kind).toBe('server');
    expect(planRuntime(mastodon, { runtime: 'node' }, opts).canPublish).toBe(true);
    // Bluesky's DPoP tokens never reach the server: no server relay to offer
    const bluesky = platformMeta('bluesky')!;
    expect(
      planRuntime(bluesky, { runtime: 'web', serverRelay: true }, opts).guides.map((g) => g.kind)
    ).not.toContain('server');
  });

  it('asks to bind first when accounts are known and none is bound', () => {
    const plan = planRuntime(github, { runtime: 'node', accounts: {} });
    expect(plan.primary).toMatchObject({
      kind: 'bind-first',
      href: '/settings?tab=platforms&bind=github-pages',
    });
    expect(plan.guides[1]?.kind).toBe('run-here');
    expect(
      planRuntime(github, { runtime: 'node', accounts: { 'github-pages': [{}] } }).canPublish
    ).toBe(true);
    // 辰记 needs no binding
    expect(planRuntime(chenji, { runtime: 'web', accounts: {} }).canPublish).toBe(true);
  });

  it('hands off and copies', () => {
    const x = platformMeta('x')!;
    const plan = planRuntime(x, { runtime: 'web' }, { contentKind: 'short-text' });
    expect(plan.primary).toMatchObject({
      kind: 'handoff',
      via: 'share-intent',
      href: 'https://x.com/intent/tweet',
    });
    expect(kinds(platformMeta('quora')!, { runtime: 'web' })).toEqual(['copy']);
    const medium = planRuntime(platformMeta('medium')!, { runtime: 'web' });
    expect(medium.guides.find((g) => g.kind === 'handoff')).toMatchObject({ via: 'import-url' });
    // an app deeplink is only offered on a phone
    const douyin = platformMeta('douyin')!;
    expect(kinds(douyin, { runtime: 'web' }, { contentKind: 'image-set' })).toEqual(['copy']);
    expect(kinds(douyin, { runtime: 'web', mobile: true }, { contentKind: 'image-set' })[0]).toBe(
      'handoff'
    );
  });

  it('refuses unsupported content kinds and remotely disabled platforms', () => {
    expect(
      planRuntime(platformMeta('xiaohongshu')!, { runtime: 'electron' }).primary
    ).toMatchObject({
      kind: 'unavailable',
      code: 'kind-unsupported',
    });
    expect(kinds(zhihu, { runtime: 'electron', disabled: ['zhihu'] })).toEqual([
      'unavailable',
      'copy',
    ]);
  });

  it('honours per-runtime content kinds (微博: short text on the server, articles on the desktop)', () => {
    const weibo = platformMeta('weibo')!;
    expect(
      kinds(weibo, { runtime: 'web', serverRelay: true }, { contentKind: 'short-text' })[0]
    ).toBe('server');
    expect(kinds(weibo, { runtime: 'web', serverRelay: true }, { contentKind: 'article' })[0]).toBe(
      'download-desktop'
    );
  });

  it('plans many platforms at once', () => {
    const plans = planPlatforms([chenji, zhihu], { runtime: 'web' });
    expect(Object.keys(plans)).toEqual(['chenji', 'zhihu']);
    expect(plans.chenji?.canPublish).toBe(true);
    expect(plans.zhihu?.canPublish).toBe(false);
  });
});

describe('runtimes alias', () => {
  it('reads the legacy runtime list as API support', () => {
    expect(resolveRuntimes({ runtime: ['web', 'node'] })).toEqual([
      { runtime: 'web', mode: 'api' },
      { runtime: 'server', mode: 'api', schedulable: true },
    ]);
    expect(
      runtimeList({ runtimes: [{ runtime: 'electron', mode: 'automation' }], runtime: ['web'] })
    ).toEqual(['electron']);
  });

  it('defineAdapter derives `runtime` from `runtimes`', () => {
    const a = defineAdapter({
      key: 'k',
      label: 'K',
      runtimes: [
        { runtime: 'electron', mode: 'automation' },
        { runtime: 'node', mode: 'api' },
      ],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      publish: async () => ({ url: 'u' }),
    });
    expect(a.runtime).toEqual(['electron', 'server']); // deprecated 'node' → 'server'
    expect(defineAdapter({ ...a, runtimes: undefined, runtime: ['web'] }).runtime).toEqual(['web']);
  });
});

describe('platform registry', () => {
  it('has unique keys and the platforms both front and back end know', () => {
    expect(new Set(PLATFORM_KEYS).size).toBe(PLATFORMS.length);
    for (const key of [
      'chenji',
      'wechat',
      'zhihu',
      'juejin',
      'xiaohongshu',
      'yuque',
      'medium',
      'github-pages',
      'csdn',
      'weibo',
    ]) {
      expect(platformMeta(key), key).toBeDefined();
    }
    expect(platformMeta('github')).toBeUndefined();
  });

  it('declares content kinds, runtimes, binding and colours for every platform', () => {
    for (const p of PLATFORMS) {
      expect(p.contentTypes.length, p.key).toBeGreaterThan(0);
      expect(p.runtimes.length, p.key).toBeGreaterThan(0);
      expect(p.color, p.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['cn', 'global']).toContain(p.region);
      if (needsBinding(p.binding)) expect(p.binding.store, p.key).not.toBe('none');
    }
  });

  it('binds GitHub Pages with a pasted fine-grained token and publishes from the server', () => {
    expect(github.binding).toEqual({
      kind: 'token',
      provider: 'github',
      store: 'server',
      fields: ['token'],
      createUrl: 'https://github.com/settings/personal-access-tokens/new',
    });
    expect(github.region).toBe('global');
    expect(github.runtimes.map((r) => r.runtime)).toEqual(['server']);
    expect(planRuntime(github, { runtime: 'web', serverRelay: true }).primary.kind).toBe('server');
  });

  it('filters by region and content kind', () => {
    expect(listPlatforms({ region: 'cn' }).every((p) => p.region === 'cn')).toBe(true);
    expect(listPlatforms({ contentType: 'video' }).map((p) => p.key)).toContain('youtube');
  });
});

describe('mergeReports', () => {
  it('keeps the first position of a kind and the last value', () => {
    expect(
      mergeReports(
        [
          { kind: 'image.rehosted', text: '1 张', count: 1 },
          { kind: 'translated', text: 'en' },
        ],
        [{ kind: 'image.rehosted', text: '3 张', count: 3 }],
        undefined
      )
    ).toEqual([
      { kind: 'image.rehosted', text: '3 张', count: 3 },
      { kind: 'translated', text: 'en' },
    ]);
  });
});
