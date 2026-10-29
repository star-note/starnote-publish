/**
 * Slack (incoming webhook ✅ api.slack.com/messaging/webhooks, SPEC-r11 §10): the user adds the 「Incoming Webhooks」
 * app to a channel and pastes the `https://hooks.slack.com/services/…` URL; only its shape is checked and the user
 * names it (`label`). 辰记's API posts Block Kit blocks: the title linked to the original, the summary, the cover.
 *
 * A webhook answers `ok` and nothing else: no message id, no link. 辰记 stores `external_id` =
 * `sha256(url + ts)`[:16] and an empty `url`; the report says `link.unavailable`.
 *
 * Not bound: copy the text and paste it in Slack (`via: 'copy'`).
 */
import {
  byLang,
  defineAdapter,
  mediaReport,
  mergeReports,
  platformMeta,
} from '@starnote/publish-core';
import {
  appendLink,
  cardOf,
  codePoints,
  guard,
  helpError,
  linkCost,
  missingLinkReport,
  newPostReport,
  refIn,
  relayPublish,
  relayRequestOf,
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
  PublishContent,
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
  SdkLang,
} from '@starnote/publish-core';
import type { ErrorLinks, PlatformRef, RequestDescription } from '@starnote/publish-kit';

export const SLACK_LIMITS = {
  /** ✅ a section block's `text`: up to 3000 characters. */
  sectionMax: 3000,
  /** ✅ image block / accessory `alt_text`: up to 2000 characters. */
  altMax: 2000,
  /** Our choice: the card title is cut here (the summary gets the rest of the section). */
  titleMax: 300,
  /** Our choice: a card — the summary is about a paragraph. */
  cardSummaryMax: 350,
} as const;

/** The same rule as the server's whitelist (⚠️ 段长取经验值：T… / B… / token）。 */
export const SLACK_WEBHOOK_RE =
  /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]{8,32}\/[A-Z0-9]{8,32}\/[A-Za-z0-9]{8,64}$/;

export const SLACK_APP_URL = 'https://app.slack.com/client';

const URL_RE = /^https?:\/\/\S+$/;

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const slackSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** A line above the card. */
    text: z.string().trim().max(SLACK_LIMITS.sectionMax).optional().describe(t.text),
    link: z.string().trim().regex(URL_RE, t.httpUrl).optional().describe(t.link),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    with_cover: z.boolean().default(true).describe(t.withCover),
  });
});

export const slackSchema = slackSchemaFor('zh-CN');

export type SlackForm = z.infer<typeof slackSchema>;
export type SlackFormInput = z.input<typeof slackSchema>;

export const slackWebhookFormFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    webhook_url: z.string().trim().regex(SLACK_WEBHOOK_RE, t.webhookHint).describe(t.webhook),
    /** A webhook does not say where it posts: the user names it (「#announcements @ Acme」). */
    label: z.string().trim().min(1, t.labelHint).max(100).describe(t.label),
  });
});

export const slackWebhookForm = slackWebhookFormFor('zh-CN');

export const slackBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'slack',
  fields: ['webhook_url', 'label'],
  form: slackWebhookForm,
  formFor: slackWebhookFormFor,
  createUrl: 'https://api.slack.com/messaging/webhooks',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

/** Slack mrkdwn escaping (✅ only `&`, `<`, `>` are control characters). */
export function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SlackBlock =
  | {
      type: 'section';
      text: { type: 'mrkdwn'; text: string };
      accessory?: { type: 'image'; image_url: string; alt_text: string };
    }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> };

export interface SlackWebhookBody {
  /** The notification / fallback text. */
  text: string;
  blocks: SlackBlock[];
  unfurl_links: boolean;
  unfurl_media: boolean;
}

export interface SlackRendered {
  /** Plain text (what the copy fallback copies). */
  text: string;
  body: SlackWebhookBody;
  report: ReportItem[];
}

