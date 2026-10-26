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
import { defineAdapter, mediaReport, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  appendLink,
  cardOf,
  codePoints,
  guard,
  helpError,
  missingLinkReport,
  newPostReport,
  relayPublish,
  relayRequestOf,
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
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
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

export const discordSchema = z.object({
  /** A line above the card (the card itself carries title, summary, link and cover). */
  text: z.string().trim().max(DISCORD_LIMITS.contentMax).optional().describe('附言'),
  link: z
    .string()
    .trim()
    .regex(URL_RE, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  include_summary: z.boolean().default(true).describe('卡片带摘要'),
  with_cover: z.boolean().default(true).describe('卡片带封面图'),
  /** Overrides the webhook's name for this message. */
  username: z.string().trim().max(DISCORD_LIMITS.usernameMax).optional().describe('显示名称'),
});

export type DiscordForm = z.infer<typeof discordSchema>;
export type DiscordFormInput = z.input<typeof discordSchema>;

export const discordWebhookForm = z.object({
  webhook_url: z
    .string()
    .trim()
    .regex(DISCORD_WEBHOOK_RE, '请粘贴 https://discord.com/api/webhooks/… 形式的 Webhook 地址')
    .describe('Webhook 地址'),
});

export const discordBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'discord',
  fields: ['webhook_url'],
  form: discordWebhookForm,
  createUrl: 'https://support.discord.com/hc/en-us/articles/228383668',
  permissions: ['在频道设置里「管理 Webhook」的权限'],
  instructions: [
    '打开要发到的频道 → 编辑频道 → 整合（Integrations）→ Webhook → 新 Webhook',
    '给它起个名字、选好头像，点「复制 Webhook URL」，粘贴到这里',
    '地址相当于发帖凭据：加密存在辰记服务器，不要发给别人；不用时在 Discord 里删除这个 Webhook',
  ],
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
  opts: { assetBase?: string } = {}
): DiscordRendered {
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('discord', 'Discord', content, common));
  const rawTitle = card.title || card.text || 'Untitled';
  const title = truncate(rawTitle, DISCORD_LIMITS.titleMax);
  if (title !== rawTitle)
    report.push({
      kind: 'title.truncated',
      text: `Discord 卡片标题最多 ${DISCORD_LIMITS.titleMax} 字，已截短`,
    });
  let description = form.include_summary ? card.summary : '';
  if (codePoints(description) > DISCORD_LIMITS.cardDescriptionMax) {
    description = truncate(description, DISCORD_LIMITS.cardDescriptionMax);
    report.push({
      kind: 'summary.truncated',
      text: `卡片摘要按 ${DISCORD_LIMITS.cardDescriptionMax} 字截短`,
    });
  }
  // The user's line (form text / short text), never the title again.
  let line = card.text && card.text !== title ? card.text : '';
  if (codePoints(line) > DISCORD_LIMITS.contentMax) {
    line = truncate(line, DISCORD_LIMITS.contentMax);
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `Discord 消息最多 ${DISCORD_LIMITS.contentMax} 字，已截短`,
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
      text: '以卡片发出：标题链接到原文',
      detail: { url: card.link },
    });
  else report.push(missingLinkReport('Discord'));
  report.push({ kind: 'mentions.disabled', text: '不会 @ 任何人（发送时关闭 allowed_mentions）' });

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
export function discordHandoff(r: DiscordRendered): {
  handoff: PublishHandoff;
  report: ReportItem[];
} {
  return {
    handoff: { via: 'copy', openUrl: DISCORD_APP_URL, copyText: r.text },
    report: [
      {
        kind: 'handoff.pending',
        level: 'notice',
        text: '还没有绑定 Discord Webhook：文案已备好，请到频道里粘贴发出',
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
  const ref = discordRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'discord',
    label: 'Discord',
    runtimes: opts.runtimes ?? platformMeta('discord')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: discordBinding,
    capabilities: { supportsUpdate: false, needsLogin: true, titleMax: DISCORD_LIMITS.titleMax },
    schema: discordSchema,
    maxConcurrent: 3,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderDiscord(doc, form, common, content, renderOpts);
      return { format: 'text', title: r.body.embeds[0]!.title, body: r.text, report: r.report };
    },
    renderRequest({ doc, form, common, content }) {
      const r = renderDiscord(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content }) {
      return discordHandoff(renderDiscord(doc, form, common, content, renderOpts));
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderDiscord(doc, form, common, content, renderOpts);
        if (!r.text.trim()) throw helpError(ref, '消息是空的', { code: 'invalid' });
        r.report.push(...newPostReport(ctx.previous));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '经 Webhook 发到 Discord' });
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body);
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
