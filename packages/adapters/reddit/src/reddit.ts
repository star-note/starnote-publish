/**
 * Reddit (OAuth API ✅ github.com/reddit-archive/reddit/wiki/OAuth2): `POST https://oauth.reddit.com/api/submit`
 * (`kind=link|self`, `sr`, `title`, `url` | `text`, `api_type=json`), edits of text posts with
 * `POST /api/editusertext` (link posts cannot change). Bound with OAuth2 (`duration=permanent`, scopes
 * `identity submit edit`; access tokens last an hour, the refresh token stays the same ✅).
 *
 * ⚠️ 门槛：2025-11 起 Reddit 的 Responsible Builder Policy 要求新 OAuth 应用先申请审批、自助通道关闭（官方页面摘录 +
 * r/redditdev 公告镜像，待人工核实原文）；商业用途需另签协议。未获批时用 `@starnote/publish-share` 的 Reddit 分享跳转。
 * 各版块的自我推广规则很严：发链接帖前请确认版块允许。
 *
 * Default: a link post to the 辰记 original (what most subreddits expect); `kind: 'self'` posts the article as
 * Reddit Markdown with the link at the end.
 */
import {
  byLang,
  defineAdapter,
  isUrlExternalId,
  mediaReport,
  mergeReports,
  parsePostUrl,
  platformMeta,
} from '@starnote/publish-core';
import {
  articleOf,
  canonicalOf,
  codePoints,
  credentialOf,
  degradeArticle,
  guard,
  helpError,
  linkCost,
  num,
  readJson,
  refIn,
  relayPublish,
  relayRequestOf,
  stats,
  truncate,
} from '@starnote/publish-kit';
import { buildShare } from '@starnote/publish-share';
import { z } from 'zod';

import { msg } from './i18n';

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
  SdkLang,
  StatsContext,
} from '@starnote/publish-core';
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';

export const REDDIT_API = 'https://oauth.reddit.com';

export const REDDIT_LIMITS = {
  /** 标题 300 字符（Reddit 提交页的限制）。 */
  titleMax: 300,
  /** ⚠️ 待核实：文字帖正文 40000 字符（社区通行说法）。 */
  textMax: 40000,
  flairTextMax: 64,
} as const;

/** The form in a language (SPEC-r14 B5). */
export const redditSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    subreddit: z
      .string()
      .trim()
      .transform((s) => s.replace(/^\/?r\//i, ''))
      .pipe(z.string().regex(/^[A-Za-z0-9_]{2,21}$/, t.subredditFormat))
      .describe(t.subreddit),
    kind: z.enum(['link', 'self']).default('link').describe(t.kind),
    nsfw: z.boolean().default(false).describe(t.nsfw),
    spoiler: z.boolean().default(false).describe(t.spoiler),
    sendreplies: z.boolean().default(true).describe(t.sendreplies),
    flair_id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,64}$/, t.flairFormat)
      .optional()
      .describe(t.flairId),
    flair_text: z.string().trim().max(REDDIT_LIMITS.flairTextMax).optional().describe(t.flairText),
    link: z
      .string()
      .trim()
      .regex(/^https?:\/\/\S+$/, t.httpUrl)
      .optional()
      .describe(t.link),
    external_id: z
      .string()
      .trim()
      .regex(/^[a-z0-9]{1,16}$/, t.idFormat)
      .optional()
      .describe(t.externalId),
  });
});

export const redditSchema = redditSchemaFor('zh-CN');

export type RedditForm = z.infer<typeof redditSchema>;
export type RedditFormInput = z.input<typeof redditSchema>;

export const redditBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'reddit',
  scopes: ['identity', 'submit', 'edit'],
  helpUrl: 'https://www.reddit.com/',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface RedditSubmitBody {
  sr: string;
  kind: 'link' | 'self';
  title: string;
  text?: string;
  url?: string;
  nsfw?: boolean;
  spoiler?: boolean;
  sendreplies?: boolean;
  flair_id?: string;
  flair_text?: string;
}

export interface RedditRendered {
  title: string;
  text: string;
  body: RedditSubmitBody;
  report: ReportItem[];
}

