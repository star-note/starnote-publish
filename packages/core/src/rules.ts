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
import { normalizeLang, pickText } from './i18n/lang';

import type { I18nText } from './i18n/lang';
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
    /** Shown in the publish panel (简体 source); `notes` has it in the other languages (`aiLabelNote`). */
    note: string;
    notes?: I18nText;
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
  /**
   * SPEC-r14 A2: can an author in mainland China be paid there (most payouts go through Stripe, which does not
   * serve mainland individuals); shown in the publish panel and the comparison tables.
   */
  payout?: { mainland: 'yes' | 'no' | 'unknown'; note: string; notes?: I18nText };
  /** 依据: official document name / URL. */
  source: string;
  verified: boolean | '待核实';
  checkedAt: '2026-10';
}

const CN_AI_LAW =
  '《人工智能生成合成内容标识办法》（2025-09-01 施行）+ GB 45438-2025：发布 AI 生成合成内容须主动声明并使用平台提供的标识功能';
const CN_SOURCE_LAW =
  '《人工智能生成合成内容标识办法》国信办通字〔2025〕2号 第十条 https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm ；GB 45438-2025';

const CN_AI_LAW_TW =
  '中國《人工智能生成合成內容標識辦法》（2025-09-01 施行）+ GB 45438-2025：發布 AI 生成合成內容須主動聲明並使用平台提供的標示功能';
const CN_AI_LAW_EN =
  'China’s Measures for Labeling AI-Generated Synthetic Content (in force since 2025-09-01) and GB 45438-2025: AI-generated or synthesized content must be declared when published, using the platform’s labeling feature';

/**
 * SPEC-r14 B5: the user-visible rule notes (`aiLabel.note`, `payout.note`; the 简体 text is the key) in the other
 * languages. Sources (`source`) are citations and stay as written.
 */
