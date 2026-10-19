import { describe, expect, it } from 'vitest';

import {
  AI_DECLARATION_TEXT,
  aiDeclaration,
  appendAiDeclaration,
  checkCompliance,
  COMPLIANCE_LEXICON,
  PLATFORM_KEYS,
  PLATFORM_RULES,
  platformMeta,
  platformRules,
} from '../src';

import type { TiptapJSON } from '../src';

describe('platform rules', () => {
  it('every registry platform has rules with a source and checkedAt', () => {
    for (const key of PLATFORM_KEYS) {
      const r = platformRules(key);
      expect(r, key).toBeTruthy();
      expect(r!.source.length, key).toBeGreaterThan(2);
      expect(r!.checkedAt).toBe('2026-10');
      expect([true, false, '待核实']).toContain(r!.verified);
      expect(r!.aiLabel.note.length, key).toBeGreaterThan(4);
      if (r!.verified === '待核实' || r!.aiLabel.required === '待核实') {
        expect(`${r!.source}${r!.aiLabel.note}${r!.verified}`).toContain('待核实');
      }
      expect(platformMeta(key)!.rules).toBe(r);
    }
    expect(Object.keys(PLATFORM_RULES).sort()).toEqual([...PLATFORM_KEYS].sort());
    expect(platformRules('nope')).toBeUndefined();
  });

  it('CN platforms: 广告法 and the AI label law; 小红书 / 公众号 specifics', () => {
    for (const key of PLATFORM_KEYS) {
      const r = platformRules(key)!;
      if (platformMeta(key)!.region === 'cn') {
        expect(r.adLawWords, key).toBe(true);
        expect(r.aiLabel.required, key).toBe(true);
        expect(r.aiLabel.note, key).toContain('人工智能生成合成内容标识办法');
      } else expect(r.adLawWords, key).toBe(false);
    }
    const xhs = platformRules('xiaohongshu')!;
    expect(xhs.externalLinks).toBe('forbidden');
    expect(xhs.noContact && xhs.noQrcode).toBe(true);
    expect(xhs.images?.ratios).toContain('3:4');
    expect(xhs.aiLabel.method).toBe('platform-toggle');
    expect(platformRules('wechat')!.externalLinks).toBe('stripped');
    expect(platformRules('medium')!.aiLabel.placement).toBe('top');
  });
});

