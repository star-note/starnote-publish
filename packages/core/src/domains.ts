/**
 * SPEC-r13 §1: what each platform is good for, in the public categories' top level (SPEC-r3 `categories`, the same
 * 25 slugs a blog category maps to), so the publish panel can recommend platforms by the article's domain and the
 * guides can group platforms by domain.
 */
import type { PlatformKey } from './platforms';

/** The top-level public categories (`categories.slug` where `parent_id IS NULL`). */
export const DOMAIN_SLUGS = [
  'tech',
  'business',
  'education',
  'health',
  'emotion',
  'workplace',
  'food',
  'travel',
  'entertainment',
  'sports',
  'auto',
  'home',
  'fashion',
  'family',
  'humanities',
  'military',
  'games',
  'anime',
  'humor',
  'science',
  'law',
  'government',
  'charity',
  'life',
  'misc',
] as const;

export type DomainSlug = (typeof DOMAIN_SLUGS)[number];

export interface PlatformDomains {
  /** 综合平台: any domain fits; recommended after the platforms that focus on the article's domain. */
  general: boolean;
  /** Best-fitting domains, best first (a general platform may have some too: 知乎's tech / science…). */
  focus: DomainSlug[];
  /** Not a place to publish articles (Patreon, Buy Me a Coffee: a 「支持我」 link only): never recommended. */
  supportOnly?: true;
}

const general = (...focus: DomainSlug[]): PlatformDomains => ({ general: true, focus });
const focus = (...slugs: DomainSlug[]): PlatformDomains => ({ general: false, focus: slugs });

/** Initial labels: SPEC-r13 §1.3 (existing platforms) and §6 (the vertical platforms). */
export const PLATFORM_DOMAINS: Record<PlatformKey, PlatformDomains> = {
  // 国内
  chenji: general(),
  wechat: general(),
  zhihu: general('tech', 'science', 'workplace', 'business'),
  juejin: focus('tech'),
  csdn: focus('tech'),
  xiaohongshu: general('life', 'fashion', 'food', 'travel', 'family', 'home'),
  yuque: focus('tech', 'education', 'workplace'),
  weibo: general(),
  toutiao: general(),
  baijiahao: general(),
  netease: general(),
  sohu: general(),
  'qq-om': general(),
  dayu: general(),
  yidian: general(),
  bilibili: general('games', 'anime', 'tech', 'education', 'entertainment'),
  douyin: general('entertainment', 'life', 'food'),
  kuaishou: general('entertainment', 'life', 'food'),
  'wechat-channels': general('entertainment', 'life', 'food'),
  jianshu: general('humanities', 'emotion', 'life'),
  smzdm: focus('life', 'home', 'fashion', 'auto'),
  cnblogs: focus('tech'),
  segmentfault: focus('tech'),
  oschina: focus('tech'),
  'tencent-cloud': focus('tech'),
  '51cto': focus('tech'),
  // 国内垂类（SPEC-r13 §6）
  xueqiu: focus('business'),
  eastmoney: focus('business'),
  huxiu: focus('business', 'tech'),
  woshipm: focus('tech', 'workplace'),
  sspai: focus('tech', 'life'),
  zsxq: focus('education', 'business', 'tech'),
  dongchedi: focus('auto'),
  hupu: focus('sports'),
  douban: general('humanities', 'entertainment', 'life'),
  'douban-read': focus('humanities'),
  mafengwo: focus('travel'),
  // 海外
  'github-pages': focus('tech'),
  medium: general('tech', 'business', 'humanities', 'workplace'),
  substack: general('business', 'humanities', 'tech'),
  ghost: general(),
  wordpress: general(),
  'wordpress-com': general(),
  devto: focus('tech'),
  hashnode: focus('tech'),
  blogger: general(),
  linkedin: focus('workplace', 'business', 'tech'),
  x: general(),
  facebook: general(),
  threads: general(),
  reddit: general(),
  telegram: general(),
  discord: general(),
  slack: general(),
  quora: general(),
  vocal: focus('humanities'),
  newsbreak: general(),
  patreon: { general: false, focus: [], supportOnly: true },
  buymeacoffee: { general: false, focus: [], supportOnly: true },
  pinterest: focus('food', 'fashion', 'home', 'travel', 'humanities'),
  youtube: general('entertainment', 'education', 'tech'),
  instagram: general('fashion', 'food', 'travel', 'life'),
  bluesky: general(),
  mastodon: general(),
  tumblr: general('anime', 'humanities', 'entertainment'),
};

/** Problems with a platform's labels (empty when fine): the registry test runs this over every platform. */
export function domainProblems(key: string, d: PlatformDomains | undefined): string[] {
  if (!d) return [`${key}: no domains`];
  const out: string[] = [];
  if (!d.general && d.focus.length === 0 && !d.supportOnly)
    out.push(`${key}: neither general nor any focus`);
  for (const s of d.focus)
    if (!(DOMAIN_SLUGS as readonly string[]).includes(s)) out.push(`${key}: unknown domain ${s}`);
  if (new Set(d.focus).size !== d.focus.length) out.push(`${key}: duplicate focus`);
  return out;
}
