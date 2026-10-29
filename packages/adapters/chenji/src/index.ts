import { byLang } from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  CoverVariants,
  Doc,
  PrefillContext,
  RuntimeSupport,
} from '@starnote/publish-core';

/**
 * The blog's own category (SPEC-r3 §A): an existing one by id, or a new one by name — the API
 * creates it on first use. Blog categories are the blogger's free-form 栏目, not the public taxonomy.
 */
export const blogCategoryRefFor = byLang((lang) => {
  const t = msg(lang);
  return z.union(
    [
      z.object({ id: z.string().min(1, t.pickCategory) }),
      z.object({ name: z.string().trim().min(1, t.categoryName).max(40, t.categoryNameMax) }),
    ],
    { error: t.pickCategory }
  );
});

export const blogCategoryRef = blogCategoryRefFor('zh-CN');

export type BlogCategoryRef = z.infer<typeof blogCategoryRef>;

/** Who can read a published post (SPEC-r3 §B): everyone, holders of the 提取码, or only the author. */
export const VISIBILITIES = ['public', 'password'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** A translation published with the post (r9): the blog serves it at `/@handle/{short_id}/{lang}`. */
export const translationSchema = z.object({
  title: z.string().trim().min(1).max(255),
  html: z.string().min(1),
  summary: z.string().max(2000).optional(),
  toc: z.array(z.object({ id: z.string(), level: z.number(), text: z.string() })).optional(),
});
export type ChenjiTranslation = z.infer<typeof translationSchema>;

/** The form in a language (SPEC-r14 B5). */
export const chenjiSchemaFor = byLang((lang) =>
  z.object({
    category: blogCategoryRefFor(lang).describe(msg(lang).category),
    visibility: z.enum(VISIBILITIES).default('public'),
    show_in_blog: z.boolean().default(true),
    /** `{en: {...}}` saves / replaces that language, `{en: null}` removes it; absent = unchanged (r9 译文). */
    translations: z
      .record(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), translationSchema.nullable())
      .optional(),
  })
);

export const chenjiSchema = chenjiSchemaFor('zh-CN');

export type ChenjiForm = z.infer<typeof chenjiSchema>;
export type ChenjiFormInput = z.input<typeof chenjiSchema>;

/** The three-part envelope every StarNote API response uses. */
export interface Envelope<T> {
  code: number;
  data: T;
  message: string;
}

export interface ChenjiPublication {
  id: string;
  note_id: string;
  url: string;
  slug: string;
  title: string;
  version: number;
  [key: string]: unknown;
}

export class ChenjiApiError extends Error {
  code: string;
  constructor(message: string, code: number | string) {
    super(message);
    this.name = 'ChenjiApiError';
    this.code = String(code);
  }
}

