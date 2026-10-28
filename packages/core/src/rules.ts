/**
 * Per-platform publishing rules (CONTRACTS-r9 §5): length / tag / image limits, links, 导流, 广告法极限词 and
 * the 「AI 生成内容」 label. Read by `checkCompliance` (deterministic, local) and shown in the publish panel.
 *
 * 平台规则以官方最新为准. Every entry names its `source` and `checkedAt`; `verified: '待核实'` marks
 * entries whose numbers come from the platforms' editors / common practice and were not re-checked against
 * an official document this round (the `note` says what is and is not verified).
 *
 * The AI label: 《人工智能生成合成内容标识办法》 (国家网信办、工业和信息化部、公安部、国家广电总局，国信办通字〔2025〕2号)
 * and the mandatory national standard GB 45438-2025《网络安全技术 人工智能生成合成内容标识方法》 both took effect
 * on 2025-09-01. Users who publish AI-generated / synthesised content on a platform must declare it and use the
 * platform's labelling feature, and must not remove or hide labels (办法 第十条). The CN platforms below implement
 * this as a creator-side 「内容由 AI 生成」 declaration on publish (verified from the platforms' 2025-09
 * announcements as reported by the press for 微信/公众号/视频号、抖音、微博、小红书、B站; others: 待核实).
 */
import type { PlatformKey } from './platforms';

export interface PlatformRules {
  /** Title length in characters (a CJK character counts 1). */
  title?: { max: number; min?: number };
  summary?: { max: number };
  body?: { max?: number };
  tags?: { max: number; min?: number; format?: 'hash' | 'plain' };
  images?: { min?: number; max?: number; ratios?: string[] };
  /** `stripped`: kept as text but not clickable (公众号). `forbidden`: must not appear (小红书). */
  externalLinks: 'allowed' | 'stripped' | 'forbidden';
  /** 禁止导流: no phone / WeChat / QQ / e-mail contact details. */
  noContact: boolean;
  /** No QR codes (images or 「扫码」 prompts). */
  noQrcode: boolean;
  /** 《广告法》极限词 avoided (最佳、第一、国家级…). */
  adLawWords: boolean;
  aiLabel: {
    required: boolean | '待核实';
    /** `platform-toggle`: tick the platform's own 「AI 生成」 declaration; `footer`: a line in the text. */
    method: 'platform-toggle' | 'footer' | 'both';
    /** Where a text declaration goes; default `bottom`. */
    placement?: 'top' | 'bottom';
    note: string;
  };
  /**
   * SPEC-r13 §6.6 财经平台（雪球、东方财富…）: 荐股、收益承诺、拉群带单的说法会被处理，提到个股时提醒披露持仓
   * （`checkCompliance` 的 `finance`）。
   */
  finance?: boolean;
  /** SPEC-r13 §6.6: the platform takes first publications only (人人都是产品经理 投稿): warn when already published elsewhere. */
  firstPublish?: boolean;
  /** SPEC-r13 §6.6: signing there is exclusive (网文平台): warn before sending a signed work anywhere else. */
  exclusive?: boolean;
  /** 依据: official document name / URL. */
  source: string;
  verified: boolean | '待核实';
  checkedAt: '2026-10';
}

const CN_AI_LAW =
  '《人工智能生成合成内容标识办法》（2025-09-01 施行）+ GB 45438-2025：发布 AI 生成合成内容须主动声明并使用平台提供的标识功能';
const CN_SOURCE_LAW =
  '《人工智能生成合成内容标识办法》国信办通字〔2025〕2号 第十条 https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm ；GB 45438-2025';

type Base = Omit<PlatformRules, 'aiLabel' | 'source' | 'verified' | 'checkedAt'>;

