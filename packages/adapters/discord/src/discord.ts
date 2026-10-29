/**
 * Discord (channel webhook ✅ discord.com/developers/docs/resources/webhook#execute-webhook, SPEC-r11 §10): the user
 * creates a webhook in the channel's settings (集成 → Webhook) and pastes its URL. 辰记's API keeps it, checks it with
 * `GET {webhook}` (name, channel_id, guild_id) and posts `POST {webhook}?wait=true` with `content` and one embed
 * (title, description, link, image); the sender forces `allowed_mentions: { parse: [] }` (nobody is pinged).
 *
 * `external_id = message.id`; the link is `https://discord.com/channels/{guild}/{channel}/{id}`.
 *
 * Not bound: copy the text and paste it in Discord (`via: 'copy'`).
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

export const DISCORD_LIMITS = {
  /** ✅ message `content` up to 2000 characters. */
  contentMax: 2000,
  /** ✅ embed title 256, description 4096; all embeds of a message 6000 together. */
  titleMax: 256,
  descriptionMax: 4096,
  embedTotalMax: 6000,
  /** Our choice: a card, not the article — the description is the summary, about a paragraph. */
  cardDescriptionMax: 350,
  /** ✅ webhook `username` override: 1–80 characters. */
  usernameMax: 80,
} as const;

/**
 * Only Discord's own webhook endpoints (discord.com / discordapp.com, also canary. / ptb., optional `/v{n}`) — the
 * same rule as the server's whitelist.
 */
export const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,128}$/;

export const DISCORD_APP_URL = 'https://discord.com/channels/@me';

const URL_RE = /^https?:\/\/\S+$/;

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const discordSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** A line above the card (the card itself carries title, summary, link and cover). */
    text: z.string().trim().max(DISCORD_LIMITS.contentMax).optional().describe(t.text),
    link: z.string().trim().regex(URL_RE, t.httpUrl).optional().describe(t.link),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    with_cover: z.boolean().default(true).describe(t.withCover),
    /** Overrides the webhook's name for this message. */
    username: z.string().trim().max(DISCORD_LIMITS.usernameMax).optional().describe(t.username),
  });
});

export const discordSchema = discordSchemaFor('zh-CN');

export type DiscordForm = z.infer<typeof discordSchema>;
export type DiscordFormInput = z.input<typeof discordSchema>;

export const discordWebhookFormFor = byLang((lang) =>
  z.object({
    webhook_url: z
      .string()
      .trim()
      .regex(DISCORD_WEBHOOK_RE, msg(lang).form.webhookHint)
      .describe(msg(lang).form.webhook),
  })
);

export const discordWebhookForm = discordWebhookFormFor('zh-CN');

export const discordBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'discord',
  fields: ['webhook_url'],
  form: discordWebhookForm,
  formFor: discordWebhookFormFor,
  createUrl: 'https://support.discord.com/hc/en-us/articles/228383668',
  permissions: msg('zh-CN').permissions,
  permissionsFor: (lang) => msg(lang).permissions,
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  image?: { url: string };
}

