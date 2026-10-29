/**
 * 公众号风格主题 (CONTRACTS-r9 §1): five article looks shared by the editor / blog stylesheet
 * (`ai-sparkwrite-editor/src/styles/themes.scss`, same token map) and the WeChat converter
 * (`convertWechat(json, { theme })`).
 *
 * A theme only restyles the *plain* blocks: headings and quotes without a `variant`, plain dividers
 * (`horizontalRule` / `divider` of variant `line`), image captions, body typography, and the accent
 * colours that styled cards follow. Blocks with an explicit look keep it.
 */

import { coreMessages } from './i18n/messages';

export const ARTICLE_THEME_IDS = ['business', 'tech', 'warm', 'magazine', 'fresh'] as const;

export type ArticleThemeId = (typeof ARTICLE_THEME_IDS)[number];

/** h2 looks: left bar, filled tag, centred with a short rule, hairline + accent underline, tinted block. */
export type ThemeH2Style = 'bar' | 'tag' | 'center' | 'underline' | 'soft';
/** h3 looks: accent colour, leading dot, plain. */
export type ThemeH3Style = 'accent' | 'dot' | 'plain';
/** Quote looks: left line, tinted card, centred, rules above / below, tinted with a soft bar. */
export type ThemeQuoteStyle = 'line' | 'card' | 'center' | 'rule' | 'soft';
/** Plain divider looks. */
export type ThemeHrStyle = 'short' | 'gradient' | 'dots' | 'double' | 'dashed';

export interface ArticleThemeCaption {
  /** px */
  size: number;
  color: string;
  align: 'center' | 'left';
  italic?: boolean;
}

export interface ArticleTheme {
  id: ArticleThemeId;
  /** 中文名, e.g. 科技蓝 */
  name: string;
  /** One line for the picker. */
  description: string;
  accent: string;
  accent2: string;
  /** Body text colour. */
  ink: string;
  heading: string;
  muted: string;
  /** Body size in px. */
  fontSize: 15 | 16;
  lineHeight: number;
  /** Space after a paragraph, px. */
  paragraphGap: number;
  justify: boolean;
  /** px */
  letterSpacing: number;
  h2: ThemeH2Style;
  h3: ThemeH3Style;
  quote: ThemeQuoteStyle;
  /** Corner radius of the plain cards (soft / outline / shadow / accent / ticket / dark), px. */
  cardRadius: number;
  hr: ThemeHrStyle;
  caption: ArticleThemeCaption;
}

export const ARTICLE_THEMES: Record<ArticleThemeId, ArticleTheme> = {
  business: {
    id: 'business',
    name: '简约商务',
    description: '藏青与暗金，左侧竖条标题，克制留白，适合商业、职场、财经',
    accent: '#1f4e8c',
    accent2: '#c69c4f',
    ink: '#3a3a3a',
    heading: '#1b2431',
    muted: '#8a8f99',
    fontSize: 15,
    lineHeight: 1.75,
    paragraphGap: 18,
    justify: true,
    letterSpacing: 0.5,
    h2: 'bar',
    h3: 'accent',
    quote: 'line',
    cardRadius: 4,
    hr: 'short',
    caption: { size: 12, color: '#8a8f99', align: 'center' },
  },
  tech: {
    id: 'tech',
    name: '科技蓝',
    description: '亮蓝到青的渐变，色块标题与卡片式引用，适合技术、科学、数码',
    accent: '#1e6fff',
    accent2: '#00b8d9',
    ink: '#2b3445',
    heading: '#0f1b33',
    muted: '#8592a6',
    fontSize: 15,
    lineHeight: 1.8,
    paragraphGap: 20,
    justify: true,
    letterSpacing: 0.5,
    h2: 'tag',
    h3: 'dot',
    quote: 'card',
    cardRadius: 10,
    hr: 'gradient',
    caption: { size: 12, color: '#8592a6', align: 'center' },
  },
  warm: {
    id: 'warm',
    name: '文艺暖',
    description: '赭石暖色，居中标题，宽行距与斜体图注，适合文学、读书、情感随笔',
    accent: '#b4613a',
    accent2: '#d9a35b',
    ink: '#4a4038',
    heading: '#3a2e25',
    muted: '#a29486',
    fontSize: 16,
    lineHeight: 1.9,
    paragraphGap: 24,
    justify: true,
    letterSpacing: 1,
    h2: 'center',
    h3: 'plain',
    quote: 'center',
    cardRadius: 6,
    hr: 'dots',
    caption: { size: 13, color: '#a29486', align: 'center', italic: true },
  },
  magazine: {
    id: 'magazine',
    name: '杂志感',
    description: '黑白加一抹正红，粗细线标题与上下线引语，适合艺术、时尚、影视、旅行',
    accent: '#c8102e',
    accent2: '#1a1a1a',
    ink: '#2a2a2a',
    heading: '#111111',
    muted: '#8c8c8c',
    fontSize: 16,
    lineHeight: 1.75,
    paragraphGap: 22,
    justify: true,
    letterSpacing: 0.3,
    h2: 'underline',
    h3: 'accent',
    quote: 'rule',
    cardRadius: 0,
    hr: 'double',
    caption: { size: 12, color: '#8c8c8c', align: 'left' },
  },
  fresh: {
    id: 'fresh',
    name: '清新绿',
    description: '薄荷绿，圆角色块标题与柔和引用，适合教育、健康、生活、美食',
    accent: '#2a9d6f',
    accent2: '#5cbf95',
    ink: '#3b4a43',
    heading: '#1f3b2f',
    muted: '#8aa197',
    fontSize: 15,
    lineHeight: 1.8,
    paragraphGap: 20,
    justify: true,
    letterSpacing: 0.5,
    h2: 'soft',
    h3: 'dot',
    quote: 'soft',
    cardRadius: 14,
    hr: 'dashed',
    caption: { size: 12, color: '#8aa197', align: 'center' },
  },
};

