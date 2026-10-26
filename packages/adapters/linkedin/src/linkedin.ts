/**
 * LinkedIn (Posts API ✅ learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api, SPEC-r11 §10):
 * an article card back to 辰记 on the member's feed. Bound with OAuth (`openid profile w_member_social`, the
 * self-serve 「Share on LinkedIn」 + 「Sign In with LinkedIn using OpenID Connect」 products ⚠️); the member's `sub`
 * comes from `/v2/userinfo` and becomes `author: urn:li:person:{sub}`.
 *
 * 辰记's API sends `POST https://api.linkedin.com/rest/posts` with `LinkedIn-Version: ${LINKEDIN_API_VERSION}` (env,
 * default `202509` ⚠️) and `X-Restli-Protocol-Version: 2.0.0`; the optional thumbnail is uploaded first
 * (`/rest/images?action=initializeUpload`). `external_id` is the `x-restli-id` response header (a share / ugcPost
 * URN); the link is `https://www.linkedin.com/feed/update/{urn}`. Access tokens last 60 days and cannot be refreshed
 * on this product tier: the account then shows 「即将到期」 (SPEC-r11 §8).
 *
 * SPEC-r12 §2: `linkPlacement: 'first_comment'` (the default ⚠️ — LinkedIn is said to show posts with outbound links
 * less) posts the commentary without the article card; the link follows as the member's comment
 * (`POST /rest/socialActions/{post urn}/comments`, ⚠️ same `LinkedIn-Version` header) through the relay's `…/comment`.
 *
 * Not bound: the existing share-offsite hand-off (`@starnote/publish-share`).
 */
