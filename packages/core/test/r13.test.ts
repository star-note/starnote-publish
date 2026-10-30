import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkCompliance,
  COMPLIANCE_LEXICON,
  DOMAIN_SLUGS,
  domainProblems,
  PLATFORMS,
  platformMeta,
  verifySiteScript,
} from '../src';

const VERTICAL = [
  'xueqiu',
  'eastmoney',
  'huxiu',
  'woshipm',
  'sspai',
  'zsxq',
  'dongchedi',
  'hupu',
  'douban',
  'douban-read',
  'mafengwo',
];

describe('SPEC-r13 §1: domains', () => {
  it('every platform is general, focused on known domains, or a support link only', () => {
    expect(DOMAIN_SLUGS).toHaveLength(25);
    for (const p of PLATFORMS) expect(domainProblems(p.key, p.domains), p.key).toEqual([]);
  });

  it('labels the obvious ones', () => {
    expect(platformMeta('juejin')!.domains).toEqual({ general: false, focus: ['tech'] });
    expect(platformMeta('wechat')!.domains.general).toBe(true);
    expect(platformMeta('dongchedi')!.domains.focus).toEqual(['auto']);
    expect(platformMeta('patreon')!.domains.supportOnly).toBe(true);
  });
});

describe('SPEC-r13 §6: domestic vertical platforms', () => {
  it('are domestic desktop platforms bound with the login session, not built yet', () => {
    for (const key of VERTICAL) {
      const p = platformMeta(key)!;
      expect(p, key).toBeDefined();
      expect(p.region).toBe('cn');
      expect(p.runtimes.map((r) => `${r.runtime}/${r.mode}`)).toEqual(['electron/automation']);
      expect({ kind: p.binding.kind, store: p.binding.store }).toEqual({
        kind: 'cookie',
        store: 'desktop',
      });
      expect(p.stage, key).toBeUndefined();
      expect(p.rules?.aiLabel.required, key).toBe(true);
      expect(p.homepage).toMatch(/^https:\/\//);
    }
  });

  it('declares the official server channels found for 知识星球 / 少数派, not implemented yet (服务端优先)', () => {
    for (const key of ['zsxq', 'sspai']) {
      const alt = platformMeta(key)!.binding.alternatives;
      expect(alt, key).toEqual([
        expect.objectContaining({ kind: 'token', store: 'server', implemented: false }),
      ]);
    }
    expect(platformMeta('xueqiu')!.binding.alternatives).toBeUndefined();
  });

  it('marks the finance platforms and the first-publication one', () => {
    expect(platformMeta('xueqiu')!.rules!.finance).toBe(true);
    expect(platformMeta('eastmoney')!.rules!.finance).toBe(true);
    expect(platformMeta('woshipm')!.rules!.firstPublish).toBe(true);
    expect(platformMeta('zhihu')!.rules!.finance).toBeUndefined();
  });
});

describe('SPEC-r13 §6.6: finance compliance', () => {
  const text = '这只票稳赚不赔，600519 下周必涨，进群领内参。';

  it('flags stock tips and promised returns on finance platforms only', () => {
    const items = checkCompliance({ platform: 'xueqiu', text }).items.filter(
      (i) => i.rule === 'finance'
    );
    expect(items.filter((i) => i.level === 'warn').map((i) => i.excerpt)).toHaveLength(3);
    expect(items.some((i) => i.level === 'warn' && i.message.includes('稳赚不赔'))).toBe(true);
    expect(
      checkCompliance({ platform: 'zhihu', text }).items.some((i) => i.rule === 'finance')
    ).toBe(false);
  });

  it('reminds to disclose holdings when the body names a security', () => {
    const info = (t: string) =>
      checkCompliance({ platform: 'eastmoney', text: t }).items.filter(
        (i) => i.rule === 'finance' && i.level === 'info'
      );
    expect(info('我们来看看 SH600519 的年报')).toHaveLength(1);
    expect(info('聊聊 $AAPL 的估值')).toHaveLength(1);
    expect(info('第 3 章，2026 年的宏观环境')).toHaveLength(0);
  });

  it('ships the word list in the lexicon (the API port reads it)', () => {
    expect(COMPLIANCE_LEXICON.financeWords).toContain('荐股');
    expect(new RegExp(COMPLIANCE_LEXICON.security.source).test('000001')).toBe(true);
  });
});

describe('SPEC-r13 §4b: 通用模式 site scripts', () => {
  const dir = fileURLToPath(new URL('../../adapters/desk-generic/src/sites/', import.meta.url));
  const host = (url: string) => new URL(url).hostname;
  const allowed = (url: string, hosts: string[]) =>
    url.startsWith('https://') && hosts.some((h) => host(url) === h || host(url).endsWith(`.${h}`));

  it('one signed script per vertical platform, verified with the bundled key', async () => {
    for (const key of VERTICAL) {
      const signed = JSON.parse(readFileSync(`${dir}${key}.signed.json`, 'utf8'));
      const script = await verifySiteScript(signed, { platform: key });
      expect(script.platform).toBe(key);
      expect(platformMeta(key), key).toBeDefined();
      // 核对过写作页的（雪球、懂车帝，2026-10-30）自动填，其余走通用模式
      if (script.selectors.editor) expect(script.selectors.title).toBeTruthy();
      else expect(script.flags?.generic).toBe(true);
      const s = script.session!;
      expect(s.success).toEqual({ manual: true });
      expect(s.check).toBeUndefined();
      for (const url of [s.loginUrl, s.fetchPage, script.urls.write!])
        expect(allowed(url, s.allowedHosts), url).toBe(true);
      expect(script.unverified?.length).toBeGreaterThan(0);
    }
  });
});
