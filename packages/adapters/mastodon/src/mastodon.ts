/**
 * Mastodon (✅ docs.joinmastodon.org): `POST /api/v1/statuses` (`status`, `visibility`, `language`, `spoiler_text`,
 * `sensitive`; `Idempotency-Key` header), edits `PUT /api/v1/statuses/{id}` (3.5+). Any instance: the user gives its
 * host, 辰记's API registers an app there (`POST /api/v1/apps`, cached) and runs the OAuth code flow (scope
 * `read:accounts write:statuses`; PKCE on 4.3+; tokens do not expire ✅). The instance builds the link card from the
 * first link in the text ✅, so the post is the title (+ summary) + hashtags + the 辰记 link.
 *
 * SPEC-r12 §2: `linkPlacement: 'first_comment'` leaves the link out of the status and posts it as a reply of the author
 * (`POST /api/v1/statuses` with `in_reply_to_id`, the same visibility) through the relay's `…/comment`.
 *
 * Length: 500 by default, each instance sets its own (`/api/v2/instance` → `configuration.statuses.max_characters`
 * ✅, kept on the account as `meta.max_characters`); a URL always counts as `characters_reserved_per_url` (23 ✅).
 */
import {
  byLang,
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
  platformMeta,
  visibleLinkOf,
} from '@starnote/publish-core';
import {
  codePoints,
  credentialOf,
  guard,
  helpError,
  linkPlacementField,
  refIn,
  num,
  placeLink,
  readJson,
  relayFollowUp,
  relayPublish,
  relayRequestOf,
  stats,
  truncate,
} from '@starnote/publish-kit';
import { z } from 'zod';

import { msg } from './i18n';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  FollowUpInput,
  PlatformStats,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  SdkLang,
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

export const mastodonInstanceFormFor = byLang((lang) =>
  z.object({
    instance: z
      .string()
      .trim()
      .refine((v) => normalizeInstance(v) !== null, msg(lang).form.instanceHint)
      .transform((v) => normalizeInstance(v)!)
      .describe(msg(lang).form.instance),
  })
);

export const mastodonInstanceForm = mastodonInstanceFormFor('zh-CN');

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const mastodonSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** Your own text instead of title + summary (still fitted to the limit). */
    text: z.string().trim().max(5000).optional().describe(t.text),
    link: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.link),
    visibility: z.enum(['public', 'unlisted', 'private']).default('public').describe(t.visibility),
    spoiler_text: z.string().trim().max(200).optional().describe(t.spoiler),
    sensitive: z.boolean().default(false).describe(t.sensitive),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    include_tags: z.boolean().default(true).describe(t.includeTags),
    external_id: z.string().trim().regex(/^\d+$/, t.idDigits).optional().describe(t.externalId),
    /** SPEC-r12 §2: the link in the status, or as the author's first reply. */
    linkPlacement: linkPlacementField('mastodon', lang),
  });
});

export const mastodonSchema = mastodonSchemaFor('zh-CN');

export type MastodonForm = z.infer<typeof mastodonSchema>;
export type MastodonFormInput = z.input<typeof mastodonSchema>;