describe('checkCompliance', () => {
  it('unknown platform: no items', () => {
    expect(checkCompliance({ platform: 'nope', title: 'x'.repeat(999) })).toEqual({ items: [] });
  });

  it('lengths, tags and images with trim fixes', () => {
    const { items, rules } = checkCompliance({
      platform: 'xiaohongshu',
      title: '这是一个非常非常长的小红书标题已经超过二十个字了吧',
      tags: Array.from({ length: 12 }, (_, i) => `t${i}`),
      images: Array.from({ length: 20 }, (_, i) => `https://x.test/${i}.jpg`),
      imageSizes: [
        { width: 1080, height: 1440 },
        { width: 1920, height: 1080 },
      ],
    });
    expect(rules?.title?.max).toBe(20);
    const by = (rule: string) => items.filter((i) => i.rule === rule);
    expect(by('title-length')[0]).toMatchObject({
      field: 'title',
      level: 'warn',
      fix: { kind: 'trim', field: 'title', max: 20 },
    });
    expect(by('tag-count')[0]!.fix).toEqual({ kind: 'trim', field: 'tags', max: 10 });
    expect(by('image-count')[0]!.fix).toEqual({ kind: 'trim', field: 'images', max: 18 });
    // 3:4 is fine, 16:9 is not
    expect(by('image-ratio')).toHaveLength(1);
    expect(by('image-ratio')[0]!.message).toContain('第 2 张');
  });

  it('minimum lengths and tag counts', () => {
    const { items } = checkCompliance({ platform: 'toutiao', title: '短' });
    expect(items[0]).toMatchObject({ rule: 'title-length', needsAi: true });
    const juejin = checkCompliance({ platform: 'juejin', tags: [] });
    expect(juejin.items[0]).toMatchObject({ rule: 'tag-count', field: 'tags' });
  });

  it('external links: forbidden (小红书), stripped (公众号), allowed (知乎)', () => {
    const text = '详情见 https://example.com/a 和 https://mp.weixin.qq.com/s/abc';
    const xhs = checkCompliance({ platform: 'xiaohongshu', text }).items.filter(
      (i) => i.rule === 'external-link'
    );
    expect(xhs).toHaveLength(2);
    expect(xhs[0]).toMatchObject({
      level: 'warn',
      field: 'body',
      fix: { kind: 'replace', from: 'https://example.com/a', to: '' },
    });
    const wx = checkCompliance({ platform: 'wechat', text }).items.filter(
      (i) => i.rule === 'external-link'
    );
    expect(wx).toHaveLength(1);
    expect(wx[0]).toMatchObject({ level: 'info', excerpt: 'https://example.com/a' });
    expect(checkCompliance({ platform: 'zhihu', text, links: ['https://a.test'] }).items).toEqual(
      []
    );
  });

  it('contact details and QR codes (导流)', () => {
    const { items } = checkCompliance({
      platform: 'xiaohongshu',
      text: '想要资料加微信：abc_12345 或 VX abcdef1，电话 138 1234 5678，QQ: 12345678，邮箱 me@example.com，扫码进群',
      images: ['https://x.test/a.png', 'https://x.test/my-qrcode.png', 'https://x.test/c.png'],
      imageAlts: ['风景', '', '公众号二维码'],
    });
    const contacts = items.filter((i) => i.rule === 'contact');
    expect(contacts.map((c) => c.message)).toEqual([
      '含手机号，平台禁止站外导流',
      '含微信号，平台禁止站外导流',
      '含微信号，平台禁止站外导流',
      '含QQ 号，平台禁止站外导流',
      '含邮箱，平台禁止站外导流',
    ]);
    expect(contacts[0]!.fix).toEqual({ kind: 'replace', from: '138 1234 5678', to: '' });
    const qr = items.filter((i) => i.rule === 'qrcode');
    expect(qr.filter((i) => i.field === 'body')).toHaveLength(1);
    expect(qr.filter((i) => i.field === 'images').map((i) => i.excerpt)).toEqual([
      'my-qrcode.png',
      '公众号二维码',
    ]);
    // the same text on a platform without the rule
    expect(checkCompliance({ platform: 'medium', text: '微信：abc_12345 扫码' }).items).toEqual([]);
  });

  it('广告法极限词: phrase matches, suggestions, ordinals skipped, needsAi', () => {
    const { items } = checkCompliance({
      platform: 'zhihu',
      title: '全网最低价的最佳选择',
      text: '第一章 介绍。这是行业第一的产品，100% 好用，绝对划算。最近天气不错。',
    });
    const ad = items.filter((i) => i.rule === 'ad-law');
    expect(ad.map((i) => `${i.field}:${(i.fix as { from: string } | undefined)?.from}`)).toEqual([
      'title:全网最低',
      'title:最佳',
      'body:第一',
      'body:100%',
      'body:绝对',
    ]);
    expect(ad.every((i) => i.needsAi)).toBe(true);
    expect(ad[1]!.fix).toEqual({ kind: 'replace', from: '最佳', to: '优秀' });
    expect(ad[2]!.excerpt).toContain('行业第一的产品');
    // overseas: no 广告法 list
    expect(checkCompliance({ platform: 'devto', text: '最佳 第一' }).items).toEqual([]);
  });

  it('ids are stable across edits elsewhere and unique for repeats', () => {
    const a = checkCompliance({ platform: 'zhihu', text: '最佳方案。另一个最佳方案。' }).items;
    const b = checkCompliance({
      platform: 'zhihu',
      text: '开头加了很多字。最佳方案。中间也改了。另一个最佳方案。',
    }).items;
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(new Set(a.map((i) => i.id)).size).toBe(2);
  });

  it('AI label: footer platforms, platform toggles, switched off', () => {
    const footer = checkCompliance({ platform: 'chenji', text: '正文', aiAssisted: true }).items;
    expect(footer).toEqual([
      expect.objectContaining({ rule: 'ai-label', level: 'warn', fix: { kind: 'ai-label' } }),
    ]);
    const done = checkCompliance({
      platform: 'chenji',
      text: `正文\n${AI_DECLARATION_TEXT.zh}`,
      aiAssisted: true,
    }).items;
    expect(done).toEqual([]);
    const toggle = checkCompliance({
      platform: 'xiaohongshu',
      text: '正文',
      aiAssisted: true,
    }).items;
    expect(toggle).toEqual([
      expect.objectContaining({
        rule: 'ai-label',
        level: 'info',
        message: expect.stringContaining('勾选'),
      }),
    ]);
    const off = checkCompliance({
      platform: 'douyin',
      text: '正文',
      aiAssisted: true,
      aiLabel: false,
    }).items;
    expect(off[0]).toMatchObject({ rule: 'ai-label', level: 'warn' });
    expect(off[0]!.message).toContain('合规风险');
    expect(checkCompliance({ platform: 'chenji', text: '正文', aiAssisted: false }).items).toEqual(
      []
    );
    expect(
      checkCompliance({ platform: 'medium', text: 'Body', aiAssisted: true }).items[0]!.message
    ).toContain('开头');
  });
});

