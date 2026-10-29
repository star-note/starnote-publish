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
  byLang,
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
  refIn,
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
  PublishContent,
  PublishHandoff,
  ReportItem,
  RuntimeSupport,
  SdkLang,
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

/** The form in a language (SPEC-r14 B5): labels and messages from `msg(lang)`. */
export const telegramSchemaFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    /** Your own text instead of title + summary (still fitted to the limit). */
    text: z.string().trim().max(5000).optional().describe(t.text),
    link: z.string().trim().regex(URL_RE, t.httpUrl).optional().describe(t.link),
    include_summary: z.boolean().default(true).describe(t.includeSummary),
    include_tags: z.boolean().default(true).describe(t.includeTags),
    /** With a cover: a photo message (caption ≤ 1024); off: a text message with the link preview. */
    with_cover: z.boolean().default(true).describe(t.withCover),
    silent: z.boolean().default(false).describe(t.silent),
  });
});

export const telegramSchema = telegramSchemaFor('zh-CN');

export type TelegramForm = z.infer<typeof telegramSchema>;
export type TelegramFormInput = z.input<typeof telegramSchema>;

/** The binding form: what the user pastes (validated again by the server with `getMe` / `getChatMember`). */
export const telegramTokenFormFor = byLang((lang) => {
  const t = msg(lang).form;
  return z.object({
    bot_token: z
      .string()
      .trim()
      .regex(/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/, t.tokenHint)
      .describe(t.token),
    chat_id: z
      .string()
      .trim()
      .regex(/^(@[A-Za-z][A-Za-z0-9_]{4,31}|-?\d{5,20})$/, t.chatHint)
      .describe(t.chat),
  });
});

export const telegramTokenForm = telegramTokenFormFor('zh-CN');

export type TelegramCredentials = z.infer<typeof telegramTokenForm>;

export const telegramBinding: BindingSpec = {
  kind: 'token',
  store: 'server',
  provider: 'telegram',
  fields: ['bot_token', 'chat_id'],
  form: telegramTokenForm,
  formFor: telegramTokenFormFor,
  createUrl: 'https://t.me/BotFather',
  permissions: msg('zh-CN').permissions,
  permissionsFor: (lang) => msg(lang).permissions,
  helpUrl: 'https://core.telegram.org/bots/features#botfather',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
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
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang;
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
  const ui = opts.lang;
  const t = msg(ui);
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('telegram', 'Telegram', content, common, ui));
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
      text: t.truncated(!!photo),
    });
  const dropped = allTags.length - fit.tags.length;
  if (dropped > 0)
    report.push({
      kind: 'tags.trimmed',
      text: t.tagsTrimmed(fit.tags.length, dropped),
      count: dropped,
    });
  if (card.link)
    report.push({
      kind: 'link.card',
      text: photo ? t.photoCard : t.linkCard,
      detail: { url: card.link },
    });
  else report.push(missingLinkReport('Telegram', ui));

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
  const baseRef = telegramRef(opts.links);
  const renderOpts = (lang?: SdkLang): TelegramRenderOptions => ({
    ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    ...(lang ? { lang } : {}),
  });
  return defineAdapter({
    key: 'telegram',
    label: 'Telegram',
    runtimes: opts.runtimes ?? platformMeta('telegram')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['short-text', 'article'],
    binding: telegramBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: telegramSchema,
    schemaFor: telegramSchemaFor,
    maxConcurrent: 3,
    preview(doc, form, common, content, popts): AdapterPreview {
      const r = renderTelegram(doc, form, common, content, renderOpts(popts?.lang));
      return {
        format: 'text',
        title: common?.title || doc.title,
        body: r.text,
        previewHtml: r.html.replace(/\n/g, '<br>'),
        report: r.report,
      };
    },
    renderRequest({ doc, form, common, content, lang }) {
      const r = renderTelegram(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content, lang }) {
      return telegramHandoff(doc, form, common, content, renderOpts(lang));
    },
    publish({ doc, form, common, ctx, content }) {
      const ref = refIn(baseRef, ctx.lang);
      const t = msg(ctx.lang);
      return guard(ctx, ref, async () => {
        const r = renderTelegram(doc, form, common, content, renderOpts(ctx.lang));
        if (!r.text.trim()) throw helpError(ref, t.empty, { code: 'invalid' });
        const report = [...r.report, ...newPostReport(ctx.previous, ctx.lang)];
        ctx.emit({ type: 'report', items: report });
        ctx.emit({ type: 'progress', percent: 40, text: t.sending });
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body);
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
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
