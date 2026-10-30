/**
 * Platform registry (SPEC-r8 §2, §5): the single source of platform keys, names, colours, regions,
 * content kinds, runtimes, binding and monetization for the web app, the desktop app and — through
 * `dist/platforms.json` — the API. Plain data: no adapter code, safe for the browser.
 *
 * `runtimes` is the recommended way per runtime, best first; it is what `planRuntime` reads when no
 * adapter is registered yet. Facts marked ⚠️ in SPEC-r8 are best guesses until verified with real
 * accounts.
 */
import { PLATFORM_DOMAINS } from './domains';
import { normalizeLang } from './i18n/lang';
import { PLATFORM_LABELS } from './i18n/labels';
import { MEDIA_LIMITS } from './media';
import { PLATFORM_RULES } from './rules';

import type { CredentialKind, CredentialStore } from './binding';
import type { PlatformDomains } from './domains';
import type { I18nText } from './i18n/lang';
import type { MediaLimits } from './media';
import type { PlatformRules } from './rules';
import type { ContentKind } from './content';
import type { HandoffVia, RuntimeNeed, RuntimeSupport } from './runtime';
import type { Runtime } from './types';

export type PlatformKey =
  // 国内
  | 'chenji'
  | 'wechat'
  | 'zhihu'
  | 'juejin'
  | 'csdn'
  | 'xiaohongshu'
  | 'xiaohongshu-article'
  | 'yuque'
  | 'weibo'
  | 'weibo-article'
  | 'toutiao'
  | 'baijiahao'
  | 'netease'
  | 'sohu'
  | 'qq-om'
  | 'dayu'
  | 'yidian'
  | 'bilibili'
  | 'douyin'
  | 'douyin-article'
  | 'kuaishou'
  | 'wechat-channels'
  | 'jianshu'
  | 'smzdm'
  | 'cnblogs'
  | 'segmentfault'
  | 'oschina'
  | 'tencent-cloud'
  | '51cto'
  // 国内垂类（SPEC-r13 §6，桌面端发布台）
  | 'xueqiu'
  | 'eastmoney'
  | 'huxiu'
  | 'woshipm'
  | 'sspai'
  | 'zsxq'
  | 'dongchedi'
  | 'hupu'
  | 'douban'
  | 'douban-read'
  | 'mafengwo'
  // 海外
  | 'github-pages'
  | 'medium'
  | 'substack'
  | 'ghost'
  | 'wordpress'
  | 'wordpress-com'
  | 'devto'
  | 'hashnode'
  | 'blogger'
  | 'linkedin'
  | 'x'
  | 'facebook'
  | 'threads'
  | 'reddit'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'quora'
  | 'vocal'
  | 'newsbreak'
  | 'patreon'
  | 'buymeacoffee'
  | 'pinterest'
  | 'youtube'
  | 'instagram'
  | 'bluesky'
  | 'mastodon'
  | 'tumblr'
  // 海外：官方接口，服务器代发（SPEC-r14 A1）
  | 'convertkit'
  | 'beehiiv'
  | 'buttondown'
  | 'hatena'
  | 'qiita'
  | 'zenn'
  | 'telegraph'
  // 海外：桌面端发布台通用模式（SPEC-r14 A2）
  | 'note'
  | 'kakuyomu'
  | 'naver-blog'
  | 'tistory'
  | 'brunch'
  | 'postype'
  | 'vocus'
  | 'webnovel'
  | 'wattpad'
  | 'steady'
  | 'kofi';

export type PlatformRegion = 'cn' | 'global';

/** SPEC-r14 A4: a platform's main reader language. */
export type PlatformLang =
  'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'de' | 'fr' | 'es' | 'pt' | 'ru' | '*';
export const PLATFORM_LANGS: Partial<Record<PlatformKey, PlatformLang[]>> = {
  note: ['ja'],
  kakuyomu: ['ja'],
  'naver-blog': ['ko'],
  tistory: ['ko'],
  brunch: ['ko'],
  postype: ['ko'],
  vocus: ['zh-TW'],
  webnovel: ['en'],
  wattpad: ['*'],
  steady: ['de', 'en'],
  kofi: ['*'],
  // SPEC-r14 A1
  convertkit: ['en'],
  beehiiv: ['en'],
  buttondown: ['en'],
  hatena: ['ja'],
  qiita: ['ja'],
  zenn: ['ja'],
  telegraph: ['*'],
};

/** How an author earns there (display only). */
export type MonetizationModel =
  /** 广告 / 流量分成 */
  | 'ad-share'
  /** 创作激励、创作基金 */
  | 'creator-fund'
  /** 按会员阅读分成（Medium Partner Program、Vocal+） */
  | 'membership-share'
  /** 读者付费订阅 */
  | 'subscription'
  /** 付费专栏 / 付费内容 */
  | 'paid-content'
  | 'tips'
  /** 商单（星图、花火、蒲公英…） */
  | 'brand-deals'
  /** 带货 / CPS */
  | 'affiliate'
  /** 稿费 / 按篇付费（人人都是产品经理、少数派…） */
  | 'contributor-fee';

/** Delivery phase in SPEC-r8 §14 (P0 SDK … P7 video); absent = backlog. */
export type PlatformPhase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';

/**
 * How far the platform's adapter is: `implemented` = 已实现（待接线）: the adapter package exists and is
 * tested, but the web app / API do not use it yet; `live` = wired and usable. Absent = not built.
 */
export type PlatformStage = 'implemented' | 'live';