import { defineAdapter, mediaReport, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  cardOf,
  codePoints,
  credentialOf,
  fitPost,
  guard,
  helpError,
  linkPlacementField,
  missingLinkReport,
  newPostReport,
  placeLink,
  relayFollowUp,
  relayPublish,
  relayRequestOf,
  truncate,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
import { z } from 'zod';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  FollowUpInput,
  PublishContent,
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';

export const LINKEDIN_API = 'https://api.linkedin.com';
/** ⚠️ 版本号是 YYYYMM，服务器用环境变量 `LINKEDIN_API_VERSION` 覆盖。 */
export const LINKEDIN_DEFAULT_VERSION = '202509';

export const LINKEDIN_LIMITS = {
  /** ⚠️ 待核实：commentary 3000 字符（SPEC-r8 §5.2）。 */
  commentaryMax: 3000,
  /** ⚠️ 待核实：文章卡片标题 / 描述的上限（文档未写，按 200 / 256 截）。 */
  titleMax: 200,
  descriptionMax: 256,
  maxTags: 3,
} as const;

const URL_RE = /^https?:\/\/\S+$/;

export const linkedinSchema = z.object({
  /** Your own commentary instead of title + summary. */
  text: z.string().trim().max(LINKEDIN_LIMITS.commentaryMax).optional().describe('动态文案'),
  link: z
    .string()
    .trim()
    .regex(URL_RE, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).default('PUBLIC').describe('可见范围'),
  include_summary: z.boolean().default(true).describe('文案带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  with_cover: z.boolean().default(true).describe('卡片带封面图'),
  /** SPEC-r12 §2: the link as the article card, or as the member's first comment (default). */
  linkPlacement: linkPlacementField('linkedin'),
});

export type LinkedinForm = z.infer<typeof linkedinSchema>;
export type LinkedinFormInput = z.input<typeof linkedinSchema>;

export const linkedinBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'linkedin',
  scopes: ['openid', 'profile', 'w_member_social'],
  helpUrl: 'https://www.linkedin.com/',
  instructions: [
    '点「用 LinkedIn 授权」，在 LinkedIn 页面允许辰记代你发动态',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    'LinkedIn 的授权 60 天后过期且不能自动续期，到期前会提醒你重新授权',
    '不用时到 LinkedIn「设置 → 数据隐私 → 其他应用」撤销辰记',
  ],
};

/**
 * LinkedIn 「little text」 (✅ commentary format): `| { } @ [ ] ( ) < > # \ * _ ~` are reserved and escaped with `\`.
 */
export function littleText(s: string): string {
  return s.replace(/[|{}@[\]()<>#\\*_~]/g, (c) => `\\${c}`);
}

/** A hashtag in little text (⚠️ 待核实 `{hashtag|\#|word}` 模板，来自 Posts API 文档示例). */
export function littleHashtag(word: string): string {
  return `{hashtag|\\#|${word}}`;
}

export interface LinkedinPost {
  commentary: string;
  visibility: 'PUBLIC' | 'CONNECTIONS';
  distribution: {
    feedDistribution: 'MAIN_FEED';
    targetEntities: [];
    thirdPartyDistributionChannels: [];
  };
  content?: { article: { source: string; title: string; description?: string } };
  lifecycleState: 'PUBLISHED';
  isReshareDisabledByAuthor: boolean;
}

/** The relay body: the post without `author` (the server adds `urn:li:person:{sub}`) + the thumbnail to upload. */
export interface LinkedinRelayBody {
  post: LinkedinPost;
  /** The server uploads it (`initializeUpload`) and sets `content.article.thumbnail`. */
  thumb_url?: string;
}

export interface LinkedinRendered {
  /** The commentary as the reader sees it. */
  text: string;
  body: LinkedinRelayBody;
  report: ReportItem[];
  /** `linkPlacement: 'first_comment'`: the comment carrying the link. */
  followUp?: FollowUpInput;
}

export function renderLinkedin(
  doc: Doc,
  form: LinkedinForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): LinkedinRendered {
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  const placed = placeLink(form.linkPlacement, card.link, card.lang);
  const link = placed.bodyLink;
  const allTags = form.include_tags ? card.tags : [];
  // The link is the article card, not part of the text.
  const fit = fitPost({
    head: card.text ?? card.title,
    ...(form.include_summary && !card.text ? { summary: card.summary } : {}),
    tags: allTags.slice(0, LINKEDIN_LIMITS.maxTags),
    limit: LINKEDIN_LIMITS.commentaryMax,
  });
  const commentary = [
    [fit.head, fit.summary].filter(Boolean).map(littleText).join('\n\n'),
    fit.tags.map(littleHashtag).join(' '),
  ]
    .filter(Boolean)
    .join('\n\n');
  if (fit.truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `LinkedIn 动态最多 ${LINKEDIN_LIMITS.commentaryMax} 字，已截短`,
    });
  let article: { source: string; title: string; description?: string } | undefined;
  if (link) {
    const title = truncate(card.title || fit.head, LINKEDIN_LIMITS.titleMax);
    const description =
      codePoints(card.summary) > LINKEDIN_LIMITS.descriptionMax
        ? truncate(card.summary, LINKEDIN_LIMITS.descriptionMax)
        : card.summary;
    article = { source: link, title, ...(description ? { description } : {}) };
    report.push({
      kind: 'link.card',
      text: '以文章卡片发出，点开是辰记原文',
      detail: { url: link },
    });
  } else if (placed.followUp) report.push(...placed.report);
  else report.push(missingLinkReport('LinkedIn'));
  const thumb = form.with_cover && link ? card.cover : undefined;
  if (thumb)
    report.push({ kind: 'image.rehosted', text: '封面图由服务器上传为卡片缩略图', count: 1 });
  return {
    text: fit.text,
    body: {
      post: {
        commentary,
        visibility: form.visibility,
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(article ? { content: { article } } : {}),
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
      ...(thumb ? { thumb_url: thumb } : {}),
    },
    report: [...report, ...mediaReport('linkedin', 'LinkedIn', content, common)],
    ...(placed.followUp ? { followUp: placed.followUp } : {}),
  };
}

/** The post's link from its URN (`x-restli-id`). */
export function linkedinPostUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}`;
}

export function linkedinRef(links?: ErrorLinks): PlatformRef {
  return { key: 'linkedin', label: 'LinkedIn', ...(links ? { links } : {}) };
}

const LI_HEADERS =
  'Bearer <access_token> + LinkedIn-Version: ${LINKEDIN_API_VERSION} + X-Restli-Protocol-Version: 2.0.0';

export const LINKEDIN_REQUESTS = {
  userinfo: { method: 'GET', url: `${LINKEDIN_API}/v2/userinfo`, auth: 'Bearer <access_token>' },
  initializeImage: {
    method: 'POST',
    url: `${LINKEDIN_API}/rest/images?action=initializeUpload`,
    auth: LI_HEADERS,
    body: "{ initializeUploadRequest: { owner: 'urn:li:person:{sub}' } } → uploadUrl, image URN",
  },
  create: {
    method: 'POST',
    url: `${LINKEDIN_API}/rest/posts`,
    auth: LI_HEADERS,
    body: "LinkedinPost + author: 'urn:li:person:{sub}' (+ content.article.thumbnail) → 201, x-restli-id",
  },
} as const satisfies Record<string, RequestDescription>;

export function linkedinHandoff(
  doc: Doc,
  form: LinkedinForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: { assetBase?: string } = {}
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('linkedin', doc, form, common, content, opts);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('linkedin', input);
  return { handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText }, report: r.report };
}

export interface LinkedinAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
}

export function createLinkedinAdapter(
  opts: LinkedinAdapterOptions = {}
): Adapter<typeof linkedinSchema> {
  const ref = linkedinRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'linkedin',
    label: 'LinkedIn',
    runtimes: opts.runtimes ?? platformMeta('linkedin')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: linkedinBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: linkedinSchema,
    // SPEC-r11 §6: LinkedIn one at a time
    maxConcurrent: 1,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderLinkedin(doc, form, common, content, renderOpts);
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        report: r.report,
        ...(r.followUp ? { followUp: r.followUp } : {}),
      };
    },
    renderRequest({ doc, form, common, content }) {
      const r = renderLinkedin(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, undefined, undefined, r.report, r.followUp);
    },
    // SPEC-r12 §2.2: the member's comment on the post (`socialActions/{urn}/comments`), through the relay
    followUp(post, input, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'linkedin', ctx);
        return relayFollowUp(ctx, ref, post, input, { credential });
      });
    },
    renderHandoff({ doc, form, common, content }) {
      return linkedinHandoff(doc, form, common, content, renderOpts);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderLinkedin(doc, form, common, content, renderOpts);
        if (!r.text.trim() && !r.body.post.content)
          throw helpError(ref, '动态是空的', { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '发到 LinkedIn' });
        const credential = await credentialOf(opts.credential, 'linkedin', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(r.report, res.report),
          ...(r.followUp
            ? { followUp: { ...r.followUp, ...(res.meta !== undefined ? { meta: res.meta } : {}) } }
            : {}),
        };
      });
    },
  });
}