/** A CN platform: 广告法 words checked, AI label required by law. */
function cn(
  base: Partial<Base>,
  ai: { method?: PlatformRules['aiLabel']['method']; note: string },
  source: string,
  verified: PlatformRules['verified'] = '待核实'
): PlatformRules {
  return {
    externalLinks: 'allowed',
    noContact: false,
    noQrcode: false,
    ...base,
    adLawWords: true,
    aiLabel: { required: true, method: ai.method ?? 'both', note: `${CN_AI_LAW}。${ai.note}` },
    source: `${source}；${CN_SOURCE_LAW}`,
    verified,
    checkedAt: '2026-10',
  };
}

/** An overseas platform: no 广告法 list; AI label per the platform's own policy. */
function intl(
  base: Partial<Base>,
  ai: PlatformRules['aiLabel'],
  source: string,
  verified: PlatformRules['verified'] = '待核实'
): PlatformRules {
  return {
    externalLinks: 'allowed',
    noContact: false,
    noQrcode: false,
    ...base,
    adLawWords: false,
    aiLabel: ai,
    source,
    verified,
    checkedAt: '2026-10',
  };
}

const CN_TOGGLE_UNVERIFIED = '平台自带的 AI 声明入口待核实；未找到入口时在文末加声明。';
const INTL_NO_RULE: PlatformRules['aiLabel'] = {
  required: false,
  method: 'footer',
  note: '平台未要求文字类内容标注 AI（待核实）；建议在文末说明 AI 辅助，以示透明。',
};
const META_AI: PlatformRules['aiLabel'] = {
  required: false,
  method: 'platform-toggle',
  note: 'Meta：逼真的 AI 生成 / 修改图片、视频、音频须在发布时打开「AI 标签」（显示为 AI info）；纯文字不强制。',
};

