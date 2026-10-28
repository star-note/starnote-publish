/**
 * Local, deterministic compliance checks before publishing (CONTRACTS-r9 §5): lengths, tag / image counts,
 * external links, contact details (导流), QR codes, 《广告法》极限词 and the 「AI 生成内容」 label. Free and
 * offline. Items whose verdict depends on context carry `needsAi: true`; the web app sends those to
 * `check.platform` for a judgement and a rewrite. Nothing here blocks publishing.
 */
import { checkLearnedRules } from './learned';
import { platformRules } from './rules';

import type { LearnedRule } from './learned';
import type { PlatformRules } from './rules';
import type { TiptapJSON } from './types';

export type ComplianceField = 'title' | 'summary' | 'tags' | 'body' | 'images';

export type ComplianceRule =
  | 'title-length'
  | 'summary-length'
  | 'body-length'
  | 'tag-count'
  | 'image-count'
  | 'image-ratio'
  | 'external-link'
  | 'contact'
  | 'qrcode'
  | 'ad-law'
  | 'ai-label'
  /** SPEC-r13 §6.6 财经平台: 荐股 / 收益承诺 / 拉群带单, and a disclosure reminder when a stock is named. */
  | 'finance'
  /** From a learned rule (`ComplianceInput.extraRules`, SPEC-r9-compliance-learning). */
  | 'learned';

export type ComplianceFix =
  | { kind: 'replace'; from: string; to: string }
  | { kind: 'ai-label' }
  | { kind: 'trim'; field: ComplianceField; max: number };

export interface ComplianceItem {
  /** Stable across re-runs for the same text (`rule:hash:n`), so 「忽略」 survives typing elsewhere. */
  id: string;
  rule: ComplianceRule;
  /** Where the problem is: a platform field or the article body. */
  field: ComplianceField;
  level: 'warn' | 'info';
  /** 中文说明 */
  message: string;
  excerpt?: string;
  fix?: ComplianceFix;
  /** The verdict depends on context: ask `check.platform`. */
  needsAi?: boolean;
  /** Set on items of a learned rule: shown as 「根据近期发布反馈」. */
  learned?: { id: string; source: 'user' | 'global' };
}

export interface ComplianceInput {
  platform: string;
  title?: string;
  summary?: string;
  /** Plain body text. */
  text?: string;
  tags?: string[];
  /** Image URLs, in order. */
  images?: string[];
  /** Alt texts of `images`, same order. */
  imageAlts?: string[];
  /** Image sizes of `images` (same order) when known, for the aspect-ratio check. */
  imageSizes?: ({ width: number; height: number } | null | undefined)[];
  /** External hrefs in the body. */
  links?: string[];
  /** The article was written with AI help. */
  aiAssisted?: boolean;
  /** The user's 「AI 标注」 toggle; default true. */
  aiLabel?: boolean;
  /**
   * Learned rules merged into the check (the author's own `user` rules + the `global` ones the backend ships,
   * e.g. the signed site script's `learnedRules`). Rules of other platforms are ignored.
   */
  extraRules?: readonly LearnedRule[];
}

/** `checkCompliance(platform, doc, extraRules?)`: the document fields without `platform`. */
export type ComplianceDoc = Omit<ComplianceInput, 'platform' | 'extraRules'>;

export interface ComplianceResult {
  items: ComplianceItem[];
  rules?: PlatformRules;
}

/* ------------------------------------------------------------------------ */
/* helpers                                                                  */
/* ------------------------------------------------------------------------ */

/** FNV-1a, base36: short and stable. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Characters as a reader counts them (a CJK character or an emoji is one). */
export function charCount(text: string | undefined): number {
  return text ? Array.from(text).length : 0;
}

