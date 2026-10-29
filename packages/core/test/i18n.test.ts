/**
 * SPEC-r14 B5: the SDK in 简体中文 / 繁體中文 / English — dictionaries complete in every language (core, kit and
 * every adapter), no simplified characters in zh-TW, reports / compliance messages / guides in en and zh-TW, platform
 * names per language and what `platforms.json` carries for the API.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  adapterSchema,
  bindingInstructions,
  checkCompliance,
  checkMedia,
  COMPLIANCE_MESSAGES,
  coreMessages,
  createPublisher,
  defineAdapter,
  convert,
  normalizeLang,
  PLATFORM_LABELS,
  platformLabel,
  platformRules,
  PLATFORMS,
  planRuntime,
  prepareTasks,
  SDK_LANGS,
  themeText,
  untranslatedRuleNotes,
  untranslatedRuntimeNotes,
  zodToAntdRules,
} from '../src';
import * as i18nEntry from '../src/i18n/index';

import type { LangTable, SdkLang } from '../src';

const ADAPTERS = fileURLToPath(new URL('../../adapters', import.meta.url));
const CJK = /[一-鿿]/;

/**
 * Simplified-only characters (each differs from its Traditional form). Characters that are also correct in Traditional
 * text (制、几、余、范、周、台、于、后…) are left out on purpose.
 */
const SIMPLIFIED = new Set(
  '万与专业东两个丰为么义乐习书买乱争亏亚产亲仅从仓们价众优会伞传伤伦体侧俭债倾储儿兑兰关兴养兽内册写冲决况冻净准凤凭击刘则刚创删刹剑剧劝办务动劳势勋区华协单卖卢卫却厂厅历压厌县叁参双发变叙叠叶号叹吗听启吴呐员呜响哑喷团园围国图圆圣场坏块坚坛坝坠垄垒垦墙壮声处备复够头夹夺奋奖妆妇妈娱孙学宁宝实宠审宪宫宽宾对寻导寿将尔尘尝尧层属岁岂岗岛岭岳峡币师帐帘带帧帮广库应庙庞废开异弃张弥弯弹强归当录彻径忆忧怀态怜总恋恳恶悬惊惧惨惯愤愿戏战户扑执扩扫扬扰抚抛抢护报担拟拥拦拧拨择挂挡挤挥损换捣据掳携摄摆摇撑攒敌敛数斋斗断无旧时旷昼显晋晒晓晕暂术机杀杂权条来杨极构枣枪柜标栈栋栏树样档桥梦检棂椭楼概榄横欢欧歼殴毁毕毙气汇汉汤沟没沪泪泼泽洁洒浅浆测济浏浓涂涛润涨渊渐渔温湾湿溃滚滞满滤滥滨灭灯灵灾灿炉点炼烂烛烟热焕爱牍牵状犹狈独狭猎献玛环现玺电画畅疗疮疯痒痫瘾癣皱盐监盖盗盘眯着睁矫码砖础硕确碍礼祷祸离秃种积称稳穷窃窍竖竞笔笼筑筛签简箩类粮紧纠红纤约级纪纬纯纱纲纳纵纷纸纹纺线练组细织终绍经绑结绘给络绝统绢继续绳维绵综绿缀缓编缘缚缠缩网罗罚罢羡翘耸聋职聪肃肠肤肾肿胀胁胜胶脉脑脚脱脸腊腾舆舰舱艰艺节芜苍苏苹茎荐荡荣药莱获莹营萧萨蓝虑虚虫虽虾蚀蚁蚂蜡衅补衬袄袜装裤见观规视览觉触誉计订认讨让训议讯记讲讳许论设访证评识诈诉诊词译试诗诚话诞询该详语误诱说请诸诺读课谁调谅谈谊谋谓谜谢谣谨谱贝贞负贡财责贤败账货质贩贪贫购贯贴贵贷贸费贺贼资赋赌赏赐赔赖赚赛赞赠赶趋跃践踪躯车轨轩转轮软轰轴轻载较辅辆辈辉辑输辖辞辩边辽达迁过迈运还这进远违连迟适选逊递逻遗邓邮邻郑酱酿释针钉钓钟钢钥钩钱钻铁铃铅铜铭铺链销锁锅锋错锡锦键锻镇镜长门闪闭问闯闲间闷闹闻阀阁阅队阳阴阵阶际陆陈陕险随隐难雾静韦韧韩页顶项顺须顽顾顿预领颇频颗题颜额风飘飞饥饭饮饰饱饼馆馈马驱驳驶驻驾骂验骗骤鱼鲁鲜鸟鸡鸣鸭鹰麦齐齿龄龙龟'
);