export const PLATFORM_RULES: Partial<Record<PlatformKey, PlatformRules>> = {
  // ---------------------------------------------------------------- 国内
  chenji: cn(
    { title: { max: 100 }, summary: { max: 200 }, tags: { max: 10, format: 'plain' } },
    {
      method: 'footer',
      note: '辰记在文末加「本文部分内容由 AI 辅助生成。」，博客页另有 AI 辅助标记。',
    },
    '辰记自有规则',
    true
  ),
  wechat: cn(
    {
      title: { max: 64 },
      summary: { max: 120 },
      body: { max: 20000 },
      externalLinks: 'stripped',
      noQrcode: false,
    },
    {
      method: 'platform-toggle',
      note: '微信 2025-08-31 公告：发布 AI 生成合成内容须主动声明（发表页「内容声明」选择 AI 生成），不得删除平台标识。',
    },
    '微信公众平台运营规范；微信珊瑚安全《关于进一步规范人工智能生成合成内容标识的公告》（2025-08-31）',
    '待核实'
  ),
  zhihu: cn(
    { title: { max: 100 }, tags: { max: 3, format: 'plain' }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '知乎社区规范（站外导流、广告）'
  ),
  juejin: cn(
    { title: { max: 100 }, summary: { max: 100 }, tags: { min: 1, max: 3, format: 'plain' } },
    { note: CN_TOGGLE_UNVERIFIED },
    '稀土掘金 创作者规范 / 发文页限制'
  ),
  csdn: cn(
    { title: { min: 5, max: 100 }, summary: { max: 256 }, tags: { max: 7, format: 'plain' } },
    { note: CN_TOGGLE_UNVERIFIED },
    'CSDN 发文页限制'
  ),
  // SPEC-r13 §6: 垂类平台（桌面端发布台）。字数等限制没有可靠来源，先不写；接入时按发文页补。
  xueqiu: cn(
    { finance: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '雪球 社区公约 / 专栏协议 https://xueqiu.com/law/column'
  ),
  eastmoney: cn(
    { finance: true, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '东方财富 股吧管理规定 https://guba.eastmoney.com/gltl.aspx ；财富号公告 https://mp.eastmoney.com/collect/pc_writer/treaty.html'
  ),
  huxiu: cn({}, { note: CN_TOGGLE_UNVERIFIED }, '虎嗅 投稿须知 https://www.huxiu.com/contribute/'),
  woshipm: cn(
    { firstPublish: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '人人都是产品经理 原创激励计划（要求首发）https://zt.woshipm.com/media/author.html'
  ),
  sspai: cn(
    {},
    { note: CN_TOGGLE_UNVERIFIED },
    '少数派 社区规则 https://sspai.com/page/community-rules'
  ),
  zsxq: cn({}, { note: CN_TOGGLE_UNVERIFIED }, '知识星球 网页版长文（星主 / 成员发帖）'),
  dongchedi: cn(
    {},
    { note: CN_TOGGLE_UNVERIFIED },
    '懂车帝 创作者运营规范 https://dongchedi.com/public/protocol/opsspecs'
  ),
  hupu: cn({}, { note: CN_TOGGLE_UNVERIFIED }, '虎扑 用户协议 https://www.hupu.com/policies/terms'),
  douban: cn(
    {},
    { note: CN_TOGGLE_UNVERIFIED },
    '豆瓣 使用协议 https://www.douban.com/about/agreement'
  ),
  'douban-read': cn(
    {},
    { note: CN_TOGGLE_UNVERIFIED },
    '豆瓣阅读 作者帮助中心 https://read.douban.com/helpcenter/works_management/'
  ),
  mafengwo: cn({}, { note: CN_TOGGLE_UNVERIFIED }, '马蜂窝 游记发布（网页编辑器待核实）'),
  xiaohongshu: cn(
    {
      title: { max: 20 },
      body: { max: 1000 },
      tags: { max: 10, format: 'hash' },
      images: { min: 1, max: 18, ratios: ['3:4', '1:1', '4:3'] },
      externalLinks: 'forbidden',
      noContact: true,
      noQrcode: true,
    },
    {
      method: 'platform-toggle',
      note: '小红书发布页「添加内容类型声明」选择「内容含 AI 合成」；未声明的疑似 AI 内容会被平台标注或限流。',
    },
    '小红书社区规范（站外导流：联系方式、二维码、外链）；小红书 AI 内容标识公告（2025-09）'
  ),
  yuque: cn(
    { title: { max: 100 } },
    { method: 'footer', note: '语雀以文档为主，未见 AI 声明开关（待核实），用文末声明。' },
    '语雀服务协议'
  ),
  weibo: cn(
    {
      body: { max: 2000 },
      tags: { max: 10, format: 'hash' },
      images: { max: 18 },
      noContact: false,
    },
    {
      method: 'platform-toggle',
      note: '微博公告：AI 生成合成内容在发布时「选择内容声明 → 内容由 AI 生成」；另设「未添加 AI 标识」投诉类别。',
    },
    '微博社区公约；微博关于 AI 生成内容标识的公告（2025-09）'
  ),
  toutiao: cn(
    { title: { min: 5, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '今日头条 头条号创作规范（标题 5–30 字）'
  ),
  baijiahao: cn(
    { title: { min: 8, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '百家号内容规范'
  ),
  netease: cn(
    { title: { min: 5, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '网易号运营规范'
  ),
  sohu: cn(
    { title: { min: 5, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '搜狐号内容规范'
  ),
  'qq-om': cn(
    { title: { min: 5, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '腾讯内容开放平台（企鹅号）内容规范'
  ),
  dayu: cn(
    { title: { min: 5, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '大鱼号内容规范'
  ),
  yidian: cn(
    { title: { min: 5, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '一点号内容规范'
  ),
  bilibili: cn(
    { title: { max: 40 }, tags: { max: 10, format: 'plain' }, noContact: true, noQrcode: true },
    {
      method: 'platform-toggle',
      note: 'B 站投稿页可勾选「作者声明：使用 AI 合成技术」；未标注的 AI 内容可能被限流 / 下架。',
    },
    '哔哩哔哩社区公约；B 站 AI 内容标识公告（2025-09）'
  ),
  douyin: cn(
    {
      title: { max: 20 },
      body: { max: 1000 },
      tags: { max: 5, format: 'hash' },
      images: { max: 35 },
      noContact: true,
      noQrcode: true,
    },
    {
      method: 'platform-toggle',
      note: '抖音发布页「添加声明 → 内容由 AI 生成」；未标注可能被取消营利、限流。',
    },
    '抖音社区自律公约；抖音关于人工智能生成内容的平台规范（2023-05 起，2025-09 更新）'
  ),
  kuaishou: cn(
    { title: { max: 30 }, tags: { max: 5, format: 'hash' }, noContact: true, noQrcode: true },
    { method: 'platform-toggle', note: '快手发布页 AI 声明开关待核实。' },
    '快手社区规范'
  ),
  'wechat-channels': cn(
    { title: { min: 6, max: 16 }, body: { max: 1000 }, tags: { max: 10, format: 'hash' } },
    {
      method: 'platform-toggle',
      note: '视频号随微信 2025-08-31 公告：发布时主动声明 AI 生成，不得删除平台标识。',
    },
    '微信视频号运营规范；微信珊瑚安全 AI 内容标识公告（2025-08-31）'
  ),
  jianshu: cn(
    { title: { max: 100 }, noContact: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '简书社区规范'
  ),
  smzdm: cn(
    { title: { max: 60 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '什么值得买 原创内容规范'
  ),
  cnblogs: cn(
    { title: { max: 100 }, summary: { max: 300 } },
    { method: 'footer', note: '博客园未见 AI 声明开关（待核实），用文末声明。' },
    '博客园 发文规范'
  ),
  segmentfault: cn(
    { title: { max: 100 }, tags: { min: 1, max: 5, format: 'plain' } },
    { note: CN_TOGGLE_UNVERIFIED },
    'SegmentFault 思否 社区规范'
  ),
  oschina: cn({ title: { max: 100 } }, { note: CN_TOGGLE_UNVERIFIED }, '开源中国 博客规范'),
  'tencent-cloud': cn(
    {
      title: { max: 60 },
      summary: { max: 200 },
      tags: { max: 5, format: 'plain' },
      noContact: true,
    },
    { note: CN_TOGGLE_UNVERIFIED },
    '腾讯云开发者社区 内容规范'
  ),
  '51cto': cn(
    { title: { max: 100 }, tags: { max: 5, format: 'plain' } },
    { note: CN_TOGGLE_UNVERIFIED },
    '51CTO 博客规范'
  ),

  // ---------------------------------------------------------------- 海外
  'github-pages': intl({}, INTL_NO_RULE, '自有站点：无平台规则', true),
  medium: intl(
    { tags: { max: 5, format: 'plain' } },
    {
      required: true,
      method: 'footer',
      placement: 'top',
      note: 'Medium AI content policy：AI 辅助写作须在文章开头（前两段内）声明；完全 AI 生成的内容不能进 Partner Program 付费墙，未声明的只在关注者网络内分发；AI 生成图片须在图注说明。',
    },
    'Medium Help Center: Artificial Intelligence (AI) content policy https://help.medium.com/hc/en-us/articles/22576852947223（官方页 2026-10 抓取被拒，据二手报道整理，待核实）'
  ),
  substack: intl({}, INTL_NO_RULE, 'Substack Content Guidelines'),
  ghost: intl({}, INTL_NO_RULE, '自托管：无平台规则', true),
  wordpress: intl({}, INTL_NO_RULE, '自托管：无平台规则', true),
  'wordpress-com': intl(
    { tags: { max: 15, format: 'plain' } },
    INTL_NO_RULE,
    'WordPress.com User Guidelines'
  ),
  devto: intl(
    { tags: { max: 4, format: 'plain' } },
    {
      required: true,
      method: 'footer',
      note: 'DEV Community Guidelines for AI-assisted articles：AI 辅助内容须披露（待核实具体位置）。',
    },
    'DEV Community: Guidelines for AI-assisted Articles on DEV'
  ),
  hashnode: intl({ tags: { max: 5, format: 'plain' } }, INTL_NO_RULE, 'Hashnode Content Policy'),
  blogger: intl({}, INTL_NO_RULE, 'Blogger Content Policy'),
  linkedin: intl({ body: { max: 3000 } }, INTL_NO_RULE, 'LinkedIn Professional Community Policies'),
  x: intl(
    { body: { max: 280 } },
    {
      required: false,
      method: 'footer',
      note: 'X Synthetic and manipulated media policy：误导性的合成媒体会被标注或移除；文字不强制标注（待核实）。',
    },
    'X Help Center: Synthetic and manipulated media policy'
  ),
  facebook: intl({}, META_AI, 'Meta: Labeling AI-generated content (AI info)'),
  threads: intl({ body: { max: 500 } }, META_AI, 'Meta: Labeling AI-generated content (AI info)'),
  reddit: intl({ title: { max: 300 } }, INTL_NO_RULE, 'Reddit Content Policy（各版块规则另计）'),
  telegram: intl({ body: { max: 4096 } }, INTL_NO_RULE, 'Telegram Terms of Service'),
  // SPEC-r11 §10: 2000 characters per message, embed description 4096 (Discord developer docs: Execute Webhook)
  discord: intl(
    { body: { max: 2000 } },
    INTL_NO_RULE,
    'Discord Community Guidelines；各服务器规则另计'
  ),
  // ⚠️ Slack: a section block's text up to 3000 characters (Block Kit reference)
  slack: intl(
    { body: { max: 3000 } },
    INTL_NO_RULE,
    'Slack Acceptable Use Policy；各工作区规则另计'
  ),
  quora: intl(
    {},
    {
      required: true,
      method: 'footer',
      note: 'Quora 要求披露 AI 生成的回答内容（待核实）。',
    },
    'Quora Policies: AI-generated content'
  ),
  vocal: intl(
    {},
    {
      required: '待核实',
      method: 'footer',
      note: 'Vocal 对 AI 生成内容有限制（待核实），建议文末声明。',
    },
    'Vocal Community Guidelines'
  ),
  newsbreak: intl({}, INTL_NO_RULE, 'NewsBreak Contributor Content Policy'),
  patreon: intl({}, INTL_NO_RULE, 'Patreon Community Guidelines'),
  buymeacoffee: intl({}, INTL_NO_RULE, 'Buy Me a Coffee Terms'),
  pinterest: intl(
    { title: { max: 100 }, summary: { max: 500 } },
    {
      required: false,
      method: 'platform-toggle',
      note: 'Pinterest 会对检测到的 AI 生成图片显示「AI modified」标签（待核实）。',
    },
    'Pinterest Community Guidelines'
  ),
  youtube: intl(
    { title: { max: 100 }, summary: { max: 5000 } },
    {
      required: true,
      method: 'platform-toggle',
      note: 'YouTube：逼真的改动 / 合成内容须在上传时勾选「Altered or synthetic content」；明显不真实的、仅做美化的不必。',
    },
    'YouTube Help: Disclosing use of altered or synthetic content（据二手报道整理，待核实）'
  ),
  instagram: intl(
    {
      body: { max: 2200 },
      tags: { max: 30, format: 'hash' },
      images: { min: 1, max: 20, ratios: ['1:1', '4:5', '1.91:1'] },
    },
    META_AI,
    'Meta: Labeling AI-generated content (AI info)；Instagram Help Center'
  ),
  bluesky: intl({ body: { max: 300 } }, INTL_NO_RULE, 'Bluesky Community Guidelines'),
  mastodon: intl({ body: { max: 500 } }, INTL_NO_RULE, 'Mastodon 默认 500 字（各实例不同）'),
  tumblr: intl({ tags: { max: 30, format: 'plain' } }, INTL_NO_RULE, 'Tumblr Community Guidelines'),
};

/** The rules of a platform, or `undefined` for an unknown key. */
export function platformRules(key: string): PlatformRules | undefined {
  return (PLATFORM_RULES as Record<string, PlatformRules | undefined>)[key];
}