export interface PlatformMeta {
  key: PlatformKey;
  /** The platform's own name, in its original language (知乎, はてなブログ, Medium). */
  label: string;
  /**
   * SPEC-r14 B5: the name in the SDK's languages where it differs from `label` (English / romanized names of the
   * Chinese platforms, 繁體 forms); see `platformLabel(key, lang)`.
   */
  labels?: I18nText;
  /** One-glyph badge. */
  short: string;
  /** Brand colour. */
  color: string;
  region: PlatformRegion;
  /** Creator entry / sign-up page. */
  homepage: string;
  contentTypes: ContentKind[];
  runtimes: RuntimeSupport[];
  binding: {
    kind: CredentialKind;
    store: CredentialStore;
    provider?: string;
    /** Fields the user fills in when binding. */
    fields?: string[];
    /** Where the credential is created. */
    createUrl?: string;
    /** Other ways to bind the same platform (e.g. WordPress.com OAuth next to a self-hosted password). */
    alternatives?: Array<{
      kind: CredentialKind;
      store: CredentialStore;
      provider?: string;
      fields?: string[];
      /** false: declared only, no implementation yet. */
      implemented?: boolean;
      note?: string;
    }>;
  };
  /** Empty: no direct income (influence / traffic only). */
  monetization: MonetizationModel[];
  phase?: PlatformPhase;
  /** 已实现（待接线）/ 已上线; see `PlatformStage`. */
  stage?: PlatformStage;
  /**
   * Read mostly on phones (公众号、小红书、知乎、头条号…): the converters size images to the screen width and keep
   * tables readable there (`convert({ mobile })`, `mobileHtml`), and the preview shows a 375px phone.
   */
  mobileFirst: boolean;
  /**
   * `false`: the platform's editor drops horizontally scrolling containers (公众号), so a wide table (more than 4
   * columns) becomes one card per row instead of a scrolling table. Default true.
   */
  scrollContainers?: boolean;
  /**
   * How `mobileHtml` sizes images on a mobile-first platform. `fit` (default): `max-width:100%; height:auto` — a
   * picture narrower than the column keeps its own size. `fill`: `width:100%; height:auto` — the 公众号 editor
   * stretches wide pictures to the column anyway, so the export matches what it will show.
   */
  imageWidth?: 'fit' | 'fill';
  /** 平台规则与合规 (CONTRACTS-r9 §5): limits, 导流, 广告法, AI label; see `rules.ts`. */
  rules?: PlatformRules;
  /** SPEC-r12 §3: what the platform accepts for covers, images and videos (`checkMedia`); see `media.ts`. */
  limits?: { media?: MediaLimits };
  /**
   * SPEC-r12 §2: the link back to the article can go into the author's first comment instead of the post (the
   * platform form's `linkPlacement`). Absent: the platform has no such option.
   */
  linkPlacement?: { supported: true; default: LinkPlacement };
  /** SPEC-r13 §1: 综合平台 or the domains it is good for (`domains.ts`), for recommendations and the guides. */
  domains: PlatformDomains;
  /** SPEC-r14 A4: the readers' languages (`*` = any); absent = not labelled yet. */
  langs?: PlatformLang[];
}

/** Where the link back to the article goes (SPEC-r12 §2). */
export type LinkPlacement = 'body' | 'first_comment';

/**
 * SPEC-r12 §2.1: platforms that can post the link as the author's first comment, and the default. LinkedIn is said to
 * show posts with outbound links less ⚠️ (not documented by the platforms), so it defaults to the comment.
 */
export const LINK_PLACEMENT: Partial<Record<PlatformKey, LinkPlacement>> = {
  linkedin: 'first_comment',
  threads: 'body',
  bluesky: 'body',
  mastodon: 'body',
  facebook: 'body',
};

export { localizedLabel, PLATFORM_LABELS } from './i18n/labels';

/**
 * A platform's name in `lang` (default `zh-CN`): `labels[lang]`, else the original `label`; `fallback` (else the key)
 * for keys outside the registry. `platformLabel('wechat', 'en')` → `WeChat Official Account`.
 */
export function platformLabel(key: string, lang?: string | null, fallback?: string): string {
  const meta = BY_KEY.get(key);
  const base = meta?.label ?? fallback ?? key;
  if (!lang) return base;
  return PLATFORM_LABELS[key as PlatformKey]?.[normalizeLang(lang)] ?? base;
}

/** SPEC-r14 B5: the registry's runtime notes (`RuntimeSupport.note`, the 简体 source) in the other languages. */
const RUNTIME_NOTES: Record<string, I18nText> = {
  '经辰记服务器代发（凭据只在服务器）': {
    'zh-TW': '經辰記伺服器代發（憑證只在伺服器）',
    en: 'Sent by the StarNote server (the credential stays on the server)',
  },
  '桌面端：授权后令牌加密存本机，直接调官方接口': {
    'zh-TW': '桌面版：授權後權杖加密存在本機，直接呼叫官方 API',
    en: 'Desktop app: after you authorize, the token is stored encrypted on this computer and the official API is called directly',
  },
  '网页：令牌只在当前页面内存，经辰记服务器转发（不保存）': {
    'zh-TW': '網頁：權杖只在目前頁面的記憶體中，經辰記伺服器轉發（不儲存）',
    en: 'Web: the token stays in this page’s memory only and is forwarded by the StarNote server (not stored)',
  },
  '打开「云端代发」后由服务器发布（可定时）': {
    'zh-TW': '開啟「雲端代發」後由伺服器發布（可排程）',
    en: 'With Cloud relay on, the server publishes it (can be scheduled)',
  },
  到点由服务器代发: {
    'zh-TW': '到時由伺服器代發',
    en: 'The server sends it at the scheduled time',
  },
  '登录公众号后台，在编辑器里粘贴': {
    'zh-TW': '登入公眾號後台，在編輯器裡貼上',
    en: 'Log in to the Official Account admin and paste into the editor',
  },
  '手机上保存图片集，打开小红书发布': {
    'zh-TW': '在手機上儲存圖片集，開啟小紅書發布',
    en: 'Save the image set on your phone, then open Xiaohongshu to post',
  },
  在手机上拉起抖音发布器确认发布: {
    'zh-TW': '在手機上開啟抖音發布器確認發布',
    en: 'Open the Douyin composer on your phone and confirm',
  },
  '仅限已有 integration token 的老用户': {
    'zh-TW': '僅限已有 integration token 的舊使用者',
    en: 'Only for existing users who already have an integration token',
  },
  '自动填写 Import story': {
    'zh-TW': '自動填寫 Import story',
    en: 'Fills in Import story automatically',
  },
  '先发到辰记或 GitHub Pages，再用 Import story 导入': {
    'zh-TW': '先發到辰記或 GitHub Pages，再用 Import story 匯入',
    en: 'Publish to StarNote or GitHub Pages first, then import it with Import story',
  },
  '复制文案，到 Discord 频道粘贴': {
    'zh-TW': '複製文案，到 Discord 頻道貼上',
    en: 'Copy the text and paste it into a Discord channel',
  },
  '复制文案，到 Slack 频道粘贴': {
    'zh-TW': '複製文案，到 Slack 頻道貼上',
    en: 'Copy the text and paste it into a Slack channel',
  },
  '手机：系统分享面板选 Instagram，在 App 里完成发布': {
    'zh-TW': '手機：在系統分享選單選 Instagram，在 App 裡完成發布',
    en: 'Phone: pick Instagram in the share sheet and finish in the app',
  },
  '网页：令牌只在当前页面内存，网页直接调 PDS': {
    'zh-TW': '網頁：權杖只在目前頁面的記憶體中，網頁直接呼叫 PDS',
    en: 'Web: the token stays in this page’s memory only; the page calls the PDS directly',
  },
};