type Getter = ((lang?: string | null) => unknown) & { table?: LangTable<unknown> };

/** Every dictionary of the SDK: core, kit and each adapter package's `src/i18n.ts` (`msg`). */
async function dictionaries(): Promise<Array<[string, Getter]>> {
  const out: Array<[string, Getter]> = [['core', coreMessages as Getter]];
  const kit = await import('../../adapters/kit/src/i18n');
  out.push(['kit', kit.kitMessages as Getter]);
  for (const dir of readdirSync(ADAPTERS).sort()) {
    if (dir === 'kit') continue;
    for (const file of [
      `${ADAPTERS}/${dir}/src/i18n.ts`,
      `${ADAPTERS}/${dir}/src/shared/i18n.ts`,
    ]) {
      if (!existsSync(file)) continue;
      const mod = (await import(file)) as { msg?: Getter };
      if (mod.msg) out.push([dir, mod.msg]);
    }
  }
  return out;
}

/** The shape of a dictionary: keys, arrays (with length) and function arities; strings as `string`. */
function shape(v: unknown): unknown {
  if (typeof v === 'string') return v.trim() ? 'string' : 'EMPTY';
  if (typeof v === 'function') return `fn/${v.length}`;
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, shape((v as Record<string, unknown>)[k])])
    );
  return typeof v;
}

/** All texts of a dictionary; functions are called with sample arguments. */
function texts(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') {
    for (const sample of [1, 'X', true, false]) {
      try {
        texts((v as (...a: unknown[]) => unknown)(...Array(6).fill(sample)), out);
      } catch {
        /* a sample of the wrong type */
      }
    }
  } else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => texts(x, out));
  return out;
}

function simplifiedIn(text: string): string[] {
  return [...text].filter((c) => SIMPLIFIED.has(c));
}

describe('dictionaries', () => {
  it('cover every package that has user-visible text', async () => {
    const names = (await dictionaries()).map(([n]) => n);
    expect(names.length).toBeGreaterThanOrEqual(35);
    for (const dir of readdirSync(ADAPTERS)) expect(names, dir).toContain(dir);
  });

  it('have every key in all three languages (same shape, nothing empty)', async () => {
    for (const [name, msg] of await dictionaries()) {
      const zhCN = shape(msg('zh-CN'));
      expect(JSON.stringify(zhCN), name).not.toContain('EMPTY');
      for (const lang of ['zh-TW', 'en'] as const) {
        expect(msg(lang), `${name} ${lang}`).not.toBe(msg('zh-CN'));
        expect(shape(msg(lang)), `${name} ${lang}`).toEqual(zhCN);
      }
    }
  });

  it('zh-TW has no simplified characters', async () => {
    expect(simplifiedIn('发布設定')).toEqual(['发']);
    const bad: string[] = [];
    const check = (where: string, text: string) => {
      const hits = simplifiedIn(text);
      if (hits.length) bad.push(`${where}: ${hits.join('')} ← ${text}`);
    };
    for (const [name, msg] of await dictionaries())
      for (const t of texts(msg('zh-TW'))) check(name, t);
    for (const [key, labels] of Object.entries(PLATFORM_LABELS))
      if (labels['zh-TW']) check(`label ${key}`, labels['zh-TW']);
    for (const p of PLATFORMS) {
      for (const r of p.runtimes) if (r.notes?.['zh-TW']) check(`note ${p.key}`, r.notes['zh-TW']);
      if (p.rules?.payout?.notes?.['zh-TW'])
        check(`payout ${p.key}`, p.rules.payout.notes['zh-TW']);
    }
    // the AI-label notes of the CN platforms: the 簡體 part is the law's name, translated too
    for (const p of PLATFORMS)
      if (p.rules?.aiLabel.notes?.['zh-TW']) check(`ai ${p.key}`, p.rules.aiLabel.notes['zh-TW']);
    for (const t of texts(COMPLIANCE_MESSAGES['zh-TW'])) check('compliance', t);
    expect(bad).toEqual([]);
  });

  it('core and kit English has no Chinese', async () => {
    const kit = await import('../../adapters/kit/src/i18n');
    for (const t of [...texts(coreMessages('en')), ...texts(kit.kitMessages('en'))])
      expect(CJK.test(t), t).toBe(false);
  });

  it('registry notes are translated', () => {
    expect(untranslatedRuntimeNotes()).toEqual([]);
    expect(untranslatedRuleNotes()).toEqual([]);
  });
});

