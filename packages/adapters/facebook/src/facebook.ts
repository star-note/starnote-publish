/**
 * Facebook Pages (Graph API ✅ developers.facebook.com/docs/pages-api/posts, SPEC-r11 §10): a link post on a Page the
 * user manages. Bound with OAuth (`pages_show_list, pages_manage_posts, pages_read_engagement`, Meta App Review ⚠️);
 * after authorizing, the user picks a Page from `/me/accounts` (the same 「选目标」 step as Blogger) and 辰记 keeps that
 * Page's access token. 辰记's API sends `POST /{page-id}/feed { message, link }` on Graph API `${META_GRAPH_VERSION}`
 * (env, default `v23.0` ⚠️); `external_id` is the post id (`{page-id}_{post-id}`), the link
 * `https://www.facebook.com/{post-id}`.
 *
 * SPEC-r12 §2: `linkPlacement: 'first_comment'` posts the message without `link` (no preview card); the link follows
 * as the Page's comment (`POST /{post-id}/comments` with the Page token, ⚠️ `pages_manage_engagement`) through the
 * relay's `…/comment`.
 *
 * Personal timelines have no API. Not bound: the existing sharer.php hand-off (`@starnote/publish-share`).
 */
import {
  byLang,
  defineAdapter,
  mediaReport,
  mergeReports,
  platformMeta,
} from '@starnote/publish-core';
import {
  cardOf,
  credentialOf,
  fitPost,
  guard,
  helpError,
  linkPlacementField,
  missingLinkReport,
  newPostReport,
  placeLink,
  refIn,
  relayFollowUp,
  relayPublish,
  relayRequestOf,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
import { z } from 'zod';

import { msg } from './i18n';

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
  SdkLang,
} from '@starnote/publish-core';
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';

/** ⚠️ 服务器用环境变量 `META_GRAPH_VERSION` 覆盖。 */
export const META_GRAPH_DEFAULT_VERSION = 'v23.0';

export const FACEBOOK_LIMITS = {
  /** ⚠️ 待核实：帖子正文 63206 字符（第三方资料）；我们只发引流文案，按 2000 截。 */
  messageMax: 63206,
  cardMessageMax: 2000,
  maxTags: 3,
} as const;

const URL_RE = /^https?:\/\/\S+$/;

/** The form in a language (SPEC-r14 B5). */
export const facebookSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    text: z.string().trim().max(FACEBOOK_LIMITS.cardMessageMax).optional().describe(t.text),
    link: z.string().trim().regex(URL_RE, t.httpUrl).optional().describe(t.link),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    include_tags: z.boolean().default(true).describe(t.includeTags),
    /** The Page; default the one picked when binding (`account.meta.page_id`). */
    page_id: z
      .string()
      .trim()
      .regex(/^\d{5,30}$/, t.pageDigits)
      .optional()
      .describe(t.page),
    /** SPEC-r12 §2: the link with its preview card, or as the Page's first comment. */
    linkPlacement: linkPlacementField('facebook', lang),
  });
});

export const facebookSchema = facebookSchemaFor('zh-CN');

export type FacebookForm = z.infer<typeof facebookSchema>;
export type FacebookFormInput = z.input<typeof facebookSchema>;

export const facebookBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'facebook',
  scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
  selects: [{ id: 'page', title: msg('zh-CN').selectPage }],
  selectsFor: (lang) => [{ id: 'page', title: msg(lang).selectPage }],
  helpUrl: 'https://www.facebook.com/pages/',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

/** `POST /{page-id}/feed` without the token. */
export interface FacebookFeedBody {
  message: string;
  link?: string;
  /** The Page to post to; absent: the bound one. */
  page_id?: string;
}

export interface FacebookRendered {
  text: string;
  body: FacebookFeedBody;
  report: ReportItem[];
  /** `linkPlacement: 'first_comment'`: the comment carrying the link. */
  followUp?: FollowUpInput;
}