const RULE_TEXT: Record<string, I18nText> = {
  '平台自带的 AI 声明入口待核实；未找到入口时在文末加声明。': {
    'zh-TW': '平台內建的 AI 聲明入口待核實；找不到入口時在文末加上聲明。',
    en: 'The platform’s own AI declaration is unverified; if you can’t find it, add a note at the end.',
  },
  '平台未要求文字类内容标注 AI（待核实）；建议在文末说明 AI 辅助，以示透明。': {
    'zh-TW': '平台未要求文字類內容標示 AI（待核實）；建議在文末說明 AI 輔助，以示透明。',
    en: 'The platform doesn’t require AI labels on text (unverified); a note on AI assistance at the end is recommended for transparency.',
  },
  'Meta：逼真的 AI 生成 / 修改图片、视频、音频须在发布时打开「AI 标签」（显示为 AI info）；纯文字不强制。':
    {
      'zh-TW':
        'Meta：逼真的 AI 生成 / 修改圖片、影片、音訊須在發布時開啟「AI 標籤」（顯示為 AI info）；純文字不強制。',
      en: 'Meta: realistic AI-generated or edited images, video and audio must be published with the “AI info” label on; plain text isn’t required to.',
    },
  '辰记在文末加「本文部分内容由 AI 辅助生成。」，博客页另有 AI 辅助标记。': {
    'zh-TW': '辰記在文末加上一句 AI 輔助聲明，部落格頁另有 AI 輔助標記。',
    en: 'StarNote adds “Parts of this article were produced with AI assistance.” at the end, and the blog page shows an AI-assisted badge.',
  },
  '微信 2025-08-31 公告：发布 AI 生成合成内容须主动声明（发表页「内容声明」选择 AI 生成），不得删除平台标识。':
    {
      'zh-TW':
        '微信 2025-08-31 公告：發布 AI 生成合成內容須主動聲明（發表頁「內容聲明」選擇 AI 生成），不得刪除平台標示。',
      en: 'WeChat notice of 2025-08-31: declare AI-generated content when publishing (choose “AI-generated” under the content declaration) and don’t remove the platform’s label.',
    },
  '小红书发布页「添加内容类型声明」选择「内容含 AI 合成」；未声明的疑似 AI 内容会被平台标注或限流。':
    {
      'zh-TW':
        '小紅書發布頁「新增內容類型聲明」選擇「內容含 AI 合成」；未聲明的疑似 AI 內容會被平台標示或限流。',
      en: 'On Xiaohongshu’s publish page, add a content-type declaration and choose “contains AI-synthesized content”; undeclared AI-like content gets labeled or limited.',
    },
  '语雀以文档为主，未见 AI 声明开关（待核实），用文末声明。': {
    'zh-TW': '語雀以文件為主，未見 AI 聲明開關（待核實），用文末聲明。',
    en: 'Yuque is document-centric with no AI declaration switch found (unverified): a note at the end is used.',
  },
  '微博公告：AI 生成合成内容在发布时「选择内容声明 → 内容由 AI 生成」；另设「未添加 AI 标识」投诉类别。':
    {
      'zh-TW':
        '微博公告：AI 生成合成內容在發布時「選擇內容聲明 → 內容由 AI 生成」；另設「未添加 AI 標識」檢舉類別。',
      en: 'Weibo notice: when publishing AI-generated content, choose content declaration → “AI-generated”; there is also a report category for missing AI labels.',
    },
  'B 站投稿页可勾选「作者声明：使用 AI 合成技术」；未标注的 AI 内容可能被限流 / 下架。': {
    'zh-TW': 'B 站投稿頁可勾選「作者聲明：使用 AI 合成技術」；未標示的 AI 內容可能被限流 / 下架。',
    en: 'Bilibili’s upload page has an author declaration “uses AI synthesis”; unlabeled AI content may be limited or taken down.',
  },
  '抖音发布页「添加声明 → 内容由 AI 生成」；未标注可能被取消营利、限流。': {
    'zh-TW': '抖音發布頁「新增聲明 → 內容由 AI 生成」；未標示可能被取消營利、限流。',
    en: 'On Douyin’s publish page: add declaration → “AI-generated”; unlabeled posts may lose monetization or be limited.',
  },
  '快手发布页 AI 声明开关待核实。': {
    'zh-TW': '快手發布頁的 AI 聲明開關待核實。',
    en: 'Kuaishou’s AI declaration switch on the publish page is unverified.',
  },
  '视频号随微信 2025-08-31 公告：发布时主动声明 AI 生成，不得删除平台标识。': {
    'zh-TW': '視頻號依微信 2025-08-31 公告：發布時主動聲明 AI 生成，不得刪除平台標示。',
    en: 'WeChat Channels follows WeChat’s notice of 2025-08-31: declare AI-generated content when publishing and don’t remove the platform’s label.',
  },
  '博客园未见 AI 声明开关（待核实），用文末声明。': {
    'zh-TW': '博客園未見 AI 聲明開關（待核實），用文末聲明。',
    en: 'Cnblogs has no AI declaration switch that we found (unverified): a note at the end is used.',
  },
  'Medium AI content policy：AI 辅助写作须在文章开头（前两段内）声明；完全 AI 生成的内容不能进 Partner Program 付费墙，未声明的只在关注者网络内分发；AI 生成图片须在图注说明。':
    {
      'zh-TW':
        'Medium AI content policy：AI 輔助寫作須在文章開頭（前兩段內）聲明；完全 AI 生成的內容不能進入 Partner Program 付費牆，未聲明的只在追蹤者網路內分發；AI 生成圖片須在圖說註明。',
      en: 'Medium AI content policy: AI-assisted writing must be disclosed at the start (within the first two paragraphs); fully AI-generated content can’t be behind the Partner Program paywall and undisclosed posts are only distributed to followers; AI images need a caption saying so.',
    },
  'DEV Community Guidelines for AI-assisted articles：AI 辅助内容须披露（待核实具体位置）。': {
    'zh-TW':
      'DEV Community Guidelines for AI-assisted articles：AI 輔助內容須揭露（具體位置待核實）。',
    en: 'DEV Community Guidelines for AI-assisted articles: AI-assisted content must be disclosed (where exactly is unverified).',
  },
  'X Synthetic and manipulated media policy：误导性的合成媒体会被标注或移除；文字不强制标注（待核实）。':
    {
      'zh-TW':
        'X Synthetic and manipulated media policy：誤導性的合成媒體會被標示或移除；文字不強制標示（待核實）。',
      en: 'X synthetic and manipulated media policy: misleading synthetic media gets labeled or removed; text isn’t required to be labeled (unverified).',
    },
  'Quora 要求披露 AI 生成的回答内容（待核实）。': {
    'zh-TW': 'Quora 要求揭露 AI 生成的回答內容（待核實）。',
    en: 'Quora asks you to disclose AI-generated answers (unverified).',
  },
  'Vocal 对 AI 生成内容有限制（待核实），建议文末声明。': {
    'zh-TW': 'Vocal 對 AI 生成內容有限制（待核實），建議在文末聲明。',
    en: 'Vocal restricts AI-generated content (unverified); a note at the end is recommended.',
  },
  'Pinterest 会对检测到的 AI 生成图片显示「AI modified」标签（待核实）。': {
    'zh-TW': 'Pinterest 會對偵測到的 AI 生成圖片顯示「AI modified」標籤（待核實）。',
    en: 'Pinterest shows an “AI modified” label on images it detects as AI-generated (unverified).',
  },
  'YouTube：逼真的改动 / 合成内容须在上传时勾选「Altered or synthetic content」；明显不真实的、仅做美化的不必。':
    {
      'zh-TW':
        'YouTube：逼真的修改 / 合成內容須在上傳時勾選「Altered or synthetic content」；明顯不真實的、僅做美化的不必。',
      en: 'YouTube: realistic altered or synthetic content must be marked “Altered or synthetic content” on upload; clearly unrealistic or merely beautified content needn’t be.',
    },
  // payout
  '付费 Newsletter 走 Stripe，大陆个人不能直接收款；港、新账户可以': {
    'zh-TW': '付費電子報經 Stripe 收款，中國大陸個人無法直接收款；香港、新加坡帳戶可以',
    en: 'Paid newsletters are paid out through Stripe, which mainland China individuals can’t use directly; Hong Kong and Singapore accounts can',
  },
  '付费订阅走 Stripe，大陆个人不能直接收款；广告网络收款条件未核实 ⚠️': {
    'zh-TW': '付費訂閱經 Stripe 收款，中國大陸個人無法直接收款；廣告聯播網的收款條件未核實 ⚠️',
    en: 'Paid subscriptions go through Stripe, which mainland China individuals can’t use directly; ad network payout terms unverified ⚠️',
  },
  '付费订阅走 Stripe，大陆个人不能直接收款；港、新账户可以': {
    'zh-TW': '付費訂閱經 Stripe 收款，中國大陸個人無法直接收款；香港、新加坡帳戶可以',
    en: 'Paid subscriptions go through Stripe, which mainland China individuals can’t use directly; Hong Kong and Singapore accounts can',
  },
  '收入来自 AdSense / 联盟（もしもアフィリエイト等），按各自的收款规则 ⚠️': {
    'zh-TW': '收入來自 AdSense / 聯盟行銷（もしもアフィリエイト等），依各自的收款規則 ⚠️',
    en: 'Income comes from AdSense / affiliates (Moshimo Affiliate etc.), under each one’s payout rules ⚠️',
  },
  '打赏 / 付费本的收益提到金融机构账户或换亚马逊礼品卡；是否接受海外账户官方未写明 ⚠️': {
    'zh-TW':
      '贊助 / 付費書的收益可提領到金融機構帳戶或換成亞馬遜禮品卡；官方未寫明是否接受海外帳戶 ⚠️',
    en: 'Tips and paid books pay out to a bank account or as Amazon gift cards; whether overseas accounts work isn’t stated ⚠️',
  },
  '收益只能提到日本国内的本人账户 ⚠️': {
    'zh-TW': '收益只能提領到日本國內的本人帳戶 ⚠️',
    en: 'Earnings can only be paid out to your own bank account in Japan ⚠️',
  },
  '广告分成换成 BOOK☆WALKER 币或亚马逊礼品卡 ⚠️': {
    'zh-TW': '廣告分潤換成 BOOK☆WALKER 幣或亞馬遜禮品卡 ⚠️',
    en: 'Ad revenue share is paid as BOOK☆WALKER coins or Amazon gift cards ⚠️',
  },
  '애드포스트 需要实名认证的 Naver 账号 ⚠️': {
    'zh-TW': '애드포스트 需要實名認證的 Naver 帳號 ⚠️',
    en: 'AdPost needs a Naver account with real-name verification ⚠️',
  },
  'AdSense 按 Google 的规则；AdFit 未核实 ⚠️': {
    'zh-TW': 'AdSense 依 Google 的規則；AdFit 未核實 ⚠️',
    en: 'AdSense follows Google’s rules; AdFit unverified ⚠️',
  },
  '응원하기 很可能需要韩国本人认证 ⚠️': {
    'zh-TW': '응원하기 很可能需要韓國本人認證 ⚠️',
    en: 'Cheering (응원하기) most likely needs Korean identity verification ⚠️',
  },
  '付费内容的提现条件未核实 ⚠️': {
    'zh-TW': '付費內容的提領條件未核實 ⚠️',
    en: 'Payout terms for paid content are unverified ⚠️',
  },
  '境外作者经 PayPal 收款；单次超过 NT$5,000 代扣 20%': {
    'zh-TW': '境外作者經 PayPal 收款；單次超過 NT$5,000 代扣 20%',
    en: 'Authors outside Taiwan are paid through PayPal; 20% is withheld on payouts over NT$5,000',
  },
  '合同独家且永久；收款方式官方未写明 ⚠️': {
    'zh-TW': '合約為獨家且永久；官方未寫明收款方式 ⚠️',
    en: 'Contracts are exclusive and permanent; how you get paid isn’t stated ⚠️',
  },
  'Paid Stories 需受邀，收款条件未核实 ⚠️': {
    'zh-TW': 'Paid Stories 需受邀，收款條件未核實 ⚠️',
    en: 'Paid Stories is invitation-only; payout terms unverified ⚠️',
  },
  '只经 PayPal 打款，满 €30；国家限制未写明 ⚠️': {
    'zh-TW': '只經 PayPal 撥款，滿 €30；國家限制未寫明 ⚠️',
    en: 'Paid only through PayPal, from €30; country restrictions aren’t stated ⚠️',
  },
  '走 PayPal 时取决于 PayPal 中国账户能否收款 ⚠️': {
    'zh-TW': '經 PayPal 收款時，取決於 PayPal 中國帳戶能否收款 ⚠️',
    en: 'With PayPal, it depends on whether a PayPal China account can receive payments ⚠️',
  },
};