export interface DiscordWebhookBody {
  content?: string;
  /** At most one. */
  embeds: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

export interface DiscordRendered {
  /** What the copy-paste fallback copies. */
  text: string;
  body: DiscordWebhookBody;
  report: ReportItem[];
}

/** Pure: the webhook body (content + one embed card) and the predicted report. */
export function renderDiscord(
  doc: Doc,
  form: DiscordForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; lang?: SdkLang } = {}
): DiscordRendered {
  const ui = opts.lang;
  const t = msg(ui);
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('discord', 'Discord', content, common, ui));
  const rawTitle = card.title || card.text || 'Untitled';
  const title = truncate(rawTitle, DISCORD_LIMITS.titleMax);
  if (title !== rawTitle)
    report.push({
      kind: 'title.truncated',
      text: t.titleTruncated(DISCORD_LIMITS.titleMax),
    });
  let description = form.include_summary ? card.summary : '';
  if (codePoints(description) > DISCORD_LIMITS.cardDescriptionMax) {
    description = truncate(description, DISCORD_LIMITS.cardDescriptionMax);
    report.push({
      kind: 'summary.truncated',
      text: t.summaryTruncated(DISCORD_LIMITS.cardDescriptionMax),
    });
  }
  // The user's line (form text / short text), never the title again.
  let line = card.text && card.text !== title ? card.text : '';
  if (codePoints(line) > DISCORD_LIMITS.contentMax) {
    line = truncate(line, DISCORD_LIMITS.contentMax);
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: t.messageTruncated(DISCORD_LIMITS.contentMax),
    });
  }
  const image = form.with_cover ? card.cover : undefined;
  const embed: DiscordEmbed = {
    title,
    ...(description ? { description } : {}),
    ...(card.link ? { url: card.link } : {}),
    ...(image ? { image: { url: image } } : {}),
  };
  if (card.link)
    report.push({
      kind: 'link.card',
      text: t.card,
      detail: { url: card.link },
    });
  else report.push(missingLinkReport('Discord', ui));
  report.push({ kind: 'mentions.disabled', text: t.noMentions });

  // the copy fallback: cut before the link, never through it
  const text = appendLink(
    [line, title, description].filter(Boolean).join('\n\n'),
    card.link,
    DISCORD_LIMITS.contentMax
  );
  return {
    text,
    body: {
      ...(line ? { content: line } : {}),
      embeds: [embed],
      ...(form.username ? { username: form.username } : {}),
    },
    report,
  };
}

/** The message link. */
export function discordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function discordRef(links?: ErrorLinks): PlatformRef {
  return { key: 'discord', label: 'Discord', ...(links ? { links } : {}) };
}

export const DISCORD_REQUESTS = {
  verify: { method: 'GET', url: '<webhook_url>', auth: 'the URL is the credential' },
  execute: {
    method: 'POST',
    url: '<webhook_url>?wait=true',
    auth: 'the URL is the credential',
    body: 'DiscordWebhookBody + allowed_mentions: { parse: [] } (forced by the sender)',
  },
} as const satisfies Record<string, RequestDescription>;

/** Not bound: copy the text, open Discord. */
export function discordHandoff(
  r: DiscordRendered,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): {
  handoff: PublishHandoff;
  report: ReportItem[];
} {
  return {
    handoff: { via: 'copy', openUrl: DISCORD_APP_URL, copyText: r.text },
    report: [
      {
        kind: 'handoff.pending',
        level: 'notice',
        text: msg(lang).handoff,
        detail: { via: 'copy', openUrl: DISCORD_APP_URL, copyText: r.text },
      },
    ],
  };
}

export interface DiscordAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

export function createDiscordAdapter(
  opts: DiscordAdapterOptions = {}
): Adapter<typeof discordSchema> {
  const baseRef = discordRef(opts.links);
  const renderOpts = (lang?: SdkLang) => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'discord',
    label: 'Discord',
    runtimes: opts.runtimes ?? platformMeta('discord')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: discordBinding,
    capabilities: { supportsUpdate: false, needsLogin: true, titleMax: DISCORD_LIMITS.titleMax },
    schema: discordSchema,
    schemaFor: discordSchemaFor,
    maxConcurrent: 3,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderDiscord(doc, form, common, content, renderOpts(popts?.lang));
      return { format: 'text', title: r.body.embeds[0]!.title, body: r.text, report: r.report };
    },
    renderRequest({ doc, form, common, content, lang }) {
      const r = renderDiscord(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content, lang }) {
      return discordHandoff(renderDiscord(doc, form, common, content, renderOpts(lang)), lang);
    },
    publish({ doc, form, common, ctx, content }) {
      const ref = refIn(baseRef, ctx.lang);
      const t = msg(ctx.lang);
      return guard(ctx, ref, async () => {
        const r = renderDiscord(doc, form, common, content, renderOpts(ctx.lang));
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
