/**
 * Mastodon (✅ docs.joinmastodon.org): `POST /api/v1/statuses` (`status`, `visibility`, `language`, `spoiler_text`,
 * `sensitive`; `Idempotency-Key` header), edits `PUT /api/v1/statuses/{id}` (3.5+). Any instance: the user gives its
 * host, 辰记's API registers an app there (`POST /api/v1/apps`, cached) and runs the OAuth code flow (scope
 * `read:accounts write:statuses`; PKCE on 4.3+; tokens do not expire ✅). The instance builds the link card from the
 * first link in the text ✅, so the post is the title (+ summary) + hashtags + the 辰记 link.
 *
 * Length: 500 by default, each instance sets its own (`/api/v2/instance` → `configuration.statuses.max_characters`
 * ✅, kept on the account as `meta.max_characters`); a URL always counts as `characters_reserved_per_url` (23 ✅).
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  codePoints,
  credentialOf,
  guard,
  helpError,
  num,
  readJson,
  relayPublish,
  relayRequestOf,
  stats,
  truncate,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PlatformStats,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  StatsContext,
} from '@starnote/publish-core';
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';

export const MASTODON_DEFAULTS = {
  /** ✅ 默认 500（实例可改，以账号上记录的 max_characters 为准）。 */
  maxCharacters: 500,
  /** ✅ 链接一律按 23 字计。 */
  urlChars: 23,
  maxTags: 4,
} as const;

/** `mastodon.social` / `https://mastodon.social/` → `mastodon.social` (no path, no port, no IP literal). */
export function normalizeInstance(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  return s;
}

export const mastodonInstanceForm = z.object({
  instance: z
    .string()
    .trim()
    .refine((v) => normalizeInstance(v) !== null, '请填写实例域名，如 mastodon.social')
    .transform((v) => normalizeInstance(v)!)
    .describe('实例'),
});

export const mastodonSchema = z.object({
  /** Your own text instead of title + summary (still fitted to the limit). */
  text: z.string().trim().max(5000).optional().describe('嘟文'),
  link: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  visibility: z.enum(['public', 'unlisted', 'private']).default('public').describe('可见范围'),
  spoiler_text: z.string().trim().max(200).optional().describe('内容警告'),
  sensitive: z.boolean().default(false).describe('敏感内容'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  external_id: z
    .string()
    .trim()
    .regex(/^\d+$/, '嘟文 ID 是数字')
    .optional()
    .describe('已发布嘟文 ID'),
});

export type MastodonForm = z.infer<typeof mastodonSchema>;
export type MastodonFormInput = z.input<typeof mastodonSchema>;

export const mastodonBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'mastodon',
  fields: ['instance'],
  form: mastodonInstanceForm,
  scopes: ['read:accounts', 'write:statuses'],
  helpUrl: 'https://joinmastodon.org/',
  instructions: [
    '填写你的实例域名（如 mastodon.social），点「授权」',
    '在实例页面登录并允许辰记发嘟文（辰记会自动在该实例登记应用，不需要你自己创建）',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到实例「设置 → 账户 → 授权的应用」撤销辰记',
  ],
};

export interface MastodonStatusBody {
  status: string;
  visibility: 'public' | 'unlisted' | 'private';
  language?: string;
  spoiler_text?: string;
  sensitive?: boolean;
}

export interface MastodonRendered {
  text: string;
  hashtags: string[];
  body: MastodonStatusBody;
  report: ReportItem[];
}

/** Mastodon's count: code points, every URL as 23. */
export function mastodonLength(s: string, urlChars: number = MASTODON_DEFAULTS.urlChars): number {
  let n = 0;
  const rest = s.replace(/https?:\/\/\S+/g, () => {
    n += urlChars;
    return '';
  });
  return n + codePoints(rest);
}

function hashtag(t: string): string | null {
  const w = t.replace(/[^\p{L}\p{N}_]+/gu, '');
  return w && !/^\d+$/.test(w) ? w : null;
}