/** `aiLabel.note` in `lang` (SPEC-r14 B5). */
export function aiLabelNote(
  ai: Pick<PlatformRules['aiLabel'], 'note' | 'notes'>,
  lang?: string | null
): string {
  return pickText(ai.note, ai.notes, lang);
}

/** `payout.note` in `lang` (SPEC-r14 B5). */
export function payoutNote(
  payout: Pick<NonNullable<PlatformRules['payout']>, 'note' | 'notes'>,
  lang?: string | null
): string {
  return pickText(payout.note, payout.notes, lang);
}

/** The rule notes still untranslated (tests: must be empty). */
export function untranslatedRuleNotes(): string[] {
  const out = new Set<string>();
  for (const r of Object.values(PLATFORM_RULES)) {
    if (!r) continue;
    if (!r.aiLabel.notes?.en || !r.aiLabel.notes['zh-TW']) out.add(r.aiLabel.note);
    if (r.payout && (!r.payout.notes?.en || !r.payout.notes['zh-TW'])) out.add(r.payout.note);
  }
  return [...out];
}

/** Adds `notes` to the intl AI notes and the payout notes (the CN AI notes get theirs in `cn`). */
function withNotes(rules: PlatformRules): PlatformRules {
  const ai = rules.aiLabel.notes
    ? rules.aiLabel
    : RULE_TEXT[rules.aiLabel.note]
      ? { ...rules.aiLabel, notes: RULE_TEXT[rules.aiLabel.note] }
      : rules.aiLabel;
  const payout =
    rules.payout && RULE_TEXT[rules.payout.note]
      ? { ...rules.payout, notes: RULE_TEXT[rules.payout.note] }
      : rules.payout;
  return { ...rules, aiLabel: ai, ...(payout ? { payout } : {}) };
}

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
    aiLabel: {
      required: true,
      method: ai.method ?? 'both',
      note: `${CN_AI_LAW}。${ai.note}`,
      notes: {
        'zh-TW': `${CN_AI_LAW_TW}。${RULE_TEXT[ai.note]?.['zh-TW'] ?? ai.note}`,
        en: `${CN_AI_LAW_EN}. ${RULE_TEXT[ai.note]?.en ?? ai.note}`,
      },
    },
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

