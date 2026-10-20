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
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  articleOf,
  canonicalOf,
  codePoints,
  credentialOf,
  degradeArticle,
  guard,
  helpError,
  relayPublish,
  truncate,
} from '@starnote/publish-kit';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
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

export const redditSchema = z.object({
  subreddit: z
    .string()
    .trim()
    .transform((s) => s.replace(/^\/?r\//i, ''))
    .pipe(z.string().regex(/^[A-Za-z0-9_]{2,21}$/, '版块名只能是字母、数字和下划线'))
    .describe('版块（r/…）'),
  kind: z.enum(['link', 'self']).default('link').describe('帖子类型'),
  nsfw: z.boolean().default(false).describe('NSFW'),
  spoiler: z.boolean().default(false).describe('剧透'),
  sendreplies: z.boolean().default(true).describe('回复通知我'),
  flair_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,64}$/, 'flair ID 格式不对')
    .optional()
    .describe('Flair ID'),
  flair_text: z.string().trim().max(REDDIT_LIMITS.flairTextMax).optional().describe('Flair 文字'),
  link: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  external_id: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{1,16}$/, '帖子 ID 是小写字母和数字')
    .optional()
    .describe('已发布帖子 ID'),
});

export type RedditForm = z.infer<typeof redditSchema>;
export type RedditFormInput = z.input<typeof redditSchema>;

export const redditBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'reddit',
  scopes: ['identity', 'submit', 'edit'],
  helpUrl: 'https://www.reddit.com/',
  instructions: [
    '点「用 Reddit 授权」，在 Reddit 页面允许辰记代你提交帖子',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '发帖前先看版块规则：很多版块不允许自我推广或只接受特定 flair',
    '不用时到 Reddit「User Settings → Safety & Privacy → Manage third-party app authorization」撤销',
  ],
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
  opts: { assetBase?: string } = {}
): RedditRendered {
  const report: ReportItem[] = [];
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
      text: `Reddit 标题最多 ${REDDIT_LIMITS.titleMax} 字，已截短`,
    });
  const canonical = article
    ? canonicalOf({ canonical_url: form.link }, article, 'Reddit')
    : { url: form.link || short?.link, report: [] as ReportItem[] };
  const link = canonical.url;

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
        'Reddit'
      );
      text = degraded.body;
      report.push(...degraded.report);
      if (degraded.doc.images.length)
        report.push({
          kind: 'image.linked',
          text: `${degraded.doc.images.length} 张图片以链接形式出现在正文（Reddit 文字帖不内嵌外链图片）`,
          count: degraded.doc.images.length,
        });
    } else {
      text = short?.text ?? '';
    }
    const tail = link ? `\n\n---\n\n*Originally published at [${link}](${link})*` : '';
    if (codePoints(text) + codePoints(tail) > REDDIT_LIMITS.textMax) {
      text = truncate(text, REDDIT_LIMITS.textMax - codePoints(tail) - 2);
      report.push({
        kind: 'body.truncated',
        level: 'warn',
        text: `Reddit 文字帖最多 ${REDDIT_LIMITS.textMax} 字，已截短并附原文链接`,
      });
    }
    text += tail;
    if (link)
      report.push({ kind: 'canonical.note', text: '文末附上辰记原文链接', detail: { url: link } });
  } else {
    if (!link) throw new Error('还没有可分享的链接：先发布到辰记（或在表单里填写链接）');
    report.push({ kind: 'link.post', text: `以链接帖发布，指向 ${link}`, detail: { url: link } });
  }
  report.push({
    kind: 'subreddit.rules',
    level: 'notice',
    text: `请确认 r/${form.subreddit} 允许这类帖子（自我推广、flair 要求），违规可能被删帖或封号`,
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

export interface RedditAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
}

export function createRedditAdapter(opts: RedditAdapterOptions = {}): Adapter<typeof redditSchema> {
  const ref = redditRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'reddit',
    label: 'Reddit',
    runtimes: opts.runtimes ?? platformMeta('reddit')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['article', 'short-text'],
    binding: redditBinding,
    capabilities: { supportsUpdate: true, needsLogin: true, titleMax: REDDIT_LIMITS.titleMax },
    schema: redditSchema,
    preview(doc, form, common, content): AdapterPreview {
      try {
        const r = renderReddit(doc, form, common, content, renderOpts);
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
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        let r: RedditRendered;
        try {
          r = renderReddit(doc, form, common, content, renderOpts);
        } catch (e) {
          throw helpError(ref, (e as Error).message, { code: 'no_link' });
        }
        if (ctx.previous?.externalId && form.kind === 'link')
          throw helpError(
            ref,
            'Reddit 的链接帖发布后不能修改；如需更新请发文字帖或在 Reddit 上删帖重发',
            {
              code: 'invalid',
            }
          );
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: `提交到 r/${form.subreddit}` });
        const credential = await credentialOf(opts.credential, 'reddit', ctx);
        const res = await relayPublish(
          ctx,
          ref,
          r.body,
          form.kind === 'self' ? form.external_id : undefined,
          { credential }
        );
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