function around(text: string, index: number, length: number, pad = 8): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`.replace(
    /\s+/g,
    ' '
  );
}

class Items {
  list: ComplianceItem[] = [];
  private seen = new Map<string, number>();

  add(item: Omit<ComplianceItem, 'id'>, key: string): void {
    const base = `${item.rule}:${item.field}:${hash(key)}`;
    const n = this.seen.get(base) ?? 0;
    this.seen.set(base, n + 1);
    this.list.push({ id: n ? `${base}:${n}` : base, ...item });
  }
}

/* ------------------------------------------------------------------------ */
/* word lists                                                               */
/* ------------------------------------------------------------------------ */

/**
 * 《广告法》第九条 极限用语 (common list). `to`: a softer wording; `''` = no safe automatic replacement.
 * Longer phrases first so 「全网最低」 wins over 「最低」.
 */
export const AD_LAW_WORDS: { word: string; to: string }[] = [
  { word: '全网最低', to: '优惠' },
  { word: '史上最低', to: '优惠' },
  { word: '全网第一', to: '领先' },
  { word: '销量第一', to: '热销' },
  { word: '销量冠军', to: '热销' },
  { word: '第一品牌', to: '知名品牌' },
  { word: '全球首发', to: '新品发布' },
  { word: '全国首家', to: '较早' },
  { word: '独一无二', to: '独特' },
  { word: '史无前例', to: '少见' },
  { word: '遥遥领先', to: '领先' },
  { word: '最先进', to: '先进' },
  { word: '最高级', to: '高级' },
  { word: '最便宜', to: '实惠' },
  { word: '最低价', to: '优惠价' },
  { word: '最佳', to: '优秀' },
  { word: '最好', to: '很好' },
  { word: '最强', to: '强大' },
  { word: '最优', to: '优质' },
  { word: '最低', to: '较低' },
  { word: '国家级', to: '' },
  { word: '世界级', to: '国际水准' },
  { word: '顶级', to: '高端' },
  { word: '极致', to: '出色' },
  { word: '绝对', to: '非常' },
  { word: '万能', to: '多用途' },
  { word: '首个', to: '率先推出的' },
  { word: '首家', to: '较早的' },
  { word: '唯一', to: '少有' },
  { word: '第一', to: '领先' },
  { word: 'NO.1', to: '领先' },
  { word: 'No.1', to: '领先' },
  { word: 'TOP1', to: '领先' },
  { word: '100%', to: '高度' },
  { word: '百分之百', to: '高度' },
  { word: '永久', to: '长期' },
  { word: '无敌', to: '出色' },
  { word: '王牌', to: '主打' },
];

/** 「第一」 in ordinals / structure (第一章、第一次…) is not an advertising claim. */
const ORDINAL_AFTER = /^[章节次步天日点期页部回届集季批条项层眼时步个种位类段轮篇版封份张句行列组周年月]/;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AD_LAW_RE = new RegExp(AD_LAW_WORDS.map((w) => escapeRe(w.word)).join('|'), 'g');
const AD_LAW_TO = new Map(AD_LAW_WORDS.map((w) => [w.word, w.to]));

const CONTACT_PATTERNS: { re: RegExp; what: string }[] = [
  { re: /(?<![\d])1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?![\d])/g, what: '手机号' },
  {
    re: /(?:微信号?|威信|薇信|[vV]信|[vV][xX]|[wW][xX]|weixin|wechat|WeChat)\s*(?:号)?\s*[:：]?\s*[a-zA-Z][-_a-zA-Z0-9]{5,19}/g,
    what: '微信号',
  },
  { re: /(?:QQ|qq|扣扣|企鹅)\s*(?:号|群)?\s*[:：]?\s*[1-9]\d{4,11}/g, what: 'QQ 号' },
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, what: '邮箱' },
];

/**
 * SPEC-r13 §6.6: what 财经平台 treat as 荐股 / 非法证券咨询 or 收益承诺 (雪球社区公约、东方财富股吧管理规定；
 * 《证券期货投资咨询管理暂行办法》): flagged for the author to rephrase, never changed silently.
 */
export const FINANCE_WORDS: string[] = [
  '稳赚',
  '稳赚不赔',
  '包赚',
  '保证收益',
  '保本保收益',
  '必涨',
  '必翻倍',
  '翻倍股',
  '内幕消息',
  '荐股',
  '带单',
  '跟单',
  '喊单',
  '牛股推荐',
  '加群领',
  '进群领',
];
// longest first, so 「稳赚不赔」 is one match rather than 「稳赚」
const FINANCE_RE = new RegExp(
  [...FINANCE_WORDS]
    .sort((a, b) => b.length - a.length)
    .map((w) => escapeRe(w))
    .join('|'),
  'g'
);
/** A-share / HK codes (`600519`、`SH600519`、`00700.HK`) or a `$TICKER`: the article names a security. */
const SECURITY_RE = /(?:\b(?:SH|SZ|BJ)?[036]\d{5}\b|\b\d{5}\.HK\b|\$[A-Z]{1,5}\b)/g;

const QR_RE = /二维码|扫码|扫一扫|扫描[^，。,.\s]{0,4}码|QR\s?code/gi;
const QR_IMAGE_RE = /qr[-_ ]?code|(?:^|[^a-z])qr(?:[^a-z]|$)|二维码|erweima|wxcode|mpqrcode/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"'，。）)]+/gi;

/* ------------------------------------------------------------------------ */
/* entry                                                                    */
/* ------------------------------------------------------------------------ */

const FIELD_LABEL: Record<ComplianceField, string> = {
  title: '标题',
  summary: '摘要',
  tags: '标签',
  body: '正文',
  images: '图片',
};

/**
 * Deterministic checks of one platform's rules (SPEC-r8 §12.9: the SDK is the judge). Two call forms:
 * `checkCompliance(input)` and `checkCompliance(platform, doc, extraRules?)`. Unknown platforms only get the
 * learned-rule items.
 */
export function checkCompliance(input: ComplianceInput): ComplianceResult;
export function checkCompliance(
  platform: string,
  doc: ComplianceDoc,
  extraRules?: readonly LearnedRule[]
): ComplianceResult;
export function checkCompliance(
  first: ComplianceInput | string,
  doc?: ComplianceDoc,
  extraRules?: readonly LearnedRule[]
): ComplianceResult {
  const input: ComplianceInput =
    typeof first === 'string' ? { platform: first, ...(doc ?? {}), extraRules } : first;
  const rules = platformRules(input.platform);
  const out = new Items();
  const learned = checkLearnedRules(input, input.extraRules);
  if (!rules) return { items: learned };
  const name = input.platform;

  // lengths
  const length = (
    field: 'title' | 'summary' | 'body',
    rule: ComplianceRule,
    value: string | undefined,
    limit: { max?: number; min?: number } | undefined
  ) => {
    if (!limit || value === undefined) return;
    const n = charCount(value.trim());
    if (limit.max && n > limit.max)
      out.add(
        {
          rule,
          field,
          level: 'warn',
          message: `${FIELD_LABEL[field]} ${n} 字，超过平台上限 ${limit.max} 字`,
          ...(field === 'body'
            ? {}
            : {
                excerpt: value,
                fix: { kind: 'trim' as const, field, max: limit.max },
                needsAi: true,
              }),
        },
        `${field}:max`
      );
    else if (limit.min && n > 0 && n < limit.min)
      out.add(
        {
          rule,
          field,
          level: 'warn',
          message: `${FIELD_LABEL[field]} ${n} 字，少于平台下限 ${limit.min} 字`,
          excerpt: value,
          needsAi: true,
        },
        `${field}:min`
      );
  };
  length('title', 'title-length', input.title, rules.title);
  length('summary', 'summary-length', input.summary, rules.summary);
  length('body', 'body-length', input.text, rules.body);

  // tags
  const tags = (input.tags ?? []).filter((t) => t.trim());
  if (rules.tags && input.tags) {
    if (tags.length > rules.tags.max)
      out.add(
        {
          rule: 'tag-count',
          field: 'tags',
          level: 'warn',
          message: `标签 ${tags.length} 个，平台最多 ${rules.tags.max} 个`,
          fix: { kind: 'trim', field: 'tags', max: rules.tags.max },
        },
        'tags:max'
      );
    else if (rules.tags.min && tags.length < rules.tags.min)
      out.add(
        {
          rule: 'tag-count',
          field: 'tags',
          level: 'warn',
          message: `至少需要 ${rules.tags.min} 个标签`,
        },
        'tags:min'
      );
  }

  // images
  const images = input.images ?? [];
  if (rules.images && input.images) {
    const { min, max, ratios } = rules.images;
    if (max && images.length > max)
      out.add(
        {
          rule: 'image-count',
          field: 'images',
          level: 'warn',
          message: `图片 ${images.length} 张，平台最多 ${max} 张`,
          fix: { kind: 'trim', field: 'images', max },
        },
        'images:max'
      );
    else if (min && images.length < min)
      out.add(
        {
          rule: 'image-count',
          field: 'images',
          level: 'warn',
          message: `至少需要 ${min} 张图片`,
        },
        'images:min'
      );
    if (ratios?.length && input.imageSizes) {
      const allowed = ratios.map((r) => {
        const [w, h] = r.split(':').map(Number);
        return { r, v: w! / h! };
      });
      input.imageSizes.forEach((size, i) => {
        if (!size || !size.width || !size.height) return;
        const v = size.width / size.height;
        if (allowed.some((a) => Math.abs(a.v - v) / a.v <= 0.04)) return;
        out.add(
          {
            rule: 'image-ratio',
            field: 'images',
            level: 'info',
            message: `第 ${i + 1} 张图片比例 ${size.width}×${size.height}，平台推荐 ${ratios.join(' / ')}，可能被裁切`,
            excerpt: images[i],
          },
          `ratio:${images[i] ?? i}`
        );
      });
    }
  }

  // external links
  const bodyLinks = [
    ...new Set([...(input.links ?? []), ...(input.text?.match(URL_RE) ?? [])]),
  ].filter((href) => !(name === 'wechat' && /^https?:\/\/mp\.weixin\.qq\.com\//i.test(href)));
  if (rules.externalLinks !== 'allowed') {
    for (const href of bodyLinks) {
      const forbidden = rules.externalLinks === 'forbidden';
      out.add(
        {
          rule: 'external-link',
          field: 'body',
          level: forbidden ? 'warn' : 'info',
          message: forbidden
            ? '平台禁止站外链接（视为导流），发布前删除'
            : '公众号正文里的站外链接不可点击，导出时转为文末「参考链接」',
          excerpt: href,
          ...(forbidden ? { fix: { kind: 'replace' as const, from: href, to: '' } } : {}),
        },
        href
      );
    }
  }

  // contact details, QR codes, 广告法 words — in title, summary and body
  const texts: [ComplianceField, string | undefined][] = [
    ['title', input.title],
    ['summary', input.summary],
    ['body', input.text],
  ];
  for (const [field, value] of texts) {
    if (!value) continue;
    if (rules.noContact) {
      for (const { re, what } of CONTACT_PATTERNS) {
        for (const m of value.matchAll(re)) {
          out.add(
            {
              rule: 'contact',
              field,
              level: 'warn',
              message: `含${what}，平台禁止站外导流`,
              excerpt: around(value, m.index!, m[0].length),
              fix: { kind: 'replace', from: m[0], to: '' },
            },
            m[0]
          );
        }
      }
    }
    if (rules.noQrcode) {
      for (const m of value.matchAll(QR_RE)) {
        out.add(
          {
            rule: 'qrcode',
            field,
            level: 'warn',
            message: `提到「${m[0]}」，平台禁止二维码导流`,
            excerpt: around(value, m.index!, m[0].length),
            needsAi: true,
          },
          m[0]
        );
      }
    }
    if (rules.finance) {
      for (const m of value.matchAll(FINANCE_RE)) {
        out.add(
          {
            rule: 'finance',
            field,
            level: 'warn',
            message: `「${m[0]}」属于荐股或收益承诺类说法，财经平台会限流或删除，请换个说法`,
            excerpt: around(value, m.index!, m[0].length),
            needsAi: true,
          },
          m[0]
        );
      }
      const named = value.match(SECURITY_RE);
      if (named && field === 'body') {
        out.add(
          {
            rule: 'finance',
            field,
            level: 'info',
            message: `文中提到了 ${named[0]}：如果持有相关标的，记得在文末披露持仓或利益关系`,
          },
          `disclosure:${named[0]}`
        );
      }
    }
    if (rules.adLawWords) {
      for (const m of value.matchAll(AD_LAW_RE)) {
        const word = m[0];
        const next = value.slice(m.index! + word.length);
        if (word === '第一' && ORDINAL_AFTER.test(next)) continue;
        const to = AD_LAW_TO.get(word) ?? '';
        out.add(
          {
            rule: 'ad-law',
            field,
            level: 'warn',
            message: `「${word}」属于《广告法》极限用语，商业推广语境下禁用`,
            excerpt: around(value, m.index!, word.length),
            ...(to ? { fix: { kind: 'replace' as const, from: word, to } } : {}),
            needsAi: true,
          },
          word
        );
      }
    }
  }
  if (rules.noQrcode) {
    images.forEach((src, i) => {
      const alt = input.imageAlts?.[i] ?? '';
      const file = src.split(/[?#]/)[0]!.split('/').pop() ?? '';
      if (!QR_IMAGE_RE.test(`${alt} ${file}`)) return;
      out.add(
        {
          rule: 'qrcode',
          field: 'images',
          level: 'warn',
          message: `第 ${i + 1} 张图片看起来是二维码，平台禁止二维码导流`,
          excerpt: alt || file,
        },
        src
      );
    });
  }

  // AI label
  if (input.aiAssisted) {
    const { required, method, note } = rules.aiLabel;
    const declared = !!input.text && AI_DECLARATION_RE.test(input.text);
    if (input.aiLabel === false) {
      if (required !== false)
        out.add(
          {
            rule: 'ai-label',
            field: 'body',
            level: 'warn',
            message: `已关闭 AI 标注。${required === true ? '依法须标注' : '平台规则待核实'}，不标注有合规风险（${note}）`,
            fix: { kind: 'ai-label' },
          },
          'off'
        );
    } else {
      if (method !== 'platform-toggle' && !declared)
        out.add(
          {
            rule: 'ai-label',
            field: 'body',
            level: required === true ? 'warn' : 'info',
            message:
              rules.aiLabel.placement === 'top'
                ? '正文缺少 AI 辅助声明，该平台要求放在开头'
                : '正文缺少 AI 辅助声明，将在文末加一句',
            fix: { kind: 'ai-label' },
          },
          'footer'
        );
      if (method !== 'footer')
        out.add(
          {
            rule: 'ai-label',
            field: 'body',
            level: 'info',
            message: '发布时在平台勾选「内容由 AI 生成」声明',
            excerpt: note,
          },
          'toggle'
        );
    }
  }

  return { items: [...out.list, ...learned], rules };
}


/* ------------------------------------------------------------------------ */
/* AI declaration                                                           */
/* ------------------------------------------------------------------------ */

export const AI_DECLARATION_TEXT = {
  zh: '本文部分内容由 AI 辅助生成。',
  en: 'Parts of this article were produced with AI assistance.',
} as const;

const AI_DECLARATION_RE =
  /由\s*AI\s*(?:辅助)?生成|AI\s*辅助(?:创作|生成|写作)|内容由\s*AI|produced with AI assistance|AI[- ]assisted|generated (?:with|by) AI/i;

/** The declaration as a paragraph node (italic). */
export function aiDeclaration(lang: 'zh' | 'en' = 'zh'): TiptapJSON {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: AI_DECLARATION_TEXT[lang], marks: [{ type: 'italic' }] }],
  };
}

function plain(node: TiptapJSON): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plain).join('');
}

/**
 * The document with the declaration appended (or, `placement: 'top'`, first). Idempotent: a document
 * that already has the declaration paragraph (either language) is returned unchanged. Never mutates.
 */
export function appendAiDeclaration(
  json: TiptapJSON,
  lang: 'zh' | 'en' = 'zh',
  opts: { placement?: 'top' | 'bottom' } = {}
): TiptapJSON {
  const doc: TiptapJSON =
    json && json.type === 'doc' ? json : { type: 'doc', content: json ? [json] : [] };
  const blocks = doc.content ?? [];
  const texts = Object.values(AI_DECLARATION_TEXT) as string[];
  if (blocks.some((b) => b.type === 'paragraph' && texts.includes(plain(b).trim()))) return doc;
  const node = aiDeclaration(lang);
  return {
    ...doc,
    content: opts.placement === 'top' ? [node, ...blocks] : [...blocks, node],
  };
}

/**
 * The word lists and patterns the deterministic checks use, as data (emitted into `platforms.json` so the Python
 * backend runs the same checks before a server-side publish; regex sources are kept JS / Python compatible).
 */
export const COMPLIANCE_LEXICON = {
  version: 1,
  adLawWords: AD_LAW_WORDS,
  /** 「第一」 followed by one of these characters is an ordinal, not a claim. */
  ordinalAfter: ORDINAL_AFTER.source,
  contactPatterns: CONTACT_PATTERNS.map((c) => ({ what: c.what, source: c.re.source, flags: c.re.flags })),
  qrText: { source: QR_RE.source, flags: QR_RE.flags },
  qrImage: { source: QR_IMAGE_RE.source, flags: QR_IMAGE_RE.flags },
  url: { source: URL_RE.source, flags: URL_RE.flags },
  aiDeclaration: { source: AI_DECLARATION_RE.source, flags: AI_DECLARATION_RE.flags },
  aiDeclarationText: AI_DECLARATION_TEXT,
  /** SPEC-r13 §6.6 财经平台 (`rules.finance`). */
  financeWords: FINANCE_WORDS,
  security: { source: SECURITY_RE.source, flags: SECURITY_RE.flags },
} as const;
