import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  parsePostUrl,
  PLATFORM_LANGS,
  PLATFORMS,
  platformMeta,
  platformRules,
  verifySiteScript,
} from '../src';

const OVERSEAS_DESK = [
  'note',
  'kakuyomu',
  'naver-blog',
  'tistory',
  'brunch',
  'postype',
  'vocus',
  'webnovel',
  'wattpad',
  'steady',
  'kofi',
];

describe('SPEC-r14 A2: overseas platforms on the 发布台 (通用模式)', () => {
  it('registers the eleven as global desktop platforms with readers’ languages', () => {
    for (const key of OVERSEAS_DESK) {
      const p = platformMeta(key);
      expect(p, key).toBeDefined();
      expect(p!.region, key).toBe('global');
      expect(
        p!.runtimes.map((r) => r.runtime),
        key
      ).toEqual(['electron']);
      expect(p!.langs?.length, key).toBeGreaterThan(0);
    }
    expect(platformMeta('note')!.langs).toEqual(['ja']);
    expect(platformMeta('naver-blog')!.langs).toEqual(['ko']);
    expect(platformMeta('vocus')!.langs).toEqual(['zh-TW']);
    expect(platformMeta('wattpad')!.langs).toEqual(['*']);
  });

  it('only the platforms with a known language carry `langs`', () => {
    for (const p of PLATFORMS) expect(Boolean(p.langs), p.key).toBe(p.key in PLATFORM_LANGS);
  });

  it('says whether a mainland author can be paid', () => {
    expect(platformRules('vocus')!.payout?.mainland).toBe('yes');
    expect(platformRules('note')!.payout?.mainland).toBe('no');
    expect(platformRules('webnovel')).toMatchObject({
      exclusive: true,
      payout: { mainland: 'yes' },
    });
    for (const key of OVERSEAS_DESK) expect(platformRules(key)!.payout?.note, key).toBeTruthy();
  });

  it('ships a signed 通用模式 site script for each, verified with the bundled key', async () => {
    const dir = fileURLToPath(new URL('../../adapters/desk-generic/src/sites/', import.meta.url));
    for (const key of OVERSEAS_DESK) {
      const signed = JSON.parse(readFileSync(`${dir}${key}.signed.json`, 'utf8'));
      const script = await verifySiteScript(signed, { platform: key });
      expect(script.flags?.generic, key).toBe(true);
      expect(script.session!.success, key).toEqual({ manual: true });
    }
  });
});

const SERVER_A1 = ['convertkit', 'beehiiv', 'buttondown', 'hatena', 'qiita', 'zenn', 'telegraph'];

describe('SPEC-r14 A1: overseas platforms published by the server through their official APIs', () => {
  it('registers the seven as token platforms the server sends (web / desktop render, schedulable)', () => {
    for (const key of SERVER_A1) {
      const p = platformMeta(key)!;
      expect(p, key).toBeDefined();
      expect(p.region, key).toBe('global');
      expect(p.stage, key).toBe('implemented');
      expect(p.binding).toMatchObject({ kind: 'token', store: 'server' });
      expect(p.binding.fields?.length, key).toBeGreaterThan(0);
      expect(
        p.runtimes.map((r) => `${r.runtime}:${r.mode}`),
        key
      ).toEqual(['web:api', 'electron:api', 'server:api']);
      expect(p.runtimes.find((r) => r.runtime === 'server')?.schedulable, key).toBe(true);
      expect(p.langs?.length, key).toBeGreaterThan(0);
      expect(p.domains, key).toBeDefined();
      expect(platformRules(key), key).toBeDefined();
    }
    expect(platformMeta('convertkit')!.label).toBe('Kit');
    expect(platformMeta('hatena')!.langs).toEqual(['ja']);
    expect(platformMeta('telegraph')!.langs).toEqual(['*']);
    expect(platformMeta('beehiiv')!.binding.fields).toEqual(['api_key', 'publication_id']);
    expect(platformMeta('zenn')!.binding).toMatchObject({
      provider: 'github',
      fields: ['zenn_username', 'repo', 'token'],
    });
  });

  it('payout: Stripe newsletters are not payable to mainland authors; no-income platforms carry none', () => {
    for (const key of ['convertkit', 'beehiiv', 'buttondown'])
      expect(platformRules(key)!.payout?.mainland, key).toBe('no');
    expect(platformRules('hatena')!.payout?.mainland).toBe('unknown');
    expect(platformRules('zenn')!.payout?.mainland).toBe('unknown');
    expect(platformRules('qiita')!.payout).toBeUndefined();
    expect(platformMeta('qiita')!.monetization).toEqual([]);
    expect(platformRules('qiita')!.tags).toMatchObject({ max: 5, min: 1 });
    expect(platformRules('zenn')!.title?.max).toBe(70);
  });
});

describe('SPEC-r14 A1: pasted post links', () => {
  it.each([
    [
      'qiita',
      'https://qiita.com/me/items/c686397e4a0f4f11683d?utm_source=x',
      'c686397e4a0f4f11683d',
    ],
    ['qiita', 'https://qiita.com/me', null],
    ['zenn', 'https://zenn.dev/me/articles/starnote-8_kq2x_a7b/', 'starnote-8_kq2x_a7b'],
    ['zenn', 'https://zenn.dev/me/articles/short', null],
    ['telegraph', 'https://telegra.ph/Hello-10-28', 'Hello-10-28'],
    ['telegraph', 'https://example.com/Hello-10-28', null],
    [
      'hatena',
      'https://me.hatenablog.com/entry/2026/10/28/x',
      'https://me.hatenablog.com/entry/2026/10/28/x',
    ],
    ['hatena', 'https://me.hatenablog.com/about', null],
  ])('%s %s', (platform, url, id) => {
    expect(parsePostUrl(platform, url)?.externalId ?? null).toBe(id);
  });
});