/** The registry notes still untranslated (tests: must be empty). */
export function untranslatedRuntimeNotes(): string[] {
  const out = new Set<string>();
  for (const p of ENTRIES)
    for (const r of p.runtimes) if (r.note && !RUNTIME_NOTES[r.note]) out.add(r.note);
  return [...out];
}

/** A registry entry as written below; `mobileFirst` defaults to false. */
type PlatformEntry = Omit<PlatformMeta, 'mobileFirst' | 'domains'> & { mobileFirst?: boolean };

/* ---- shorthands ---- */

const api = (runtime: Runtime, extra: Partial<RuntimeSupport> = {}): RuntimeSupport => ({
  runtime,
  mode: 'api',
  ...(runtime === 'server' ? { schedulable: true } : {}),
  ...extra,
});
const desktop = (extra: Partial<RuntimeSupport> = {}): RuntimeSupport => ({
  runtime: 'electron',
  mode: 'automation',
  needs: ['session'],
  ...extra,
});
const handoff = (
  via: HandoffVia,
  url?: string,
  extra: Partial<RuntimeSupport> = {}
): RuntimeSupport => ({
  runtime: 'web',
  mode: 'handoff',
  handoff: url ? { via, url } : { via },
  ...extra,
});
const manual = (): RuntimeSupport => ({ runtime: 'web', mode: 'manual' });
/** Rendered in the browser / desktop, sent by 辰记's API with the stored credential (服务器代发). */
const relay = (runtime: 'web' | 'electron'): RuntimeSupport => ({
  runtime,
  mode: 'api',
  needs: ['token'],
  note: '经辰记服务器代发（凭据只在服务器）',
});
const RELAY: RuntimeSupport[] = [relay('web'), relay('electron')];
const needs = (...n: RuntimeNeed[]) => ({ needs: n });
/**
 * Official API with the user's own authorization (OAuth / Bluesky App Password): the desktop keeps the token on
 * the machine and calls the platform itself; the browser keeps it in page memory only and 辰记's API forwards the
 * request without storing it; with 「云端代发」 on, the server keeps an encrypted copy and can publish on schedule.
 */
const OWN_API: RuntimeSupport[] = [
  {
    runtime: 'electron',
    mode: 'api',
    needs: ['token'],
    note: '桌面端：授权后令牌加密存本机，直接调官方接口',
  },
  {
    runtime: 'web',
    mode: 'api',
    needs: ['token'],
    note: '网页：令牌只在当前页面内存，经辰记服务器转发（不保存）',
  },
  {
    runtime: 'server',
    mode: 'api',
    needs: ['token'],
    schedulable: true,
    note: '打开「云端代发」后由服务器发布（可定时）',
  },
];
const OAUTH_LOCAL = (provider: string) => ({ kind: 'oauth', store: 'desktop', provider }) as const;
/**
 * SPEC-r11 §10 token platforms (Telegram bot, Discord / Slack webhook): bound with `POST /me/platform-accounts/{p}/connect`,
 * the credential is kept on the server; the browser / desktop renders, the server sends (also at a scheduled time).
 */
const TOKEN_API: RuntimeSupport[] = [
  relay('web'),
  relay('electron'),
  { runtime: 'server', mode: 'api', needs: ['token'], schedulable: true, note: '到点由服务器代发' },
];
/** SPEC-r11 §10 Meta / LinkedIn / Pinterest OAuth: `OWN_API` behind an app review where the platform asks for one. */
const OWN_API_REVIEW: RuntimeSupport[] = OWN_API.map((r) => ({
  ...r,
  needs: ['token', 'app-review'] as RuntimeNeed[],
}));
const SHORT_OR_ARTICLE: ContentKind[] = ['short-text', 'article'];

const COOKIE = { kind: 'cookie', store: 'desktop' } as const;
const OAUTH = { kind: 'oauth', store: 'server' } as const;
const TOKEN = { kind: 'token', store: 'server' } as const;
const NONE = { kind: 'none', store: 'none' } as const;

const ARTICLE: ContentKind[] = ['article'];
const SHORT: ContentKind[] = ['short-text'];

/** SPEC-r14 A2: overseas platforms without a personal publishing API — the desktop 发布台, 通用模式. */
function globalDesktop(
  key: PlatformKey,
  label: string,
  short: string,
  color: string,
  homepage: string,
  monetization: MonetizationModel[],
  phase?: PlatformPhase
): PlatformEntry {
  return {
    ...cnDesktop(key, label, short, color, homepage, monetization, phase),
    region: 'global',
  };
}

/** Desktop-only HTML 图文 platforms (头条号 / 百家号 / 网易号 …). */
function cnDesktop(
  key: PlatformKey,
  label: string,
  short: string,
  color: string,
  homepage: string,
  monetization: MonetizationModel[],
  phase?: PlatformPhase
): PlatformEntry {
  return {
    key,
    label,
    short,
    color,
    region: 'cn',
    homepage,
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization,
    ...(phase ? { phase } : {}),
  };
}