/** Pure: the Block Kit body and the predicted report. */
export function renderSlack(
  doc: Doc,
  form: SlackForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; lang?: SdkLang } = {}
): SlackRendered {
  const ui = opts.lang;
  const t = msg(ui);
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('slack', 'Slack', content, common, ui));
  const title = card.title || card.text || 'Untitled';
  let summary = form.include_summary ? card.summary : '';
  if (codePoints(summary) > SLACK_LIMITS.cardSummaryMax) {
    summary = truncate(summary, SLACK_LIMITS.cardSummaryMax);
    report.push({
      kind: 'summary.truncated',
      text: t.summaryTruncated(SLACK_LIMITS.cardSummaryMax),
    });
  }
  const line = card.text && card.text !== title ? card.text : '';
  const shownTitle = truncate(title, SLACK_LIMITS.titleMax);
  const titleMd = card.link
    ? `*<${card.link}|${slackEscape(shownTitle).replace(/\|/g, '｜')}>*`
    : `*${slackEscape(shownTitle)}*`;
  // Only the summary is shortened: the link inside the title stays whole (placeholder budgeted at its real length).
  const titleCost =
    codePoints(titleMd) + (card.link ? linkCost(card.link) - codePoints(card.link) : 0);
  const budget = SLACK_LIMITS.sectionMax - titleCost - 1;
  let shortSummary = summary;
  while (shortSummary && codePoints(slackEscape(shortSummary)) > budget)
    shortSummary =
      budget > 20 ? truncate(shortSummary, Math.max(1, codePoints(shortSummary) - 20)) : '';
  const cardText = [titleMd, slackEscape(shortSummary)].filter(Boolean).join('\n');
  if (shortSummary !== summary || shownTitle !== title) {
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: t.sectionTruncated(SLACK_LIMITS.sectionMax),
    });
  }
  const image = form.with_cover ? card.cover : undefined;
  const blocks: SlackBlock[] = [
    ...(line
      ? [
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: truncate(slackEscape(line), SLACK_LIMITS.sectionMax),
            },
          },
        ]
      : []),
    {
      type: 'section',
      text: { type: 'mrkdwn', text: cardText },
      ...(image
        ? {
            accessory: {
              type: 'image' as const,
              image_url: image,
              alt_text: truncate(common.coverAlt || title, SLACK_LIMITS.altMax),
            },
          }
        : {}),
    },
  ];
  if (card.link) report.push({ kind: 'link.card', text: t.card, detail: { url: card.link } });
  else report.push(missingLinkReport('Slack', ui));
  report.push({
    kind: 'link.unavailable',
    level: 'notice',
    text: t.noMessageLink,
  });
  const text = [line, title, summary, card.link ?? ''].filter(Boolean).join('\n\n');
  return {
    text,
    body: {
      text: appendLink(line || title, card.link, SLACK_LIMITS.sectionMax, ' '),
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    },
    report,
  };
}

export function slackRef(links?: ErrorLinks): PlatformRef {
  return { key: 'slack', label: 'Slack', ...(links ? { links } : {}) };
}

export const SLACK_REQUESTS = {
  post: {
    method: 'POST',
    url: '<webhook_url>',
    auth: 'the URL is the credential',
    body: 'SlackWebhookBody → 200 "ok"; external_id = sha256(url + ts)[:16], url empty',
  },
} as const satisfies Record<string, RequestDescription>;

/** Not bound: copy the text, open Slack. */
export function slackHandoff(
  r: SlackRendered,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): { handoff: PublishHandoff; report: ReportItem[] } {
  return {
    handoff: { via: 'copy', openUrl: SLACK_APP_URL, copyText: r.text },
    report: [
      {
        kind: 'handoff.pending',
        level: 'notice',
        text: msg(lang).handoff,
        detail: { via: 'copy', openUrl: SLACK_APP_URL, copyText: r.text },
      },
    ],
  };
}

export interface SlackAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

export function createSlackAdapter(opts: SlackAdapterOptions = {}): Adapter<typeof slackSchema> {
  const baseRef = slackRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'slack',
    label: 'Slack',
    runtimes: opts.runtimes ?? platformMeta('slack')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: slackBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: slackSchema,
    schemaFor: slackSchemaFor,
    maxConcurrent: 3,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderSlack(doc, form, common, content, renderOpts(popts?.lang));
      return { format: 'text', title: common?.title || doc.title, body: r.text, report: r.report };
    },
    renderRequest({ doc, form, common, content, lang }) {
      const r = renderSlack(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content, lang }) {
      return slackHandoff(renderSlack(doc, form, common, content, renderOpts(lang)), lang);
    },
    publish({ doc, form, common, ctx, content }) {
      const ref = refIn(baseRef, ctx.lang);
      const t = msg(ctx.lang);
      return guard(ctx, ref, async () => {
        const r = renderSlack(doc, form, common, content, renderOpts(ctx.lang));
        if (!r.text.trim()) throw helpError(ref, t.empty, { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous, ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: t.sending });
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body);
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