/** Only the known sizes with a value: the API rejects unknown keys. */
function pickVariants(v: CoverVariants): CoverVariants {
  const out: CoverVariants = {};
  for (const key of ['og', 'wide', 'square', 'portrait'] as const) if (v[key]) out[key] = v[key];
  return out;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** Picks the category whose name matches a tag or keyword; `undefined` when nothing matches. */
export function guessCategory(ctx: PrefillContext): string | undefined {
  const categories = ctx.categories ?? [];
  if (!categories.length) return undefined;
  const hints = [...(ctx.tags ?? []), ...(ctx.keywords ?? [])].map(normalize).filter(Boolean);
  if (!hints.length) return undefined;
  for (const hint of hints) {
    const exact = categories.find((c) => normalize(c.name) === hint);
    if (exact) return exact.id;
  }
  for (const hint of hints) {
    const partial = categories.find((c) => {
      const name = normalize(c.name);
      return name.includes(hint) || hint.includes(name);
    });
    if (partial) return partial.id;
  }
  return undefined;
}

/** Where the chenji adapter runs: our own JSON API, from the browser or the server (scheduled). */
export const CHENJI_RUNTIMES: RuntimeSupport[] = [
  { runtime: 'web', mode: 'api' },
  // the desktop app's renderer is the same page as the web: it publishes to 辰记 the same way
  { runtime: 'electron', mode: 'api' },
  { runtime: 'server', mode: 'api', schedulable: true },
];

/** Publishing to 辰记 uses the author's own login; there is nothing to bind. */
export const CHENJI_BINDING: BindingSpec = { kind: 'session', store: 'none' };

/**
 * The body of `POST /notes/{id}/publish/chenji` (pure): what `publish` sends and what a scheduled task stores
 * (SPEC-r11 §4.1, the server runs 辰记 first with it).
 */
export function chenjiBody(doc: Doc, form: ChenjiForm, common: CommonFormShape = {}) {
  return {
    category: form.category,
    visibility: form.visibility,
    show_in_blog: form.show_in_blog,
    summary: common.summary ?? doc.summary,
    html: doc.html,
    toc: doc.toc,
    title: common.title ?? doc.title,
    // `common.cover` is the asset hash the cover field uploaded (or an article image's hash).
    ...(common.cover ? { cover_asset_hash: common.cover } : {}),
    // the other sizes (og / wide / square / portrait); the server falls back to the cover for missing keys
    ...(common.coverVariants && Object.keys(common.coverVariants).length
      ? { cover_variants: pickVariants(common.coverVariants) }
      : {}),
    ...(common.coverAlt ? { cover_alt: common.coverAlt } : {}),
    // r9 译文: the English version prepared by the publish panel rides along with the post
    ...(form.translations ? { translations: form.translations } : {}),
  };
}

export const chenjiAdapter: Adapter<typeof chenjiSchema> = {
  key: 'chenji',
  label: '辰记',
  runtime: ['web', 'electron', 'server'],
  runtimes: CHENJI_RUNTIMES,
  contentTypes: ['article'],
  binding: CHENJI_BINDING,
  capabilities: { supportsUpdate: true, titleMax: 120 },
  schema: chenjiSchema,
  schemaFor: chenjiSchemaFor,

  /** The blog shows `doc.html` as is; nothing is changed on the way. */
  preview(doc: Doc, _form: ChenjiForm, common: CommonFormShape = {}): AdapterPreview {
    return { format: 'html', title: common.title ?? doc.title, body: doc.html, report: [] };
  },

  prefill(_doc: Doc, ctx: PrefillContext): Partial<ChenjiForm> {
    const id = guessCategory(ctx);
    return id ? { category: { id } } : {};
  },

  /** SPEC-r11 §12: 辰记's own request (`seq = 0` of a scheduled batch). */
  renderRequest({ doc, form, common }) {
    return { body: chenjiBody(doc, form, common) };
  },

  async publish({ doc, form, common, ctx }) {
    const t = msg(ctx.lang);
    ctx.emit({ type: 'progress', percent: 10, text: t.converting });
    const body = chenjiBody(doc, form, common);
    ctx.emit({ type: 'progress', percent: 40, text: t.uploading });
    const response = await ctx.fetch(`${ctx.apiBase}/notes/${ctx.noteId}/publish/chenji`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });
    let envelope: Envelope<ChenjiPublication | null>;
    try {
      envelope = (await response.json()) as Envelope<ChenjiPublication | null>;
    } catch {
      throw new ChenjiApiError(t.unreadable(response.status), response.status);
    }
    if (envelope.code !== 0 || !envelope.data) {
      throw new ChenjiApiError(envelope.message || t.failed(envelope.code), envelope.code);
    }
    const publication = envelope.data;
    ctx.emit({ type: 'progress', percent: 100, text: t.done });
    ctx.emit({ type: 'done', url: publication.url, externalId: publication.id });
    return { url: publication.url, externalId: publication.id };
  },
};

export default chenjiAdapter;

export { msg as chenjiMessages } from './i18n';