const RAW_RULES: Partial<Record<PlatformKey, PlatformRules>> = {
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
    { finance: true, noContact: true, noQrcode: true, title: { min: 1, max: 64 } },
    { note: CN_TOGGLE_UNVERIFIED },
    '东方财富 股吧管理规定 https://guba.eastmoney.com/gltl.aspx ；财富号公告 https://mp.eastmoney.com/collect/pc_writer/treaty.html ；长文页提示标题 1～64 字（2026-10-30）'
  ),
  huxiu: cn(
    { title: { min: 1, max: 60 } },
    { note: CN_TOGGLE_UNVERIFIED },
    '虎嗅 投稿须知 https://www.huxiu.com/contribute/ ；文章投稿页提示标题 1～60 字（2026-10-30）'
  ),
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
    { title: { min: 2, max: 30 } },
    { note: CN_TOGGLE_UNVERIFIED },
    '懂车帝 创作者运营规范 https://dongchedi.com/public/protocol/opsspecs ；懂车号发文页提示标题 2～30 个汉字（2026-10-30）'
  ),
  hupu: cn(
    { title: { min: 4, max: 40 } },
    { note: CN_TOGGLE_UNVERIFIED },
    '虎扑 用户协议 https://www.hupu.com/policies/terms ；发帖页提示标题 4～40 字（2026-10-30）'
  ),
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
  mafengwo: cn(
    {},
    { note: CN_TOGGLE_UNVERIFIED },
    '马蜂窝 游记发布（写游记要先选「新版游记」，2026-10-30）'
  ),
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
  'xiaohongshu-article': cn(
    {
      title: { max: 64 },
      body: { max: 10000 },
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
  'weibo-article': cn(
    { title: { max: 32 }, summary: { max: 44 } },
    {
      method: 'platform-toggle',
      note: '微博公告：AI 生成合成内容在发布时「选择内容声明 → 内容由 AI 生成」；另设「未添加 AI 标识」投诉类别。',
    },
    '微博社区公约；微博关于 AI 生成内容标识的公告（2025-09）'
  ),
  toutiao: cn(
    { title: { min: 2, max: 30 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '今日头条 头条号创作规范；发文页提示标题 2～30 字（2026-10-30）'
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
    { title: { min: 5, max: 72 }, noContact: true, noQrcode: true },
    { note: CN_TOGGLE_UNVERIFIED },
    '搜狐号内容规范'
  ),
  'qq-om': cn(
    { title: { min: 5, max: 64 }, noContact: true, noQrcode: true },
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
    { title: { max: 50 }, tags: { max: 10, format: 'plain' }, noContact: true, noQrcode: true },
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
  'douyin-article': cn(
    {
      title: { max: 30 },
      summary: { max: 30 },
      body: { max: 8000 },
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
  // SPEC-r14 A1: 海外服务器代发（官方接口）
  convertkit: intl(
    {
      payout: {
        mainland: 'no',
        note: '付费 Newsletter 走 Stripe，大陆个人不能直接收款；港、新账户可以',
      },
    },
    INTL_NO_RULE,
    'Kit Acceptable Use Policy；developers.kit.com（broadcasts）'
  ),
  beehiiv: intl(
    {
      payout: {
        mainland: 'no',
        note: '付费订阅走 Stripe，大陆个人不能直接收款；广告网络收款条件未核实 ⚠️',
      },
    },
    INTL_NO_RULE,
    'beehiiv Terms of Use；developers.beehiiv.com（Posts API 限 Pro / Enterprise 档位）'
  ),
  buttondown: intl(
    { payout: { mainland: 'no', note: '付费订阅走 Stripe，大陆个人不能直接收款；港、新账户可以' } },
    INTL_NO_RULE,
    'Buttondown Terms of Service；docs.buttondown.com'
  ),
  hatena: intl(
    {
      payout: {
        mainland: 'unknown',
        note: '收入来自 AdSense / 联盟（もしもアフィリエイト等），按各自的收款规则 ⚠️',
      },
    },
    INTL_NO_RULE,
    'はてなブログ 利用規約；developer.hatena.ne.jp（AtomPub）'
  ),
  // Qiita：标签 1–5 个（✅ help.qiita.com/ja/articles/qiita-tag「最大5個」），没有作者收入
  qiita: intl(
    { tags: { max: 5, min: 1, format: 'plain' } },
    INTL_NO_RULE,
    'Qiita 利用規約 / コミュニティガイドライン；qiita.com/api/v2/docs'
  ),
  // Zenn：标题 ≤ 70、topics ≤ 5（✅ zenn-editor 的校验 zenn-model/src/utils.ts）
  zenn: intl(
    {
      title: { max: 70 },
      tags: { max: 5, format: 'plain' },
      payout: {
        mainland: 'unknown',
        note: '打赏 / 付费本的收益提到金融机构账户或换亚马逊礼品卡；是否接受海外账户官方未写明 ⚠️',
      },
    },
    INTL_NO_RULE,
    'Zenn 利用規約；zenn.dev/zenn/articles/zenn-cli-guide'
  ),
  // Telegraph：标题 1–256，正文 ≤ 64 KB（✅ telegra.ph/api），没有作者收入
  telegraph: intl({ title: { max: 256 } }, INTL_NO_RULE, 'telegra.ph/api'),
  // SPEC-r14 A2: 海外通用模式；AI 规则没有找到专门条款的按 INTL_NO_RULE
  note: intl(
    { payout: { mainland: 'no', note: '收益只能提到日本国内的本人账户 ⚠️' } },
    INTL_NO_RULE,
    'note 利用規約 / ヘルプ（2026-10，research/r13/global-asia.md）'
  ),
  kakuyomu: intl(
    { payout: { mainland: 'unknown', note: '广告分成换成 BOOK☆WALKER 币或亚马逊礼品卡 ⚠️' } },
    INTL_NO_RULE,
    'カクヨム リワードプログラム（research/r13/global-asia.md）'
  ),
  'naver-blog': intl(
    { payout: { mainland: 'unknown', note: '애드포스트 需要实名认证的 Naver 账号 ⚠️' } },
    INTL_NO_RULE,
    'Naver 애드포스트（research/r13/global-asia.md）'
  ),
  tistory: intl(
    { payout: { mainland: 'unknown', note: 'AdSense 按 Google 的规则；AdFit 未核实 ⚠️' } },
    INTL_NO_RULE,
    'Tistory 공지：Open API 2024-02 종료（research/r13/global-asia.md）'
  ),
  brunch: intl(
    { payout: { mainland: 'unknown', note: '응원하기 很可能需要韩国本人认证 ⚠️' } },
    INTL_NO_RULE,
    '브런치스토리 응원하기（research/r13/global-asia.md）'
  ),
  postype: intl(
    { payout: { mainland: 'unknown', note: '付费内容的提现条件未核实 ⚠️' } },
    INTL_NO_RULE,
    '포스타입（research/r13/global-asia.md）'
  ),
  vocus: intl(
    { payout: { mainland: 'yes', note: '境外作者经 PayPal 收款；单次超过 NT$5,000 代扣 20%' } },
    INTL_NO_RULE,
    '方格子 vocus 收益說明（research/r13/global-asia.md）'
  ),
  webnovel: intl(
    { exclusive: true, payout: { mainland: 'yes', note: '合同独家且永久；收款方式官方未写明 ⚠️' } },
    INTL_NO_RULE,
    'Webnovel Contract（research/r13/global-en.md）'
  ),
  wattpad: intl(
    { payout: { mainland: 'unknown', note: 'Paid Stories 需受邀，收款条件未核实 ⚠️' } },
    INTL_NO_RULE,
    'Wattpad Paid Stories（research/r13/global-world.md）'
  ),
  steady: intl(
    { payout: { mainland: 'unknown', note: '只经 PayPal 打款，满 €30；国家限制未写明 ⚠️' } },
    INTL_NO_RULE,
    'Steady AGB（research/r13/global-world.md）'
  ),
  kofi: intl(
    { payout: { mainland: 'unknown', note: '走 PayPal 时取决于 PayPal 中国账户能否收款 ⚠️' } },
    INTL_NO_RULE,
    'Ko-fi Help（research/r13/global-en.md）'
  ),
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

export const PLATFORM_RULES: Partial<Record<PlatformKey, PlatformRules>> = Object.fromEntries(
  Object.entries(RAW_RULES).map(([k, r]) => [k, withNotes(r!)])
);

/**
 * The rules of a platform, or `undefined` for an unknown key. With `lang` (SPEC-r14 B5), `aiLabel.note` and
 * `payout.note` are in that language.
 */
export function platformRules(key: string, lang?: string | null): PlatformRules | undefined {
  const rules = (PLATFORM_RULES as Record<string, PlatformRules | undefined>)[key];
  if (!rules || !lang || normalizeLang(lang) === 'zh-CN') return rules;
  return {
    ...rules,
    aiLabel: { ...rules.aiLabel, note: aiLabelNote(rules.aiLabel, lang) },
    ...(rules.payout ? { payout: { ...rules.payout, note: payoutNote(rules.payout, lang) } } : {}),
  };
}