describe('languages', () => {
  it('normalizes language tags (SPEC-r14 B1)', () => {
    expect(SDK_LANGS).toEqual(['zh-CN', 'zh-TW', 'en']);
    expect(normalizeLang()).toBe('zh-CN');
    expect(normalizeLang('zh')).toBe('zh-CN');
    expect(normalizeLang('zh-SG')).toBe('zh-CN');
    expect(normalizeLang('zh-Hans-CN')).toBe('zh-CN');
    expect(normalizeLang('zh-TW')).toBe('zh-TW');
    expect(normalizeLang('zh-HK')).toBe('zh-TW');
    expect(normalizeLang('zh_MO')).toBe('zh-TW');
    expect(normalizeLang('zh-Hant')).toBe('zh-TW');
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('ja')).toBe('en');
  });

  it('the i18n entry exports the dictionary API', () => {
    expect(i18nEntry.coreMessages('en').common.retry).toBe('Retry');
    expect(i18nEntry.platformLabel('wechat', 'en')).toBe('WeChat Official Account');
    expect(typeof i18nEntry.defineMessages).toBe('function');
  });
});

describe('platformLabel', () => {
  it('names platforms per language, keeping the original as `label`', () => {
    const cases: Array<[string, Record<SdkLang, string>]> = [
      ['wechat', { 'zh-CN': '微信公众号', 'zh-TW': '微信公眾號', en: 'WeChat Official Account' }],
      ['xiaohongshu', { 'zh-CN': '小红书', 'zh-TW': '小紅書', en: 'Xiaohongshu (RedNote)' }],
      ['bilibili', { 'zh-CN': 'B 站', 'zh-TW': '嗶哩嗶哩', en: 'Bilibili' }],
      ['zhihu', { 'zh-CN': '知乎', 'zh-TW': '知乎', en: 'Zhihu' }],
      ['zsxq', { 'zh-CN': '知识星球', 'zh-TW': '知識星球', en: 'ZSXQ (Knowledge Planet)' }],
      ['eastmoney', { 'zh-CN': '东方财富', 'zh-TW': '東方財富', en: 'East Money' }],
      ['chenji', { 'zh-CN': '辰记', 'zh-TW': '辰記', en: 'StarNote' }],
      ['hatena', { 'zh-CN': 'はてなブログ', 'zh-TW': 'はてなブログ', en: 'Hatena Blog' }],
      ['medium', { 'zh-CN': 'Medium', 'zh-TW': 'Medium', en: 'Medium' }],
    ];
    for (const [key, names] of cases)
      for (const lang of SDK_LANGS)
        expect(platformLabel(key, lang), `${key} ${lang}`).toBe(names[lang]);
    expect(platformLabel('wechat')).toBe('微信公众号');
    expect(platformLabel('nope', 'en', 'Nope')).toBe('Nope');
    expect(PLATFORMS.find((p) => p.key === 'wechat')!.label).toBe('微信公众号');
  });

  it('every Chinese platform has an English name', () => {
    for (const p of PLATFORMS)
      if (CJK.test(p.label)) expect(p.labels?.en, p.key).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('platforms.json (read by the API)', () => {
  it('carries labels and the compliance messages of every language', () => {
    const wechat = JSON.parse(JSON.stringify(PLATFORMS)).find(
      (p: { key: string }) => p.key === 'wechat'
    );
    expect(wechat.labels).toEqual({ 'zh-TW': '微信公眾號', en: 'WeChat Official Account' });
    expect(wechat.rules.aiLabel.notes.en).toContain('China’s Measures');
    expect(Object.keys(COMPLIANCE_MESSAGES)).toEqual(['zh-CN', 'zh-TW', 'en']);
    expect(COMPLIANCE_MESSAGES.en.learned.thisPlatform).toBe('this platform');
    const built = fileURLToPath(new URL('../dist/platforms.json', import.meta.url));
    if (existsSync(built)) {
      const json = JSON.parse(readFileSync(built, 'utf8'));
      expect(json.langs).toEqual(['zh-CN', 'zh-TW', 'en']);
      expect(json.platforms.find((p: { key: string }) => p.key === 'zhihu').labels.en).toBe(
        'Zhihu'
      );
      expect(json.compliance.messages['zh-TW'].tagsMin).toBe('至少需要 {min} 個標籤');
      expect(json.compliance.contactPatterns.map((c: { id: string }) => c.id)).toEqual([
        'phone',
        'wechat',
        'qq',
        'email',
      ]);
    }
  });
});

describe('messages in en and zh-TW', () => {
  it('compliance', () => {
    const doc = {
      title: '全网最低价的秘诀'.repeat(10),
      text: '扫码加微信 wx: abc_12345',
      aiAssisted: true,
      aiLabel: false,
    };
    const zh = checkCompliance({ platform: 'wechat', ...doc }).items.map((i) => i.message);
    const en = checkCompliance({ platform: 'wechat', ...doc, lang: 'en' }).items.map(
      (i) => i.message
    );
    const tw = checkCompliance({ platform: 'wechat', ...doc, lang: 'zh-TW' }).items.map(
      (i) => i.message
    );
    expect(zh).toContain('标题 80 字，超过平台上限 64 字');
    expect(en).toContain('Title has 80 characters, over the platform’s limit of 64');
    expect(tw).toContain('標題 80 字，超過平台上限 64 字');
    expect(en.some((m) => m.startsWith('“全网最低”') && m.includes('Advertising Law'))).toBe(true);
    expect(en.find((m) => m.startsWith('AI labeling is off'))).toContain('China’s Measures');
    expect(tw.find((m) => m.startsWith('已關閉 AI 標示'))).toContain('依法須標示');
    // same ids whatever the language (「忽略」 survives a language switch)
    expect(
      checkCompliance({ platform: 'wechat', ...doc, lang: 'en' }).items.map((i) => i.id)
    ).toEqual(checkCompliance({ platform: 'wechat', ...doc }).items.map((i) => i.id));
    // the returned rules carry the note in the language
    expect(
      checkCompliance({ platform: 'medium', aiAssisted: true, lang: 'en' }).rules!.aiLabel.note
    ).toMatch(/^Medium AI content policy:/);
    expect(platformRules('note', 'zh-TW')!.payout!.note).toBe(
      '收益只能提領到日本國內的本人帳戶 ⚠️'
    );
  });

  it('learned rules', () => {
    const rule = {
      id: 'r1',
      platform: '*',
      pattern: { type: 'keyword' as const, value: '加我' },
      suggestion: 'X',
      confidence: 0.9,
      source: 'user' as const,
    };
    const items = checkCompliance({
      platform: 'zhihu',
      text: '加我好友',
      extraRules: [rule],
      lang: 'en',
    }).items;
    expect(items[0]!.message).toBe(
      'From your recent publishing feedback: “加我” was rejected on several platforms before. X'
    );
  });

  it('runtime guides, media, forms, themes, Doc.report', async () => {
    const target = PLATFORMS.find((p) => p.key === 'zhihu')!;
    const en = planRuntime(target, { runtime: 'web', accounts: {} }, { lang: 'en' });
    expect(en.guides.map((g) => g.label)).toContain('Connect an account first');
    expect(en.guides.find((g) => g.kind === 'bind-first')!.reason).toBe(
      'No Zhihu account connected yet'
    );
    const tw = planRuntime(target, { runtime: 'web' }, { lang: 'zh-TW' });
    expect(tw.guides.at(-1)!.label).toBe('複製後手動發');

    const media = checkMedia(
      { cover: { minWidth: 900, minHeight: 500 } },
      [{ role: 'cover', width: 300, height: 200 }],
      { platform: 'Zhihu', lang: 'en' }
    );
    expect(media[0]!.text).toBe('Cover is too small: Zhihu needs at least 900×500');

    const { z } = await import('zod');
    const plain = { schema: z.object({}) };
    const both = { schema: z.object({}), schemaFor: () => z.object({ a: z.string() }) };
    expect(adapterSchema(plain, 'en')).toBe(plain.schema);
    expect(adapterSchema(both)).toBe(both.schema);
    expect(adapterSchema(both, 'en')).not.toBe(both.schema);
    expect(
      bindingInstructions({ instructions: ['a'], instructionsFor: () => ['b'] }, 'en')
    ).toEqual(['b']);
    expect(bindingInstructions({ instructions: ['a'], instructionsFor: () => ['b'] })).toEqual([
      'a',
    ]);

    expect(themeText('tech', 'en').name).toBe('Tech blue');
    expect(themeText('tech').name).toBe('科技蓝');
    expect(themeText('warm', 'zh-TW').name).toBe('文青暖');

    const doc = convert(
      { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x/a.png' } }] },
      { mobile: true, lang: 'en' }
    );
    expect(doc.report.map((r) => r.text).join()).toContain('1 image capped at phone-screen width');
  });

  it('zod form rules', async () => {
    const { z } = await import('zod');
    const s = z.object({ name: z.string().max(3).describe('名字'), n: z.number() });
    expect(zodToAntdRules(s, { lang: 'en' }).name![0]!.message).toBe('Please enter 名字');
    expect(zodToAntdRules(s, { lang: 'en' }).name![1]!.message).toBe('At most 3 characters');
    expect(zodToAntdRules(s, { lang: 'zh-TW' }).n![1]!.message).toBe('請輸入數字');
    expect(zodToAntdRules(s).n![1]!.message).toBe('请输入数字');
  });

  it('the publisher: failures, actions and prepared tasks', async () => {
    const failing = defineAdapter({
      key: 'zhihu',
      label: '知乎',
      runtimes: [{ runtime: 'web', mode: 'api' }],
      capabilities: { supportsUpdate: false },
      schema: (await import('zod')).z.object({}),
      publish: async () => {
        throw Object.assign(new Error('boom'), { retryAfterSec: 30 });
      },
    });
    const doc = convert({ type: 'doc', content: [] });
    const pub = createPublisher({ adapters: [failing], runtime: 'electron', lang: 'en' });
    const r = await pub.publish({
      noteId: 'n',
      doc,
      platforms: ['zhihu', 'nope'],
      common: {},
      perPlatform: {},
    });
    expect(r.results.zhihu!.error).toBe('Zhihu can’t be published from the desktop app');
    expect(r.results.nope!.error).toBe('This platform isn’t supported yet');

    const web = createPublisher({ adapters: [failing], runtime: 'web' });
    const tw = await web.publish({
      noteId: 'n',
      doc,
      platforms: ['zhihu'],
      common: {},
      perPlatform: {},
      lang: 'zh-TW',
    });
    expect(tw.results.zhihu!.actions![0]!.label).toBe('30 秒後重試');

    const tasks = prepareTasks(
      { doc, targets: [{ platform: 'zhihu' }], common: {}, lang: 'en' },
      { adapterOf: () => undefined, planTarget: () => PLATFORMS.find((p) => p.key === 'zhihu')! }
    );
    expect(tasks[0]!.label).toBe('Zhihu');
  });
});