export function renderFacebook(
  doc: Doc,
  form: FacebookForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; lang?: SdkLang } = {}
): FacebookRendered {
  const lang = opts.lang;
  const t = msg(lang);
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  const placed = placeLink(form.linkPlacement, card.link, card.lang, lang);
  const link = placed.bodyLink;
  const allTags = form.include_tags ? card.tags : [];
  const fit = fitPost({
    head: card.text ?? card.title,
    ...(form.include_summary && !card.text ? { summary: card.summary } : {}),
    tags: allTags.slice(0, FACEBOOK_LIMITS.maxTags),
    limit: FACEBOOK_LIMITS.cardMessageMax,
  });
  if (fit.truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: t.truncated(FACEBOOK_LIMITS.cardMessageMax),
    });
  if (link)
    report.push({
      kind: 'link.card',
      text: t.linkCard,
      detail: { url: link },
    });
  else if (placed.followUp) report.push(...placed.report);
  else report.push(missingLinkReport('Facebook', lang));
  return {
    text: fit.text,
    body: {
      message: fit.text,
      ...(link ? { link } : {}),
      ...(form.page_id ? { page_id: form.page_id } : {}),
    },
    report: [...report, ...mediaReport('facebook', 'Facebook', content, common, lang)],
    ...(placed.followUp ? { followUp: placed.followUp } : {}),
  };
}

export function facebookRef(links?: ErrorLinks): PlatformRef {
  return { key: 'facebook', label: 'Facebook', ...(links ? { links } : {}) };
}

export const FACEBOOK_REQUESTS = {
  pages: {
    method: 'GET',
    url: 'https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts?fields=id,name,access_token,picture',
    auth: 'Bearer <user access_token>',
  },
  feed: {
    method: 'POST',
    url: 'https://graph.facebook.com/${META_GRAPH_VERSION}/{page-id}/feed',
    auth: 'Bearer <page access_token>',
    body: 'FacebookFeedBody (page_id dropped) → { id: "{page-id}_{post-id}" }',
  },
} as const satisfies Record<string, RequestDescription>;

export interface FacebookAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
  /** The share fallback's Share Dialog app id (else sharer.php). */
  facebookAppId?: string;
}

export function facebookHandoff(
  doc: Doc,
  form: FacebookForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: Pick<FacebookAdapterOptions, 'assetBase' | 'facebookAppId'> = {},
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('facebook', doc, form, common, content, opts, lang);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('facebook', input, lang);
  return { handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText }, report: r.report };
}

export function createFacebookAdapter(
  opts: FacebookAdapterOptions = {}
): Adapter<typeof facebookSchema> {
  const ref = facebookRef(opts.links);
  const base = opts.assetBase ? { assetBase: opts.assetBase } : {};
  const renderOpts = (lang?: SdkLang) => ({ ...base, ...(lang ? { lang } : {}) });
  const shareOpts = {
    ...base,
    ...(opts.facebookAppId ? { facebookAppId: opts.facebookAppId } : {}),
  };
  return defineAdapter({
    key: 'facebook',
    label: 'Facebook',
    runtimes: opts.runtimes ?? platformMeta('facebook')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: facebookBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: facebookSchema,
    schemaFor: facebookSchemaFor,
    maxConcurrent: 2,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderFacebook(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        report: r.report,
        ...(r.followUp ? { followUp: r.followUp } : {}),
      };
    },
    renderRequest({ doc, form, common, content, lang }) {
      const r = renderFacebook(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, undefined, undefined, r.report, r.followUp);
    },
    // SPEC-r12 §2.2: the Page's comment on the post (`/{post-id}/comments`), through the relay
    followUp(post, input, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'facebook', ctx);
        return relayFollowUp(ctx, ref, post, input, { credential });
      });
    },
    renderHandoff({ doc, form, common, content, lang }) {
      return facebookHandoff(doc, form, common, content, shareOpts, lang);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderFacebook(doc, form, common, content, renderOpts(ctx.lang));
        const t = msg(ctx.lang);
        if (!r.text.trim() && !r.body.link)
          throw helpError(refIn(ref, ctx.lang), t.empty, { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous, ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.posting });
        const credential = await credentialOf(opts.credential, 'facebook', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