/** `zh-CN` → `zh` (ISO 639-1). */
function iso639(lang?: string): string | undefined {
  const m = /^([a-z]{2})(?:[-_]|$)/i.exec(lang ?? '');
  return m ? m[1]!.toLowerCase() : undefined;
}

export function renderMastodon(
  doc: Doc,
  form: MastodonForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { maxCharacters?: number } = {}
): MastodonRendered {
  const limit =
    opts.maxCharacters && opts.maxCharacters > 0
      ? opts.maxCharacters
      : MASTODON_DEFAULTS.maxCharacters;
  const short = content?.kind === 'short-text' ? content : undefined;
  const article = content?.kind === 'article' ? content : undefined;
  const link = form.link || short?.link || article?.canonicalUrl;
  const d = article?.doc ?? doc;
  const head = (
    form.text ||
    short?.thread?.[0] ||
    short?.text ||
    common.title ||
    d.title ||
    ''
  ).trim();
  let summary =
    form.text || short || !form.include_summary ? '' : (common.summary || d.summary || '').trim();
  const allTags = form.include_tags
    ? [...new Set((common.tags ?? []).map(hashtag).filter((t): t is string => !!t))]
    : [];
  const tags = allTags.slice(0, MASTODON_DEFAULTS.maxTags);
  const report: ReportItem[] = [];

  const compose = (h: string, s: string, tg: string[]) =>
    [[h, s].filter(Boolean).join('\n\n'), tg.map((t) => `#${t}`).join(' '), link ?? '']
      .filter(Boolean)
      .join('\n\n');
  const fits = (h: string, s: string, tg: string[]) => mastodonLength(compose(h, s, tg)) <= limit;

  let h = head;
  let truncated = false;
  if (!fits(h, summary, tags) && summary) {
    let lo = 0;
    let hi = codePoints(summary);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(h, truncate(summary, mid), tags)) lo = mid;
      else hi = mid - 1;
    }
    summary = lo >= 20 ? truncate(summary, lo) : '';
    truncated = true;
  }
  while (!fits(h, summary, tags) && tags.length) {
    tags.pop();
    truncated = true;
  }
  if (!fits(h, summary, tags)) {
    let lo = 1;
    let hi = codePoints(h);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(truncate(h, mid), summary, tags)) lo = mid;
      else hi = mid - 1;
    }
    h = truncate(h, lo);
    truncated = true;
  }
  const status = compose(h, summary, tags);
  if (truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `嘟文按实例上限 ${limit} 字截短（链接按 ${MASTODON_DEFAULTS.urlChars} 字计）`,
    });
  if (allTags.length > tags.length)
    report.push({
      kind: 'tags.trimmed',
      text: `话题保留 ${tags.length} 个，去掉 ${allTags.length - tags.length} 个`,
      count: allTags.length - tags.length,
    });
  if (link)
    report.push({
      kind: 'link.card',
      text: '实例会按正文里的链接生成预览卡片',
      detail: { url: link },
    });
  else
    report.push({
      kind: 'canonical.missing',
      level: 'notice',
      text: '还没有辰记原文链接，嘟文里没有链接（先发布到辰记再同步可以带上原文卡片）',
    });

  const language = iso639(article?.lang);
  return {
    text: status,
    hashtags: tags,
    body: {
      status,
      visibility: form.visibility,
      ...(language ? { language } : {}),
      ...(form.spoiler_text ? { spoiler_text: form.spoiler_text } : {}),
      ...(form.sensitive ? { sensitive: true } : {}),
    },
    report,
  };
}

export function mastodonRef(links?: ErrorLinks): PlatformRef {
  return { key: 'mastodon', label: 'Mastodon', ...(links ? { links } : {}) };
}

