/**
 * Telegram (Bot API ✅ core.telegram.org/bots/api, SPEC-r11 §10): the user's own bot posts a link card to a channel
 * or group. Bound with a token (`POST /me/platform-accounts/telegram/connect`): `bot_token` from @BotFather and
 * `chat_id` (`@channel` or a numeric id); 辰记's API checks `getMe`, `getChat` and `getChatMember(bot)` — the bot
 * must be an administrator, in a channel with `can_post_messages`.
 *
 * The post: `sendPhoto` with an HTML caption (≤ 1024 ✅) when there is a cover, else `sendMessage` (HTML, ≤ 4096 ✅)
 * with the link preview on. Title + summary + topics + the 辰记 link, fitted to the limit (「只发引流卡片」).
 * `external_id = chat_id:message_id`; a public channel's link is `https://t.me/<username>/<message_id>`.
 *
 * Not bound: the existing `t.me/share/url` hand-off (`@starnote/publish-share`).
 *
 * ⚠️ 待核实：Telegram 的长度按 UTF-16 码元计（实体解析后）；这里按码点计，emoji 多时可能略超。
 */
import {
  defineAdapter,
  escapeHtml,
  mediaReport,
  mergeReports,
  platformMeta,
} from '@starnote/publish-core';
import {
  cardOf,
  fitPost,
  guard,
  helpError,
  missingLinkReport,
  newPostReport,
  relayPublish,
  relayRequestOf,
} from '@starnote/publish-kit';
import { buildShare, shareInputOf } from '@starnote/publish-share';
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
import type {
  ErrorLinks,
  PlatformRef,
  RequestDescription,
  VerifiedAccount,
} from '@starnote/publish-kit';

export const TELEGRAM_API = 'https://api.telegram.org';

export const TELEGRAM_LIMITS = {
  /** ✅ sendMessage `text`: 1–4096 characters after entities parsing. */
  textMax: 4096,
  /** ✅ sendPhoto `caption`: 0–1024 characters after entities parsing. */
  captionMax: 1024,
  maxTags: 3,
} as const;

const URL_RE = /^https?:\/\/\S+$/;

export const telegramSchema = z.object({
  /** Your own text instead of title + summary (still fitted to the limit). */
  text: z.string().trim().max(5000).optional().describe('消息文案'),
  link: z
    .string()
    .trim()
    .regex(URL_RE, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('链接'),
  include_summary: z.boolean().default(true).describe('带上摘要'),
  include_tags: z.boolean().default(true).describe('带上话题'),
  /** With a cover: a photo message (caption ≤ 1024); off: a text message with the link preview. */
  with_cover: z.boolean().default(true).describe('带封面图'),
  silent: z.boolean().default(false).describe('静默发送'),
});

export type TelegramForm = z.infer<typeof telegramSchema>;
export type TelegramFormInput = z.input<typeof telegramSchema>;

/** The binding form: what the user pastes (validated again by the server with `getMe` / `getChatMember`). */
export const telegramTokenForm = z.object({
  bot_token: z
    .string()
    .trim()
    .regex(
      /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/,
      '机器人令牌形如 123456789:AA…（在 @BotFather 里获取）'
    )
    .describe('机器人令牌'),
  chat_id: z
    .string()
    .trim()
    .regex(
      /^(@[A-Za-z][A-Za-z0-9_]{4,31}|-?\d{5,20})$/,
      '填写 @频道用户名，或数字 ID（私有频道 / 群）'
    )
    .describe('频道 / 群'),
});

export type TelegramCredentials = z.infer<typeof telegramTokenForm>;

export const telegramBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'telegram',
  fields: ['bot_token', 'chat_id'],
  form: telegramTokenForm,
  createUrl: 'https://t.me/BotFather',
  permissions: [
    '频道：把机器人设为管理员，并打开「发布消息」权限',
    '群组：把机器人拉进群（建议设为管理员）',
  ],
  helpUrl: 'https://core.telegram.org/bots/features#botfather',
  instructions: [
    '在 Telegram 里找 @BotFather，发送 /newbot 创建机器人，复制它给的令牌',
    '把机器人加进你的频道（或群），设为管理员并允许「发布消息」',
    '填写令牌和频道：公开频道写 @用户名，私有频道 / 群写数字 ID（以 -100 开头）',
    '令牌加密存在辰记服务器，用来到点代发；不用时在这里解绑，并可在 @BotFather 里 /revoke 令牌',
  ],
};

/** `sendMessage` / `sendPhoto` without `chat_id` (the server adds it from the bound account). */
export type TelegramSendBody =
  | {
      method: 'sendMessage';
      text: string;
      parse_mode: 'HTML';
      link_preview_options?: { url: string; prefer_large_media?: boolean };
      disable_notification?: boolean;
    }
  | {
      method: 'sendPhoto';
      photo: string;
      caption: string;
      parse_mode: 'HTML';
      disable_notification?: boolean;
    };

export interface TelegramRendered {
  /** The message as the reader sees it (no HTML). */
  text: string;
  html: string;
  body: TelegramSendBody;
  report: ReportItem[];
}

export interface TelegramRenderOptions {
  assetBase?: string;
}

