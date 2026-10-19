/**
 * Platform registry (SPEC-r8 §2, §5): the single source of platform keys, names, colours, regions,
 * content kinds, runtimes, binding and monetization for the web app, the desktop app and — through
 * `dist/platforms.json` — the API. Plain data: no adapter code, safe for the browser.
 *
 * `runtimes` is the recommended way per runtime, best first; it is what `planRuntime` reads when no
 * adapter is registered yet. Facts marked ⚠️ in SPEC-r8 are best guesses until verified with real
 * accounts.
 */
import { PLATFORM_RULES } from './rules';

import type { CredentialKind, CredentialStore } from './binding';
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
  | 'yuque'
  | 'weibo'
  | 'toutiao'
  | 'baijiahao'
  | 'netease'
  | 'sohu'
  | 'qq-om'
  | 'dayu'
  | 'yidian'
  | 'bilibili'
  | 'douyin'
  | 'kuaishou'
  | 'wechat-channels'
  | 'jianshu'
  | 'smzdm'
  | 'cnblogs'
  | 'segmentfault'
  | 'oschina'
  | 'tencent-cloud'
  | '51cto'
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
  | 'tumblr';

export type PlatformRegion = 'cn' | 'global';

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
  | 'affiliate';

/** Delivery phase in SPEC-r8 §14 (P0 SDK … P7 video); absent = backlog. */
export type PlatformPhase = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7';

/**
 * How far the platform's adapter is: `implemented` = 已实现（待接线）: the adapter package exists and is
 * tested, but the web app / API do not use it yet; `live` = wired and usable. Absent = not built.
 */
export type PlatformStage = 'implemented' | 'live';

export interface PlatformMeta {
  key: PlatformKey;
  label: string;
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
}

/** A registry entry as written below; `mobileFirst` defaults to false. */
type PlatformEntry = Omit<PlatformMeta, 'mobileFirst'> & { mobileFirst?: boolean };

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

const COOKIE = { kind: 'cookie', store: 'desktop' } as const;
const OAUTH = { kind: 'oauth', store: 'server' } as const;
const TOKEN = { kind: 'token', store: 'server' } as const;
const NONE = { kind: 'none', store: 'none' } as const;

const ARTICLE: ContentKind[] = ['article'];
const SHORT: ContentKind[] = ['short-text'];

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
    contentTypes: ['article', 'short-text'],
    runtimes: [
      api('server', { kinds: ['short-text'], needs: ['token', 'app-review'] }),
      desktop({ kinds: ['article'] }),
      handoff('share-intent', 'https://service.weibo.com/share/share.php', {
        kinds: ['short-text'],
      }),
    ],
    binding: OAUTH,
    monetization: ['ad-share', 'brand-deals'],
    phase: 'P2',
    stage: 'implemented',
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
    // MetaWeblog API
    runtimes: [api('server', needs('token'))],
    binding: TOKEN,
    monetization: [],
    phase: 'P2',
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
    contentTypes: SHORT,
    // 发帖 API 要申请产品权限：只做分享跳转
    runtimes: [handoff('share-intent', 'https://www.linkedin.com/sharing/share-offsite/')],
    binding: NONE,
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
    contentTypes: SHORT,
    // Page 发帖要 Meta App Review，个人主页没有 API：只做分享跳转
    runtimes: [handoff('share-intent', 'https://www.facebook.com/sharer/sharer.php')],
    binding: NONE,
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
    contentTypes: SHORT,
    // 对外开放需 Meta App Review：只做分享跳转
    runtimes: [handoff('share-intent', 'https://www.threads.com/intent/post')],
    binding: NONE,
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
    contentTypes: SHORT,
    runtimes: [handoff('share-intent', 'https://t.me/share/url')],
    binding: NONE,
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
    // API 的 Trial 档建的 Pin 只有自己可见，Standard 档要录屏审核：只做分享跳转（带图片和链接）
    runtimes: [handoff('share-intent', 'https://www.pinterest.com/pin/create/button/')],
    binding: NONE,
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
    // 发布 API 要 Meta App Review，也没有网页分享链接：手机用系统分享面板交给 App，电脑下载图片 + 复制文案
    runtimes: [
      handoff('web-share', 'https://www.instagram.com/', {
        note: '手机：系统分享面板选 Instagram，在 App 里完成发布',
      }),
      manual(),
    ],
    binding: NONE,
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
];

export const PLATFORMS: readonly PlatformMeta[] = ENTRIES.map((p) => ({
  ...p,
  mobileFirst: p.mobileFirst ?? false,
  ...(PLATFORM_RULES[p.key] ? { rules: PLATFORM_RULES[p.key] } : {}),
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