export function isArticleThemeId(value: unknown): value is ArticleThemeId {
  return typeof value === 'string' && (ARTICLE_THEME_IDS as readonly string[]).includes(value);
}

/**
 * SPEC-r14 B5: a theme's name and one-line description in `lang` (the `name` / `description` fields are `zh-CN`).
 * A custom theme (not one of `ARTICLE_THEME_IDS`) keeps its own texts.
 */
export function themeText(
  theme: ArticleThemeId | Pick<ArticleTheme, 'id' | 'name' | 'description'>,
  lang?: string | null
): { name: string; description: string } {
  const id = typeof theme === 'string' ? theme : theme.id;
  if (isArticleThemeId(id) && (typeof theme === 'string' || ARTICLE_THEMES[id].name === theme.name))
    return coreMessages(lang).themes[id];
  return typeof theme === 'string'
    ? { name: theme, description: '' }
    : { name: theme.name, description: theme.description };
}

/** The theme for an id, or `null` (no theme / unknown id). */
export function getArticleTheme(id: string | null | undefined): ArticleTheme | null {
  return isArticleThemeId(id) ? ARTICLE_THEMES[id] : null;
}

/** An id or a theme object (a custom theme) → the theme, or `null`. */
export function resolveArticleTheme(
  theme: ArticleThemeId | ArticleTheme | string | null | undefined
): ArticleTheme | null {
  if (!theme) return null;
  if (typeof theme === 'string') return getArticleTheme(theme);
  return typeof theme === 'object' && typeof theme.accent === 'string' ? theme : null;
}

/** Class names for the article root: `'sn-theme sn-theme--tech'`; `''` without a theme. */
export function themeClassName(id: string | null | undefined): string {
  return isArticleThemeId(id) ? `sn-theme sn-theme--${id}` : '';
}

/* ------------------------------------------------------------------------ */
/* recommendation (rules, no AI)                                            */
/* ------------------------------------------------------------------------ */

/** System taxonomy slugs (starnote-api `app/services/taxonomy.py`) → best theme. */
const SLUG_THEME: Record<string, ArticleThemeId> = {};
const add = (theme: ArticleThemeId, slugs: string) => {
  for (const slug of slugs.split(/\s+/).filter(Boolean)) SLUG_THEME[slug] = theme;
};
add(
  'tech',
  'tech frontend backend mobile ai data devops architecture opensource science math physics biology earth-space popsci games auto military productivity'
);
add(
  'business',
  'business startup finance economics marketing workplace career management job-hunting product growth law government charity weekly retro'
);
add(
  'warm',
  'emotion society relationships humanities history philosophy writing fiction poetry essay screenplay craft reading book-review reading-notes journal thoughts'
);
add(
  'magazine',
  'arts photography fine-arts fashion design product-design entertainment film music variety travel travel-guides travelogue anime home'
);
add(
  'fresh',
  'education k12 textbook exam language college study-skills teaching health wellness mental-health fitness life food recipes restaurants family sports humor'
);

/** Category names (any custom name too) → theme, by keyword; first match wins. */
const NAME_RULES: [RegExp, ArticleThemeId][] = [
  [
    /技术|科技|编程|开发|代码|前端|后端|算法|数据|AI|人工智能|大模型|科学|科普|数码|硬件|互联网|运维|架构|开源|数学|物理|游戏|汽车/i,
    'tech',
  ],
  [
    /商业|商务|职场|财经|金融|投资|理财|经济|创业|营销|管理|产品|增长|求职|法律|政务|周报|复盘/,
    'business',
  ],
  [/文学|人文|历史|哲学|读书|书评|小说|诗|散文|随笔|写作|情感|心理|亲密|日志|日记|随想/, 'warm'],
  [/艺术|时尚|穿搭|美妆|设计|影视|电影|音乐|综艺|旅行|游记|摄影|绘画|书法|动漫|家居/, 'magazine'],
  [/教育|学习|考试|教学|健康|养生|运动|健身|生活|美食|菜谱|探店|亲子|育儿|母婴|体育/, 'fresh'],
];

/** Second choices after the best theme (neighbouring looks first). */
const AFFINITY: Record<ArticleThemeId, ArticleThemeId[]> = {
  business: ['business', 'tech', 'magazine', 'fresh', 'warm'],
  tech: ['tech', 'business', 'fresh', 'magazine', 'warm'],
  warm: ['warm', 'magazine', 'fresh', 'business', 'tech'],
  magazine: ['magazine', 'warm', 'business', 'fresh', 'tech'],
  fresh: ['fresh', 'warm', 'tech', 'business', 'magazine'],
};

/**
 * Themes ordered for a category, best first (rule map, no AI). Accepts `{slug?, name?}` or a slug /
 * name string; unknown or missing categories get every theme in the default order.
 */
export function recommendThemes(
  category?: { slug?: string | null; name?: string | null } | string | null
): ArticleThemeId[] {
  const slug = typeof category === 'string' ? category : (category?.slug ?? undefined);
  const name = typeof category === 'string' ? category : (category?.name ?? undefined);
  let best: ArticleThemeId | undefined = slug ? SLUG_THEME[slug.trim().toLowerCase()] : undefined;
  if (!best && name) best = NAME_RULES.find(([re]) => re.test(name))?.[1];
  return best ? [...AFFINITY[best]] : [...ARTICLE_THEME_IDS];
}