export const mastodonBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'mastodon',
  fields: ['instance'],
  form: mastodonInstanceForm,
  formFor: mastodonInstanceFormFor,
  scopes: ['read:accounts', 'write:statuses'],
  helpUrl: 'https://joinmastodon.org/',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
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
  /** `linkPlacement: 'first_comment'`: the reply carrying the link. */
  followUp?: FollowUpInput;
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
  opts: { maxCharacters?: number; lang?: SdkLang } = {}
): MastodonRendered {
  const ui = opts.lang;
  const t = msg(ui);
  const limit =
    opts.maxCharacters && opts.maxCharacters > 0
      ? opts.maxCharacters
      : MASTODON_DEFAULTS.maxCharacters;
  const short = content?.kind === 'short-text' ? content : undefined;
  const article = content?.kind === 'article' ? content : undefined;
  const placed = placeLink(
    form.linkPlacement,
    form.link || visibleLinkOf(content),
    article?.lang,
    ui
  );
  const link = placed.bodyLink;
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
      text: t.truncated(limit, MASTODON_DEFAULTS.urlChars),
    });
  if (allTags.length > tags.length)
    report.push({
      kind: 'tags.trimmed',
      text: t.tagsTrimmed(tags.length, allTags.length - tags.length),
      count: allTags.length - tags.length,
    });
  if (link)
    report.push({
      kind: 'link.card',
      text: t.linkCard,
      detail: { url: link },
    });
  else if (placed.followUp) report.push(...placed.report);
  else
    report.push({
      kind: 'canonical.missing',
      level: 'notice',
      text: t.noLink,
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
    report: [...report, ...mediaReport('mastodon', 'Mastodon', content, common, ui)],
    ...(placed.followUp ? { followUp: placed.followUp } : {}),
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
 *
 * A pasted-back link (SPEC-r12 §1.1) is read on the link's own instance. The token is sent only to the instance it
 * belongs to (the credential's / the bound account's `instance`) — never to a host taken from a link.
 */
export async function fetchMastodonStats(
  externalId: string,
  ctx: StatsContext
): Promise<PlatformStats | null> {
  let id = externalId;
  let instance: string | null;
  if (isUrlExternalId(externalId)) {
    const parsed = parsePostUrl('mastodon', externalId);
    // not a status link, or a remote post seen through another instance (no id of its own)
    if (!parsed || isUrlExternalId(parsed.externalId)) return null;
    id = parsed.externalId;
    instance = normalizeInstance(new URL(parsed.url).host);
  } else instance = mastodonInstanceOf(ctx);
  if (!instance) return null;
  const own = ctx.credential?.instance ?? ctx.account?.meta?.instance;
  const tokenInstance = typeof own === 'string' && own ? normalizeInstance(own) : null;
  const token = tokenInstance === instance ? ctx.credential?.access_token : undefined;
  const s = await readJson<Record<string, unknown>>(
    ctx,
    mastodonRef(),
    `https://${instance}/api/v1/statuses/${encodeURIComponent(id)}`,
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
  const baseRef = mastodonRef(opts.links);
  return defineAdapter({
    key: 'mastodon',
    label: 'Mastodon',
    runtimes: opts.runtimes ?? platformMeta('mastodon')!.runtimes,
    contentTypes: ['short-text', 'article'],
    binding: mastodonBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: mastodonSchema,
    schemaFor: mastodonSchemaFor,
    statsRequires: 'none',
    fetchStats(externalId, ctx) {
      return fetchMastodonStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderMastodon(doc, form, common, content, popts?.lang ? { lang: popts.lang } : {});
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        report: r.report,
        ...(r.followUp ? { followUp: r.followUp } : {}),
      };
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous, account, lang }) {
      const max = maxOf(account?.meta);
      const r = renderMastodon(doc, form, common, content, {
        ...(max ? { maxCharacters: max } : {}),
        ...(lang ? { lang } : {}),
      });
      return relayRequestOf(r.body, previous, form.external_id, r.report, r.followUp);
    },
    // SPEC-r12 §2.2: the link as a reply of the author, through the relay (`in_reply_to_id`, same visibility)
    followUp(post, input, ctx) {
      const ref = refIn(baseRef, ctx.lang);
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'mastodon', ctx);
        return relayFollowUp(ctx, ref, post, input, { credential });
      });
    },
    publish({ doc, form, common, ctx, content }) {
      const ref = refIn(baseRef, ctx.lang);
      const t = msg(ctx.lang);
      return guard(ctx, ref, async () => {
        const max = maxOf(ctx.account?.meta);
        const r = renderMastodon(doc, form, common, content, {
          ...(max ? { maxCharacters: max } : {}),
          ...(ctx.lang ? { lang: ctx.lang } : {}),
        });
        if (!r.text.trim()) throw helpError(ref, t.empty, { code: 'invalid' });
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.publishing });
        const credential = await credentialOf(opts.credential, 'mastodon', ctx);
        const res = await relayPublish(ctx, ref, r.body, form.external_id, { credential });
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(r.report, res.report),
          ...(r.followUp
            ? { followUp: { ...r.followUp, meta: res.meta ?? { visibility: form.visibility } } }
            : {}),
        };
      });
    },
  });
}