/** Pure: the submit body (articles and short texts) and the predicted report. Throws on a missing link. */
export function renderReddit(
  doc: Doc,
  form: RedditForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; lang?: SdkLang } = {}
): RedditRendered {
  const lang = opts.lang;
  const t = msg(lang);
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('reddit', 'Reddit', content, common, lang));
  const short = content?.kind === 'short-text' ? content : undefined;
  const article = short ? undefined : articleOf(doc, content);
  const rawTitle = (
    common.title ||
    short?.text.split('\n')[0] ||
    article?.doc.title ||
    'Untitled'
  ).trim();
  const title =
    codePoints(rawTitle) > REDDIT_LIMITS.titleMax
      ? truncate(rawTitle, REDDIT_LIMITS.titleMax)
      : rawTitle;
  if (title !== rawTitle)
    report.push({
      kind: 'title.truncated',
      text: t.titleTruncated(REDDIT_LIMITS.titleMax),
    });
  const canonical = article
    ? canonicalOf({ canonical_url: form.link }, article, 'Reddit', lang)
    : { url: form.link || short?.link, report: [] as ReportItem[] };
  // SPEC-r12 §5.3: the submitted link / the closing line is what readers click: the tracking short link
  const link = form.link
    ? canonical.url
    : (article ? article.trackingUrl : short?.trackingUrl) || canonical.url;

  let text = '';
  if (form.kind === 'self') {
    if (article) {
      const degraded = degradeArticle(
        article.doc,
        {
          target: 'markdown',
          lang: article.lang,
          title: article.doc.title,
          math: 'dollar',
          video: 'link',
          stripHighlight: true,
          ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
        },
        'Reddit',
        lang
      );
      text = degraded.body;
      report.push(...degraded.report);
      if (degraded.doc.images.length)
        report.push({
          kind: 'image.linked',
          text: t.imagesLinked(degraded.doc.images.length),
          count: degraded.doc.images.length,
        });
    } else {
      text = short?.text ?? '';
    }
    const tail = link ? `\n\n---\n\n*Originally published at [${link}](${link})*` : '';
    // the link appears twice; a scheduled batch's placeholder is budgeted at the real link's length
    const tailCost = codePoints(tail) + (link ? 2 * (linkCost(link) - codePoints(link)) : 0);
    if (codePoints(text) + tailCost > REDDIT_LIMITS.textMax) {
      text = truncate(text, REDDIT_LIMITS.textMax - tailCost - 2);
      report.push({
        kind: 'body.truncated',
        level: 'warn',
        text: t.bodyTruncated(REDDIT_LIMITS.textMax),
      });
    }
    text += tail;
    if (link) report.push({ kind: 'canonical.note', text: t.originNote, detail: { url: link } });
  } else {
    if (!link) throw new Error(t.noLink);
    report.push({ kind: 'link.post', text: t.linkPost(link), detail: { url: link } });
  }
  report.push({
    kind: 'subreddit.rules',
    level: 'notice',
    text: t.rules(form.subreddit),
  });

  return {
    title,
    text,
    body: {
      sr: form.subreddit,
      kind: form.kind,
      title,
      ...(form.kind === 'self' ? { text } : { url: link! }),
      ...(form.nsfw ? { nsfw: true } : {}),
      ...(form.spoiler ? { spoiler: true } : {}),
      sendreplies: form.sendreplies,
      ...(form.flair_id ? { flair_id: form.flair_id } : {}),
      ...(form.flair_text ? { flair_text: form.flair_text } : {}),
    },
    report,
  };
}

export function redditRef(links?: ErrorLinks): PlatformRef {
  return { key: 'reddit', label: 'Reddit', ...(links ? { links } : {}) };
}

export const REDDIT_REQUESTS = {
  account: {
    method: 'GET',
    url: `${REDDIT_API}/api/v1/me`,
    auth: 'Bearer <access_token> + User-Agent',
  },
  submit: {
    method: 'POST',
    url: `${REDDIT_API}/api/submit`,
    auth: 'Bearer <access_token> + User-Agent',
    body: 'form: RedditSubmitBody + api_type=json',
  },
  editText: {
    method: 'POST',
    url: `${REDDIT_API}/api/editusertext`,
    auth: 'Bearer <access_token> + User-Agent',
    body: 'form: thing_id=t3_<id>, text, api_type=json',
  },
} as const satisfies Record<string, RequestDescription>;