describe('AI declaration', () => {
  const doc: TiptapJSON = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }],
  };

  it('builds a paragraph in either language', () => {
    expect(aiDeclaration('zh')).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: '本文部分内容由 AI 辅助生成。', marks: [{ type: 'italic' }] },
      ],
    });
    expect(aiDeclaration('en').content![0]!.text).toBe(
      'Parts of this article were produced with AI assistance.'
    );
  });

  it('appends once, never mutates, can go first', () => {
    const once = appendAiDeclaration(doc, 'zh');
    expect(once.content).toHaveLength(2);
    expect(doc.content).toHaveLength(1);
    expect(appendAiDeclaration(once, 'zh')).toBe(once);
    expect(appendAiDeclaration(once, 'en')).toBe(once);
    const top = appendAiDeclaration(doc, 'en', { placement: 'top' });
    expect(top.content![0]!.content![0]!.text).toBe(AI_DECLARATION_TEXT.en);
  });
});

describe('golden cases shared with the backend (SPEC-r8 §12.9)', () => {
  it('every case yields exactly the expected rule:field items', async () => {
    const { readFileSync } = await import('node:fs');
    const golden = JSON.parse(readFileSync(new URL('./fixtures/compliance-golden.json', import.meta.url), 'utf8')) as {
      cases: { name: string; input: Parameters<typeof checkCompliance>[0]; expect: string[] }[];
    };
    expect(golden.cases.length).toBeGreaterThan(5);
    for (const c of golden.cases) {
      const got = checkCompliance(c.input as never)
        .items.map((it) => `${it.rule}:${it.field}`)
        .sort();
      expect(got, c.name).toEqual([...c.expect].sort());
    }
  });
});

describe('learned rules (SPEC-r9-compliance-learning)', () => {
  it('checkCompliance(platform, doc, extraRules) merges learned items with the built-in rules', () => {
    const rules = [
      { id: 'L1', platform: 'zhihu', category: 'contact', pattern: { type: 'keyword' as const, value: '私信我' }, suggestion: '去掉引导私信', confidence: 0.9, source: 'user' as const },
    ];
    const res = checkCompliance('zhihu', { title: '全网第一', text: '有问题私信我。' }, rules);
    const learned = res.items.filter((it) => it.rule === 'learned');
    expect(res.items.some((it) => it.rule === 'ad-law')).toBe(true);
    expect(learned).toHaveLength(1);
    expect(learned[0]!.learned).toEqual({ id: 'L1', source: 'user' });
    expect(learned[0]!.message).toContain('根据你近期的发布反馈');
    expect(learned[0]!.fix).toEqual({ kind: 'replace', from: '私信我', to: '' });
    expect(learned[0]!.needsAi).toBe(true);
    // same text → same ids (「忽略」 survives re-runs)
    expect(checkCompliance('zhihu', { title: '全网第一', text: '有问题私信我。' }, rules).items.map((i) => i.id)).toEqual(res.items.map((i) => i.id));
  });

  it('a bad regex is skipped, an unknown platform still gets its learned items', () => {
    const res = checkCompliance('nowhere', { text: 'abc' }, [
      { id: 'bad', platform: 'nowhere', category: 'x', pattern: { type: 'regex', value: '(' }, suggestion: '', confidence: 1 },
      { id: 'ok', platform: 'nowhere', category: 'x', pattern: { type: 'keyword', value: 'ABC' }, suggestion: '', confidence: 0.5 },
    ]);
    expect(res.rules).toBeUndefined();
    expect(res.items.map((i) => i.learned?.id)).toEqual(['ok']);
    expect(res.items[0]!.level).toBe('info');
  });

  it('the lexicon exposes the word lists and regex sources for the Python port', () => {
    expect(COMPLIANCE_LEXICON.adLawWords.length).toBeGreaterThan(20);
    expect(COMPLIANCE_LEXICON.contactPatterns.map((c) => c.what)).toEqual(['手机号', '微信号', 'QQ 号', '邮箱']);
    expect(new RegExp(COMPLIANCE_LEXICON.qrText.source, COMPLIANCE_LEXICON.qrText.flags).test('扫码进群')).toBe(true);
  });
});