export const MASTODON_REQUESTS = {
  registerApp: {
    method: 'POST',
    url: 'https://{instance}/api/v1/apps',
    auth: 'none',
    body: "client_name, redirect_uris, scopes='read:accounts write:statuses', website",
  },
  account: {
    method: 'GET',
    url: 'https://{instance}/api/v1/accounts/verify_credentials',
    auth: 'Bearer <access_token>',
  },
  instance: { method: 'GET', url: 'https://{instance}/api/v2/instance', auth: 'none' },
  create: {
    method: 'POST',
    url: 'https://{instance}/api/v1/statuses',
    auth: 'Bearer <access_token> + Idempotency-Key',
    body: 'MastodonStatusBody',
  },
  update: {
    method: 'PUT',
    url: 'https://{instance}/api/v1/statuses/{id}',
    auth: 'Bearer <access_token>',
    body: 'MastodonStatusBody (without visibility)',
  },
} as const satisfies Record<string, RequestDescription>;

/** The instance of a post: the credential's, the account's (`meta.instance`), else the post URL's host. */
export function mastodonInstanceOf(
  ctx: Pick<StatsContext, 'credential' | 'account' | 'url'>
): string | null {
  const given = ctx.credential?.instance ?? ctx.account?.meta?.instance;
  if (typeof given === 'string' && given) return normalizeInstance(given);
  try {
    return ctx.url ? normalizeInstance(new URL(ctx.url).host) : null;
  } catch {
    return null;
  }
}

/**
 * SPEC-r11 §7 ✅ public `GET https://{instance}/api/v1/statuses/{id}` (public / unlisted posts need no token):
 * favourites → likes, replies → comments, boosts → shares. Mastodon has no view count.
 */
export async function fetchMastodonStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  const instance = mastodonInstanceOf(ctx);
  if (!instance) return null;
  const token = ctx.credential?.access_token;
  const s = await readJson<Record<string, unknown>>(
    ctx,
    mastodonRef(),
    `https://${instance}/api/v1/statuses/${encodeURIComponent(externalId)}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {}
  );
  if (!s) return null;
  return stats('public', {
    likes: num(s.favourites_count),
    comments: num(s.replies_count),
    shares: num(s.reblogs_count),
  });
}

export interface MastodonAdapterOptions {
  runtimes?: RuntimeSupport[];
  links?: ErrorLinks;
  credential?: CredentialSource;
}

function maxOf(meta: Record<string, unknown> | undefined): number | undefined {
  const n = Number(meta?.max_characters);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createMastodonAdapter(
  opts: MastodonAdapterOptions = {}
): Adapter<typeof mastodonSchema> {
  const ref = mastodonRef(opts.links);
  return defineAdapter({
    key: 'mastodon',
    label: 'Mastodon',
    runtimes: opts.runtimes ?? platformMeta('mastodon')!.runtimes,
    contentTypes: ['short-text', 'article'],
    binding: mastodonBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: mastodonSchema,
    statsRequires: 'none',
    fetchStats(externalId, ctx) {
      return fetchMastodonStats(externalId, ctx);
    },
    preview(doc, form, common, content): AdapterPreview {
      const r = renderMastodon(doc, form, common, content);
      return { format: 'text', title: common?.title || doc.title, body: r.text, report: r.report };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous, account }) {
      const max = maxOf(account?.meta);
      const r = renderMastodon(doc, form, common, content, max ? { maxCharacters: max } : {});
      return relayRequestOf(r.body, previous, form.external_id, r.report);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const max = maxOf(ctx.account?.meta);
        const r = renderMastodon(doc, form, common, content, max ? { maxCharacters: max } : {});
        if (!r.text.trim()) throw helpError(ref, '嘟文是空的', { code: 'invalid' });
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '发布到 Mastodon' });
        const credential = await credentialOf(opts.credential, 'mastodon', ctx);
        const res = await relayPublish(ctx, ref, r.body, form.external_id, { credential });
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