const ENTRIES: readonly PlatformEntry[] = [
  /* ---------------- 国内 ---------------- */
  {
    key: 'chenji',
    label: '辰记',
    short: '辰',
    color: '#6918b4',
    region: 'cn',
    homepage: 'https://starnote.app/',
    contentTypes: ARTICLE,
    // SPEC-r8 §3.9: the adapter runs in the browser, the desktop renderer (same page) and on the server.
    runtimes: [api('web'), api('electron'), api('server')],
    binding: { kind: 'session', store: 'none' },
    monetization: ['ad-share', 'tips'],
    phase: 'P0',
  },
  {
    key: 'wechat',
    label: '微信公众号',
    short: '微',
    color: '#07c160',
    region: 'cn',
    mobileFirst: true,
    // the 公众号 editor strips overflow containers: wide tables become cards
    scrollContainers: false,
    // and it stretches pictures to the column width: export them that way so the preview matches
    imageWidth: 'fill',
    homepage: 'https://mp.weixin.qq.com/',
    contentTypes: ARTICLE,
    runtimes: [
      api('server', needs('fixed-ip')),
      desktop({ note: '登录公众号后台，在编辑器里粘贴' }),
    ],
    binding: { kind: 'app-secret', store: 'server' },
    monetization: ['ad-share', 'tips', 'brand-deals'],
    phase: 'P2',
  },
  {
    key: 'zhihu',
    label: '知乎',
    short: '知',
    color: '#0084ff',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://www.zhihu.com/creator',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['paid-content', 'affiliate', 'tips', 'brand-deals'],
    phase: 'P3',
  },
  {
    key: 'juejin',
    label: '掘金',
    short: '掘',
    color: '#1e80ff',
    region: 'cn',
    homepage: 'https://juejin.cn/creator/home',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: [],
    phase: 'P3',
  },
  {
    key: 'csdn',
    label: 'CSDN',
    short: 'C',
    color: '#fc5531',
    region: 'cn',
    homepage: 'https://mp.csdn.net/',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['creator-fund', 'paid-content'],
    phase: 'P3',
  },
  {
    key: 'xiaohongshu',
    label: '小红书',
    short: '红',
    color: '#ff2442',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://creator.xiaohongshu.com/',
    contentTypes: ['image-set', 'video'],
    runtimes: [
      desktop(),
      handoff('web-share', undefined, { note: '手机上保存图片集，打开小红书发布' }),
    ],
    binding: COOKIE,
    monetization: ['brand-deals', 'affiliate'],
    phase: 'P6',
  },
  {
    // 长文笔记是另一个编辑器、另一套规则（标题 64 字、正文 1 万字），单独作为发布对象（桌面端发布台）
    key: 'xiaohongshu-article',
    label: '小红书长文',
    short: '红',
    color: '#ff2442',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['brand-deals', 'affiliate'],
    phase: 'P4',
  },
  {
    key: 'yuque',
    label: '语雀',
    short: '雀',
    color: '#31cc79',
    region: 'cn',
    homepage: 'https://www.yuque.com/',
    contentTypes: ARTICLE,
    runtimes: [api('server', needs('token', 'premium')), api('electron', needs('token'))],
    binding: TOKEN,
    monetization: [],
    phase: 'P3',
  },
  {
    key: 'weibo',
    label: '微博',
    short: '博',
    color: '#e6162d',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://weibo.com/',
    contentTypes: ['short-text'],
    runtimes: [
      api('server', needs('token', 'app-review')),
      handoff('share-intent', 'https://service.weibo.com/share/share.php'),
    ],
    binding: OAUTH,
    monetization: ['ad-share', 'brand-deals'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    // 头条文章：登录态 + 桌面端发布台（微博短文走开放平台，见上）
    key: 'weibo-article',
    label: '微博头条文章',
    short: '博',
    color: '#e6162d',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://card.weibo.com/article/v5/editor',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['ad-share', 'brand-deals'],
    phase: 'P4',
  },
  {
    ...cnDesktop(
      'toutiao',
      '头条号',
      '头',
      '#f04142',
      'https://mp.toutiao.com/',
      ['ad-share', 'creator-fund', 'paid-content'],
      'P4'
    ),
    contentTypes: ['article', 'short-text'],
    mobileFirst: true,
  },
  {
    ...cnDesktop(
      'baijiahao',
      '百家号',
      '百',
      '#2932e1',
      'https://baijiahao.baidu.com/',
      ['ad-share', 'creator-fund', 'paid-content'],
      'P4'
    ),
    mobileFirst: true,
  },
  {
    ...cnDesktop('netease', '网易号', '网', '#e60026', 'https://mp.163.com/', ['ad-share']),
    mobileFirst: true,
  },
  {
    ...cnDesktop('sohu', '搜狐号', '搜', '#fdd000', 'https://mp.sohu.com/', [
      'ad-share',
      'creator-fund',
    ]),
    mobileFirst: true,
  },
  {
    ...cnDesktop('qq-om', '企鹅号', '企', '#0052d9', 'https://om.qq.com/', ['ad-share']),
    mobileFirst: true,
  },
  {
    ...cnDesktop('dayu', '大鱼号', '鱼', '#ff6a00', 'https://mp.dayu.com/', ['ad-share']),
    mobileFirst: true,
  },
  {
    ...cnDesktop('yidian', '一点号', '点', '#e63633', 'https://mp.yidianzixun.com/', ['ad-share']),
    mobileFirst: true,
  },
  {
    key: 'bilibili',
    label: 'B 站',
    short: 'B',
    color: '#fb7299',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://member.bilibili.com/',
    contentTypes: ['article', 'image-set', 'video'],
    // Official open platform only (no "wild" APIs, SPEC-r8 §5.1).
    runtimes: [api('server', needs('token', 'app-review')), desktop()],
    binding: OAUTH,
    monetization: ['tips', 'brand-deals', 'creator-fund'],
    phase: 'P7',
  },
  {
    key: 'douyin',
    label: '抖音',
    short: '抖',
    color: '#fe2c55',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://creator.douyin.com/',
    contentTypes: ['image-set', 'video'],
    runtimes: [
      handoff('deeplink', undefined, { note: '在手机上拉起抖音发布器确认发布' }),
      api('server', needs('token', 'app-review')),
    ],
    binding: OAUTH,
    monetization: ['creator-fund', 'affiliate', 'brand-deals'],
    phase: 'P6',
  },
  {
    // 抖音文章：创作者中心的图文长文（标题 30 字），登录态 + 桌面端发布台
    key: 'douyin-article',
    label: '抖音文章',
    short: '抖',
    color: '#fe2c55',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://creator.douyin.com/creator-micro/content/post/article',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['creator-fund', 'brand-deals'],
    phase: 'P4',
  },
  {
    key: 'kuaishou',
    label: '快手',
    short: '快',
    color: '#ff4906',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://cp.kuaishou.com/',
    contentTypes: ['video', 'image-set'],
    runtimes: [api('server', needs('token', 'app-review')), desktop()],
    binding: OAUTH,
    monetization: ['creator-fund', 'affiliate', 'brand-deals'],
    phase: 'P7',
  },
  {
    key: 'wechat-channels',
    label: '视频号',
    short: '视',
    color: '#fa9d3b',
    region: 'cn',
    mobileFirst: true,
    homepage: 'https://channels.weixin.qq.com/',
    contentTypes: ['video', 'image-set'],
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['creator-fund', 'affiliate', 'brand-deals'],
    phase: 'P7',
  },
  cnDesktop('jianshu', '简书', '简', '#ea6f5a', 'https://www.jianshu.com/', ['tips']),
  cnDesktop('smzdm', '什么值得买', '值', '#e62828', 'https://zhiyou.smzdm.com/', [
    'paid-content',
    'affiliate',
  ]),
  {
    key: 'cnblogs',
    label: '博客园',
    short: '园',
    color: '#1b6eb8',
    region: 'cn',
    homepage: 'https://www.cnblogs.com/',
    contentTypes: ARTICLE,
    // MetaWeblog with a personal access token, sent by 辰记's API (@starnote/publish-cnblogs)
    runtimes: RELAY,
    binding: TOKEN,
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  cnDesktop('segmentfault', 'SegmentFault 思否', '思', '#009a61', 'https://segmentfault.com/', [
    'creator-fund',
  ]),
  cnDesktop('oschina', '开源中国', '开', '#2e9e46', 'https://my.oschina.net/', []),
  cnDesktop(
    'tencent-cloud',
    '腾讯云开发者社区',
    '腾',
    '#0052d9',
    'https://cloud.tencent.com/developer',
    ['creator-fund']
  ),
  cnDesktop('51cto', '51CTO', '5', '#e4393c', 'https://blog.51cto.com/', ['creator-fund']),
  /* ---- 国内垂类（SPEC-r13 §6）：都没有个人可用的发布 API，桌面端发布台；品牌色是近似值，等正式 logo ---- */
  cnDesktop('xueqiu', '雪球', '雪', '#1c7df7', 'https://xueqiu.com/', ['tips'], 'P1'),
  cnDesktop(
    'eastmoney',
    '东方财富',
    '东',
    '#e1322d',
    'https://mp.eastmoney.com/',
    ['creator-fund'],
    'P1'
  ),
  cnDesktop('huxiu', '虎嗅', '嗅', '#e8541e', 'https://www.huxiu.com/contribute/', ['tips'], 'P1'),
  cnDesktop(
    'woshipm',
    '人人都是产品经理',
    '产',
    '#f7a21b',
    'https://www.woshipm.com/tougao',
    ['contributor-fee'],
    'P1'
  ),
  {
    ...cnDesktop(
      'sspai',
      '少数派',
      '少',
      '#d71a1b',
      'https://sspai.com/',
      ['contributor-fee', 'paid-content'],
      'P1'
    ),
    binding: {
      ...COOKIE,
      alternatives: [
        {
          kind: 'token',
          store: 'server',
          implemented: false,
          note: '作者 Token（sspai.com/setting/token，MWeb 等编辑器在用）；接口文档不公开，服务端接入要先向少数派要文档（SPEC-r13 服务端优先）',
        },
      ],
    },
  },
  {
    ...cnDesktop(
      'zsxq',
      '知识星球',
      '星',
      '#16b998',
      'https://wx.zsxq.com/',
      ['subscription', 'paid-content'],
      'P1'
    ),
    binding: {
      ...COOKIE,
      alternatives: [
        {
          kind: 'token',
          store: 'server',
          implemented: false,
          note: '官方 zsxq-cli / MCP（2026-04 起，beta）：用户自建 api-key，可发「标题 + Markdown」主题、定时发；写不了网页长文。第三方服务端代发是否允许待官方确认（SPEC-r13 服务端优先）',
        },
      ],
    },
  },
  cnDesktop(
    'dongchedi',
    '懂车帝',
    '懂',
    '#ffcc00',
    'https://mp.dcdapp.com/',
    ['creator-fund'],
    'P2'
  ),
  cnDesktop('hupu', '虎扑', '扑', '#c60100', 'https://bbs.hupu.com/', [], 'P2'),
  cnDesktop('douban', '豆瓣', '豆', '#007722', 'https://www.douban.com/', ['tips'], 'P2'),
  cnDesktop(
    'douban-read',
    '豆瓣阅读',
    '阅',
    '#3a8c55',
    'https://read.douban.com/submit/',
    ['paid-content'],
    'P2'
  ),
  cnDesktop('mafengwo', '马蜂窝', '马', '#ffd200', 'https://www.mafengwo.cn/', [], 'P2'),

  /* ---------------- 海外 ---------------- */
  {
    key: 'github-pages',
    label: 'GitHub Pages',
    short: 'G',
    color: '#24292f',
    region: 'global',
    homepage: 'https://pages.github.com/',
    contentTypes: ARTICLE,
    // The token stays encrypted on the server, so publishing runs there; the package's `./web` entry is
    // only a temporary direct path (the browser would have to receive the token).
    runtimes: [api('server', needs('token'))],
    // The user pastes a fine-grained PAT (blog repository only); repo detection, Pages and the first
    // publish are automatic (`connect` in @starnote/publish-github-pages).
    binding: {
      kind: 'token',
      provider: 'github',
      store: 'server',
      fields: ['token'],
      createUrl: 'https://github.com/settings/personal-access-tokens/new',
    },
    monetization: ['ad-share', 'tips'],
    phase: 'P1',
  },
  {
    key: 'medium',
    label: 'Medium',
    short: 'M',
    color: '#000000',
    region: 'global',
    homepage: 'https://medium.com/',
    contentTypes: ARTICLE,
    runtimes: [
      api('server', { needs: ['token'], note: '仅限已有 integration token 的老用户' }),
      desktop({ note: '自动填写 Import story' }),
      handoff('import-url', 'https://medium.com/p/import', {
        note: '先发到辰记或 GitHub Pages，再用 Import story 导入',
      }),
    ],
    binding: TOKEN,
    monetization: ['membership-share'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'substack',
    label: 'Substack',
    short: 'S',
    color: '#ff6719',
    region: 'global',
    homepage: 'https://substack.com/',
    contentTypes: ARTICLE,
    runtimes: [desktop()],
    binding: COOKIE,
    monetization: ['subscription'],
    phase: 'P4',
  },
  {
    key: 'ghost',
    label: 'Ghost',
    short: 'G',
    color: '#15171a',
    region: 'global',
    homepage: 'https://ghost.org/',
    contentTypes: ARTICLE,
    runtimes: RELAY,
    binding: TOKEN,
    monetization: ['subscription'],
    phase: 'P4',
    stage: 'implemented',
  },
  {
    key: 'wordpress',
    label: 'WordPress',
    short: 'W',
    color: '#21759b',
    region: 'global',
    homepage: 'https://wordpress.com/',
    contentTypes: ARTICLE,
    runtimes: RELAY,
    // Self-hosted: site URL + user name + Application Password. WordPress.com OAuth is declared only.
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'wordpress',
      fields: ['site_url', 'username', 'app_password'],
      alternatives: [
        {
          kind: 'oauth',
          store: 'desktop',
          provider: 'wordpress.com',
          implemented: true,
          note: 'WordPress.com 托管站点用 OAuth，见 wordpress-com',
        },
      ],
    },
    monetization: ['ad-share', 'subscription', 'tips'],
    phase: 'P4',
    stage: 'implemented',
  },
  {
    key: 'wordpress-com',
    label: 'WordPress.com',
    short: 'W',
    color: '#21759b',
    region: 'global',
    homepage: 'https://wordpress.com/',
    contentTypes: ARTICLE,
    runtimes: OWN_API,
    binding: OAUTH_LOCAL('wordpress.com'),
    monetization: ['ad-share', 'subscription', 'tips'],
    phase: 'P4',
    stage: 'implemented',
  },
  {
    key: 'devto',
    label: 'DEV',
    short: 'D',
    color: '#0a0a0a',
    region: 'global',
    homepage: 'https://dev.to/',
    contentTypes: ARTICLE,
    runtimes: RELAY,
    binding: TOKEN,
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'hashnode',
    label: 'Hashnode',
    short: 'H',
    color: '#2962ff',
    region: 'global',
    homepage: 'https://hashnode.com/',
    contentTypes: ARTICLE,
    runtimes: RELAY,
    binding: TOKEN,
    monetization: ['tips'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'blogger',
    label: 'Blogger',
    short: 'B',
    color: '#ff5722',
    region: 'global',
    homepage: 'https://www.blogger.com/',
    contentTypes: ARTICLE,
    runtimes: OWN_API,
    // Google OAuth（blogger scope）；同意屏幕处于「测试」状态时 refresh token 7 天过期，对外开放需发布应用 ⚠️
    binding: OAUTH_LOCAL('google'),
    monetization: ['ad-share'],
    phase: 'P4',
    stage: 'implemented',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    short: 'in',
    color: '#0a66c2',
    region: 'global',
    homepage: 'https://www.linkedin.com/',
    contentTypes: SHORT_OR_ARTICLE,
    // SPEC-r11 §10：OAuth（openid profile w_member_social，Share on LinkedIn 自助开通 ⚠️）发文章卡片；没绑定时分享跳转
    runtimes: [
      ...OWN_API,
      handoff('share-intent', 'https://www.linkedin.com/sharing/share-offsite/'),
    ],
    binding: OAUTH_LOCAL('linkedin'),
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'x',
    label: 'X',
    short: 'X',
    color: '#000000',
    region: 'global',
    homepage: 'https://x.com/',
    contentTypes: SHORT,
    // API 按次计费：只做分享跳转
    runtimes: [handoff('share-intent', 'https://x.com/intent/tweet')],
    binding: NONE,
    monetization: ['ad-share', 'subscription'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    short: 'f',
    color: '#1877f2',
    region: 'global',
    homepage: 'https://www.facebook.com/',
    contentTypes: SHORT_OR_ARTICLE,
    // SPEC-r11 §10：Facebook 主页（Page）经 Graph API 发链接帖，要 Meta App Review ⚠️；个人主页没有 API，没绑定时分享跳转
    runtimes: [
      ...OWN_API_REVIEW,
      handoff('share-intent', 'https://www.facebook.com/sharer/sharer.php'),
    ],
    binding: OAUTH_LOCAL('facebook'),
    monetization: ['ad-share'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'threads',
    label: 'Threads',
    short: '@',
    color: '#000000',
    region: 'global',
    homepage: 'https://www.threads.net/',
    contentTypes: SHORT_OR_ARTICLE,
    // SPEC-r11 §10：Threads API 三段式（建容器 → 查状态 → threads_publish），对外开放需 Meta App Review ⚠️；没绑定时分享跳转
    runtimes: [...OWN_API_REVIEW, handoff('share-intent', 'https://www.threads.com/intent/post')],
    binding: OAUTH_LOCAL('threads'),
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'reddit',
    label: 'Reddit',
    short: 'R',
    color: '#ff4500',
    region: 'global',
    homepage: 'https://www.reddit.com/',
    contentTypes: ['short-text', 'article'],
    // 官方 OAuth API（链接帖 / 文字帖）；2025-11 起新应用需先申请审批 ⚠️，未获批时用分享跳转
    runtimes: [
      ...OWN_API.map((r) => ({ ...r, needs: ['token', 'app-review'] as RuntimeNeed[] })),
      handoff('share-intent', 'https://www.reddit.com/submit'),
    ],
    binding: OAUTH_LOCAL('reddit'),
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    short: 'T',
    color: '#26a5e4',
    region: 'global',
    homepage: 'https://telegram.org/',
    contentTypes: SHORT_OR_ARTICLE,
    // SPEC-r11 §10：Bot API 发到频道 / 群（bot_token + chat_id，机器人须是管理员）；没绑定时分享跳转
    runtimes: [...TOKEN_API, handoff('share-intent', 'https://t.me/share/url')],
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'telegram',
      fields: ['bot_token', 'chat_id'],
      createUrl: 'https://t.me/BotFather',
    },
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'discord',
    label: 'Discord',
    short: 'D',
    color: '#5865f2',
    region: 'global',
    homepage: 'https://discord.com/',
    contentTypes: SHORT_OR_ARTICLE,
    // SPEC-r11 §10：频道 Webhook（content + 1 个 embed）；没绑定时复制文案
    runtimes: [...TOKEN_API, { ...manual(), note: '复制文案，到 Discord 频道粘贴' }],
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'discord',
      fields: ['webhook_url'],
      createUrl: 'https://support.discord.com/hc/en-us/articles/228383668',
    },
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'slack',
    label: 'Slack',
    short: 'S',
    color: '#4a154b',
    region: 'global',
    homepage: 'https://slack.com/',
    contentTypes: SHORT_OR_ARTICLE,
    // SPEC-r11 §10：Incoming Webhook（Block Kit）；Webhook 不返回消息 id 和链接；没绑定时复制文案
    runtimes: [...TOKEN_API, { ...manual(), note: '复制文案，到 Slack 频道粘贴' }],
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'slack',
      fields: ['webhook_url'],
      createUrl: 'https://api.slack.com/messaging/webhooks',
    },
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'quora',
    label: 'Quora',
    short: 'Q',
    color: '#b92b27',
    region: 'global',
    homepage: 'https://www.quora.com/',
    contentTypes: ARTICLE,
    runtimes: [manual()],
    binding: NONE,
    monetization: ['subscription', 'ad-share'],
  },
  {
    key: 'vocal',
    label: 'Vocal',
    short: 'V',
    color: '#1d1d1b',
    region: 'global',
    homepage: 'https://vocal.media/',
    contentTypes: ARTICLE,
    runtimes: [desktop(), manual()],
    binding: COOKIE,
    monetization: ['membership-share', 'tips'],
  },
  {
    key: 'newsbreak',
    label: 'NewsBreak',
    short: 'N',
    color: '#e5242a',
    region: 'global',
    homepage: 'https://www.newsbreak.com/',
    contentTypes: ARTICLE,
    runtimes: [manual()],
    binding: NONE,
    monetization: ['creator-fund'],
  },
  {
    key: 'patreon',
    label: 'Patreon',
    short: 'P',
    color: '#ff424d',
    region: 'global',
    homepage: 'https://www.patreon.com/',
    contentTypes: ARTICLE,
    runtimes: [manual()],
    binding: NONE,
    monetization: ['subscription'],
  },
  {
    key: 'buymeacoffee',
    label: 'Buy Me a Coffee',
    short: 'B',
    color: '#ffdd00',
    region: 'global',
    homepage: 'https://www.buymeacoffee.com/',
    contentTypes: ARTICLE,
    runtimes: [manual()],
    binding: NONE,
    monetization: ['tips', 'subscription'],
  },
  {
    key: 'pinterest',
    label: 'Pinterest',
    short: 'P',
    color: '#e60023',
    region: 'global',
    homepage: 'https://www.pinterest.com/',
    contentTypes: ['article', 'short-text'],
    // SPEC-r11 §10：API v5 建 Pin（封面图 + 链接，绑定时选画板）；Trial 档建的 Pin 只有自己可见、Standard 档要审核 ⚠️；
    // 没绑定时分享跳转（带图片和链接）
    runtimes: [
      ...OWN_API_REVIEW,
      handoff('share-intent', 'https://www.pinterest.com/pin/create/button/'),
    ],
    binding: OAUTH_LOCAL('pinterest'),
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    short: 'Y',
    color: '#ff0000',
    region: 'global',
    homepage: 'https://studio.youtube.com/',
    contentTypes: ['video'],
    runtimes: [api('server', needs('token'))],
    binding: OAUTH,
    monetization: ['ad-share', 'subscription', 'tips'],
    phase: 'P7',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    short: 'I',
    color: '#e1306c',
    region: 'global',
    homepage: 'https://www.instagram.com/',
    contentTypes: ['image-set', 'article'],
    // SPEC-r11 §10：Instagram Login（仅专业账号）三段式发单图 / 轮播，要 Meta App Review ⚠️，图片须是公网 HTTPS 地址；
    // 没绑定时（也没有网页分享链接）：手机用系统分享面板交给 App，电脑下载图片 + 复制文案
    runtimes: [
      ...OWN_API_REVIEW,
      handoff('web-share', 'https://www.instagram.com/', {
        note: '手机：系统分享面板选 Instagram，在 App 里完成发布',
      }),
      manual(),
    ],
    binding: OAUTH_LOCAL('instagram'),
    monetization: ['brand-deals', 'creator-fund'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'bluesky',
    label: 'Bluesky',
    short: 'b',
    color: '#1185fe',
    region: 'global',
    homepage: 'https://bsky.app/',
    contentTypes: ['short-text', 'article'],
    // atproto OAuth（公开客户端 + DPoP）：令牌绑定在客户端私钥上，服务器不能代发，不支持云端代发
    runtimes: OWN_API.filter((r) => r.runtime !== 'server').map((r) =>
      r.runtime === 'web' ? { ...r, note: '网页：令牌只在当前页面内存，网页直接调 PDS' } : r
    ),
    binding: OAUTH_LOCAL('atproto'),
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'mastodon',
    label: 'Mastodon',
    short: 'm',
    color: '#6364ff',
    region: 'global',
    homepage: 'https://joinmastodon.org/',
    contentTypes: ['short-text', 'article'],
    // 每个实例动态注册应用（POST /api/v1/apps），用户只填实例地址
    runtimes: OWN_API,
    binding: OAUTH_LOCAL('mastodon'),
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'tumblr',
    label: 'Tumblr',
    short: 't',
    color: '#001935',
    region: 'global',
    homepage: 'https://www.tumblr.com/',
    contentTypes: ['article', 'short-text'],
    runtimes: OWN_API,
    binding: OAUTH_LOCAL('tumblr'),
    monetization: ['tips'],
    phase: 'P2',
    stage: 'implemented',
  },
  /* ---- 海外：官方接口，服务器代发（SPEC-r14 A1）；凭据存服务器，网页 / 桌面渲染、服务器发送，可定时 ---- */
  {
    key: 'convertkit',
    label: 'Kit',
    short: 'K',
    color: '#48b8f8',
    region: 'global',
    homepage: 'https://kit.com/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    // Kit v4 API key（X-Kit-Api-Key，✅ developers.kit.com/api-reference/authentication）；建 broadcast，默认存草稿
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'convertkit',
      fields: ['api_key'],
      createUrl: 'https://app.kit.com/account_settings/developer_settings',
    },
    monetization: ['subscription'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'beehiiv',
    label: 'beehiiv',
    short: 'b',
    color: '#7a4fdc',
    region: 'global',
    homepage: 'https://www.beehiiv.com/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    // Posts API 只对 Pro / Enterprise 档位开放（developers.beehiiv.com，2026-10）
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'beehiiv',
      fields: ['api_key', 'publication_id'],
      // ⚠️ Settings → Integrations → API（第三方集成文档的说法，官方指南页未能读取）
      createUrl: 'https://app.beehiiv.com/settings/integrations',
    },
    monetization: ['subscription', 'ad-share'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'buttondown',
    label: 'Buttondown',
    short: 'B',
    color: '#0069ff',
    region: 'global',
    homepage: 'https://buttondown.com/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'buttondown',
      fields: ['api_key'],
      // ✅ docs.buttondown.com/api-introduction：API key 在 API requests 页
      createUrl: 'https://buttondown.com/requests',
    },
    monetization: ['subscription'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'hatena',
    label: 'はてなブログ',
    short: 'は',
    color: '#3d3f44',
    region: 'global',
    homepage: 'https://hatenablog.com/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    // AtomPub：Hatena ID + ブログ ID + API キー（ブログの詳細設定 → AtomPub）
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'hatena',
      fields: ['hatena_id', 'blog_id', 'api_key'],
    },
    monetization: ['ad-share', 'affiliate'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'qiita',
    label: 'Qiita',
    short: 'Q',
    color: '#55c500',
    region: 'global',
    homepage: 'https://qiita.com/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'qiita',
      fields: ['token'],
      createUrl: 'https://qiita.com/settings/applications',
    },
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'zenn',
    label: 'Zenn',
    short: 'Z',
    color: '#3ea8ff',
    region: 'global',
    homepage: 'https://zenn.dev/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    // GitHub 仓库同步：复用 GitHub 令牌（同 GitHub Pages），选 Zenn 连携的仓库
    binding: {
      kind: 'token',
      store: 'server',
      provider: 'github',
      fields: ['zenn_username', 'repo', 'token'],
      // ⚠️ Zenn 后台「デプロイ管理」的地址按经验填写
      createUrl: 'https://zenn.dev/dashboard/deploys',
    },
    monetization: ['tips', 'paid-content'],
    phase: 'P2',
    stage: 'implemented',
  },
  {
    key: 'telegraph',
    label: 'Telegraph',
    short: 'T',
    color: '#333333',
    region: 'global',
    homepage: 'https://telegra.ph/',
    contentTypes: ARTICLE,
    runtimes: TOKEN_API,
    // createAccount 自动建号，access_token 存服务器；用户只可选填作者名
    binding: { kind: 'token', store: 'server', provider: 'telegraph', fields: ['author_name'] },
    monetization: [],
    phase: 'P2',
    stage: 'implemented',
  },
  /* ---- 海外：桌面端发布台通用模式（SPEC-r14 A2）；品牌色是近似值 ---- */
  globalDesktop(
    'note',
    'note',
    'n',
    '#41c9b4',
    'https://note.com/',
    ['paid-content', 'subscription', 'tips'],
    'P2'
  ),
  globalDesktop(
    'kakuyomu',
    'カクヨム',
    'カ',
    '#4baae0',
    'https://kakuyomu.jp/',
    ['ad-share'],
    'P2'
  ),
  globalDesktop(
    'naver-blog',
    'Naver 블로그',
    'N',
    '#03c75a',
    'https://blog.naver.com/',
    ['ad-share'],
    'P2'
  ),
  globalDesktop(
    'tistory',
    'Tistory',
    'T',
    '#eb531f',
    'https://www.tistory.com/',
    ['ad-share'],
    'P2'
  ),
  globalDesktop('brunch', '브런치스토리', 'b', '#00c3bd', 'https://brunch.co.kr/', ['tips'], 'P2'),
  globalDesktop(
    'postype',
    '포스타입',
    'P',
    '#f0525c',
    'https://www.postype.com/',
    ['paid-content', 'subscription'],
    'P2'
  ),
  globalDesktop(
    'vocus',
    '方格子 vocus',
    '方',
    '#ff6c2c',
    'https://vocus.cc/',
    ['paid-content', 'subscription', 'tips'],
    'P2'
  ),
  globalDesktop(
    'webnovel',
    'Webnovel',
    'W',
    '#4c5fe2',
    'https://www.webnovel.com/',
    ['paid-content', 'creator-fund'],
    'P2'
  ),
  globalDesktop(
    'wattpad',
    'Wattpad',
    'W',
    '#ff500a',
    'https://www.wattpad.com/',
    ['paid-content'],
    'P2'
  ),
  globalDesktop(
    'steady',
    'Steady',
    'S',
    '#291e38',
    'https://steadyhq.com/',
    ['subscription'],
    'P2'
  ),
  globalDesktop(
    'kofi',
    'Ko-fi',
    'K',
    '#13c3ff',
    'https://ko-fi.com/',
    ['tips', 'subscription'],
    'P2'
  ),
];

export const PLATFORMS: readonly PlatformMeta[] = ENTRIES.map((p) => ({
  ...p,
  ...(PLATFORM_LABELS[p.key] ? { labels: PLATFORM_LABELS[p.key] } : {}),
  runtimes: p.runtimes.map((r) =>
    r.note && RUNTIME_NOTES[r.note] ? { ...r, notes: RUNTIME_NOTES[r.note] } : r
  ),
  mobileFirst: p.mobileFirst ?? false,
  domains: PLATFORM_DOMAINS[p.key],
  ...(PLATFORM_LANGS[p.key] ? { langs: PLATFORM_LANGS[p.key] } : {}),
  ...(PLATFORM_RULES[p.key] ? { rules: PLATFORM_RULES[p.key] } : {}),
  ...(MEDIA_LIMITS[p.key] ? { limits: { media: MEDIA_LIMITS[p.key] } } : {}),
  ...(LINK_PLACEMENT[p.key]
    ? { linkPlacement: { supported: true as const, default: LINK_PLACEMENT[p.key]! } }
    : {}),
}));

export const PLATFORM_KEYS: readonly PlatformKey[] = PLATFORMS.map((p) => p.key);

const BY_KEY = new Map<string, PlatformMeta>(PLATFORMS.map((p) => [p.key, p]));

/** The registry entry of a key, or `undefined` for an unknown key. */
export function platformMeta(key: string): PlatformMeta | undefined {
  return BY_KEY.get(key);
}

export function isPlatformKey(key: string): key is PlatformKey {
  return BY_KEY.has(key);
}

/** Registry entries filtered by region and/or content kind, in registry order. */
export function listPlatforms(
  filter: { region?: PlatformRegion; contentType?: ContentKind } = {}
): PlatformMeta[] {
  return PLATFORMS.filter(
    (p) =>
      (!filter.region || p.region === filter.region) &&
      (!filter.contentType || p.contentTypes.includes(filter.contentType))
  );
}