/**
 * SPEC-r11 §7 ✅ public `GET https://www.reddit.com/by_id/t3_{id}.json` (no credential): score → likes, comments;
 * Reddit shows no view count to others (`view_count` is null ⚠️).
 */
export async function fetchRedditStats(
  externalId: string,
  ctx: StatsContext,
  base = 'https://www.reddit.com'
): Promise<PlatformStats | null> {
  // a pasted-back link (SPEC-r12 §1.1) gives its post id; a link that names none: no stats
  const id = isUrlExternalId(externalId)
    ? parsePostUrl('reddit', externalId)?.externalId
    : externalId.replace(/^t3_/, '');
  if (!id) return null;
  const data = await readJson<{ data?: { children?: Array<{ data?: Record<string, unknown> }> } }>(
    ctx,
    redditRef(),
    `${base}/by_id/t3_${encodeURIComponent(id)}.json?raw_json=1`
  );
  const post = data?.data?.children?.[0]?.data;
  if (!post || post.removed_by_category) return null;
  const ratio = num(post.upvote_ratio);
  return stats('public', {
    views: num(post.view_count),
    likes: num(post.score),
    comments: num(post.num_comments),
    shares: num(post.num_crossposts),
    ...(ratio !== undefined ? { extra: { upvote_ratio: ratio } } : {}),
  });
}

export interface RedditAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
}

export function createRedditAdapter(opts: RedditAdapterOptions = {}): Adapter<typeof redditSchema> {
  const ref = redditRef(opts.links);
  const base = opts.assetBase ? { assetBase: opts.assetBase } : {};
  const renderOpts = (lang?: SdkLang) => ({ ...base, ...(lang ? { lang } : {}) });
  return defineAdapter({
    key: 'reddit',
    label: 'Reddit',
    runtimes: opts.runtimes ?? platformMeta('reddit')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['article', 'short-text'],
    binding: redditBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: REDDIT_LIMITS.titleMax },
    schema: redditSchema,
    schemaFor: redditSchemaFor,
    // SPEC-r11 §6: Reddit one at a time
    maxConcurrent: 1,
    statsRequires: 'none',
    fetchStats(externalId, ctx) {
      return fetchRedditStats(externalId, ctx);
    },
    preview(doc, form, common, content, popts): AdapterPreview {
      try {
        const r = renderReddit(doc, form, common, content, renderOpts(popts?.lang));
        return {
          format: form.kind === 'self' ? 'markdown' : 'text',
          title: r.title,
          body: form.kind === 'self' ? r.text : (r.body.url ?? ''),
          report: r.report,
        };
      } catch (e) {
        return {
          format: 'text',
          title: common?.title || doc.title,
          body: '',
          report: [{ kind: 'share.no-link', level: 'warn', text: (e as Error).message }],
        };
      }
    },
    // SPEC-r11 §12: the same rendering as `publish`, as the relay request of a scheduled task.
    renderRequest({ doc, form, common, content, previous, lang }) {
      const r = renderReddit(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(
        r.body,
        previous,
        form.kind === 'self' ? form.external_id : undefined,
        r.report
      );
    },
    // Not bound / app not approved: the share-intent hand-off (SPEC-r11 §10).
    renderHandoff({ doc, form, common, content, lang }) {
      const r = renderReddit(doc, { ...form, kind: 'link' }, common, content, renderOpts(lang));
      const s = buildShare(
        'reddit',
        {
          title: r.title,
          link: r.body.url!,
          tags: [],
          subreddit: form.subreddit,
        },
        lang
      );
      return {
        handoff: { via: s.via, openUrl: s.openUrl, copyText: s.copyText },
        report: s.report,
      };
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        let r: RedditRendered;
        const t = msg(ctx.lang);
        const lref = refIn(ref, ctx.lang);
        try {
          r = renderReddit(doc, form, common, content, renderOpts(ctx.lang));
        } catch (e) {
          throw helpError(lref, (e as Error).message, { code: 'no_link' });
        }
        if (ctx.previous?.externalId && form.kind === 'link')
          throw helpError(lref, t.linkPostFixed, { code: 'invalid' });
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.submitting(form.subreddit) });
        const credential = await credentialOf(opts.credential, 'reddit', ctx);
        const res = await relayPublish(
          ctx,
          ref,
          r.body,
          form.kind === 'self' ? form.external_id : undefined,
          { credential }
        );
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
