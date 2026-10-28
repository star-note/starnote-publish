import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PLATFORM_LANGS, PLATFORMS, platformMeta, platformRules, verifySiteScript } from '../src';

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