/** Pure: the Bot API call body and the predicted report (articles, short texts, image sets). */
export function renderTelegram(
  doc: Doc,
  form: TelegramForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: TelegramRenderOptions = {}
): TelegramRendered {
  const card = cardOf(doc, common, content, {
    assetBase: opts.assetBase,
    text: form.text,
    link: form.link,
  });
  const report: ReportItem[] = [];
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('telegram', 'Telegram', content, common));
  const photo = form.with_cover ? card.cover : undefined;
  const limit = photo ? TELEGRAM_LIMITS.captionMax : TELEGRAM_LIMITS.textMax;
  const ownText = !!card.text;
  const allTags = form.include_tags ? card.tags : [];
  const fit = fitPost({
    head: card.text ?? card.title,
    ...(form.include_summary && !ownText ? { summary: card.summary } : {}),
    tags: allTags.slice(0, TELEGRAM_LIMITS.maxTags),
    ...(card.link ? { link: card.link } : {}),
    limit,
  });
  // HTML: the title bold, everything escaped; the link stays a bare URL (Telegram links it and previews it).
  const html = [
    [ownText ? escapeHtml(fit.head) : `<b>${escapeHtml(fit.head)}</b>`, escapeHtml(fit.summary)]
      .filter(Boolean)
      .join('\n\n'),
    escapeHtml(fit.tags.map((t) => `#${t}`).join(' ')),
    card.link ? escapeHtml(card.link) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (fit.truncated)
    report.push({
      kind: 'share.truncated',
      level: 'notice',
      text: `Telegram ${photo ? '图片说明最多 1024 字' : '消息最多 4096 字'}，已截短`,
    });
  const dropped = allTags.length - fit.tags.length;
  if (dropped > 0)
    report.push({
      kind: 'tags.trimmed',
      text: `话题保留 ${fit.tags.length} 个，去掉 ${dropped} 个`,
      count: dropped,
    });
  if (card.link)
    report.push({
      kind: 'link.card',
      text: photo ? '以封面图消息发出，文末附原文链接' : 'Telegram 会按链接生成预览卡片',
      detail: { url: card.link },
    });
  else report.push(missingLinkReport('Telegram'));

  const silent = form.silent ? { disable_notification: true } : {};
  const body: TelegramSendBody = photo
    ? { method: 'sendPhoto', photo, caption: html, parse_mode: 'HTML', ...silent }
    : {
        method: 'sendMessage',
        text: html,
        parse_mode: 'HTML',
        ...(card.link
          ? { link_preview_options: { url: card.link, prefer_large_media: true } }
          : {}),
        ...silent,
      };
  return { text: fit.text, html, body, report };
}

/** A public channel's message link (`null` for private chats, which have no public link). */
export function telegramPostUrl(
  chat: { username?: string | null },
  messageId: number | string
): string | null {
  return chat.username ? `https://t.me/${chat.username.replace(/^@/, '')}/${messageId}` : null;
}

export function telegramRef(links?: ErrorLinks): PlatformRef {
  return { key: 'telegram', label: 'Telegram', ...(links ? { links } : {}) };
}

/** What 辰记's API calls (documentation the Python side follows). */
export const TELEGRAM_REQUESTS = {
  getMe: { method: 'GET', url: `${TELEGRAM_API}/bot<bot_token>/getMe`, auth: 'token in the path' },
  getChat: {
    method: 'GET',
    url: `${TELEGRAM_API}/bot<bot_token>/getChat?chat_id=<chat_id>`,
    auth: 'token in the path',
  },
  getChatMember: {
    method: 'GET',
    url: `${TELEGRAM_API}/bot<bot_token>/getChatMember?chat_id=<chat_id>&user_id=<bot id>`,
    auth: 'token in the path',
    body: "status must be 'administrator' (channel: can_post_messages) or 'creator'",
  },
  sendMessage: {
    method: 'POST',
    url: `${TELEGRAM_API}/bot<bot_token>/sendMessage`,
    auth: 'token in the path',
    body: 'TelegramSendBody (method dropped) + chat_id',
  },
  sendPhoto: {
    method: 'POST',
    url: `${TELEGRAM_API}/bot<bot_token>/sendPhoto`,
    auth: 'token in the path',
    body: 'TelegramSendBody (method dropped) + chat_id',
  },
} as const satisfies Record<string, RequestDescription>;

/** What the verify step stores on the account (`account_key = bot_id:chat_id`, SPEC-r11 §5.1). */
export type TelegramVerified = VerifiedAccount & {
  meta: {
    bot_id: string;
    bot_username: string;
    chat_id: string;
    chat_type: string;
    username?: string;
  };
};

/* ---------------- adapter ---------------- */

export interface TelegramAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
}

/** The share-intent hand-off when no bot is bound. */
export function telegramHandoff(
  doc: Doc,
  form: TelegramForm,
  common: CommonFormShape,
  content: PublishContent | undefined,
  opts: TelegramRenderOptions = {}
): { handoff: PublishHandoff; report: ReportItem[] } {
  const input = shareInputOf('telegram', doc, form, common, content, opts);
  if ('error' in input) throw new Error(input.error);
  const r = buildShare('telegram', input);
  return { handoff: { via: r.via, openUrl: r.openUrl, copyText: r.copyText }, report: r.report };
}

export function createTelegramAdapter(
  opts: TelegramAdapterOptions = {}
): Adapter<typeof telegramSchema> {
  const ref = telegramRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'telegram',
    label: 'Telegram',
    runtimes: opts.runtimes ?? platformMeta('telegram')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: telegramBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: telegramSchema,
    maxConcurrent: 3,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderTelegram(doc, form, common, content, renderOpts);
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        previewHtml: r.html.replace(/\n/g, '<br>'),
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content }) {
      const r = renderTelegram(doc, form, common, content, renderOpts);
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content }) {
      return telegramHandoff(doc, form, common, content, renderOpts);
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderTelegram(doc, form, common, content, renderOpts);
        if (!r.text.trim()) throw helpError(ref, '消息是空的', { code: 'invalid' });
        const report = [...r.report, ...newPostReport(ctx.previous)];
        ctx.emit({ type: 'report', items: report });
        ctx.emit({ type: 'progress', percent: 40, text: '由机器人发到 Telegram' });
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body);
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report: mergeReports(report, res.report),
        };
      });
    },
  });
}
