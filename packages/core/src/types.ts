import type { z } from 'zod';

import type { AccountRef, BindingDriver, BindingSpec } from './binding';
import type { ContentKind, PublishContent } from './content';
import type { HandoffRequest, HandoffTicket, SessionFetch } from './desktop-session';
import type { EngageDriver, PlatformStats, PostRef, StatsContext } from './insights';
import type { ReportItem } from './report';
import type { ConvertMask, MaskSummary } from './mask';
import type { MobileOptions } from './mobile';
import type { HandoffVia, HostEnv, PlanOptions, RuntimeGuide, RuntimeSupport } from './runtime';

/** A Tiptap / ProseMirror JSON node. */
export interface TiptapJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapJSON[];
  marks?: TiptapMark[];
  text?: string;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TocItem {
  /** Stable heading id, `h-<index>-<slug>`; also the `id` attribute on the HTML heading. */
  id: string;
  level: number;
  text: string;
}

/** Everything a platform adapter may need from a note, computed once by `convert`. */
export interface Doc {
  json: TiptapJSON;
  /**
   * The article HTML: `ConvertOptions.renderHtml`'s output when given (辰记 passes the editor
   * SDK's static renderer, so the blog shows what the editor shows), else `portableHtml`.
   */
  html: string;
  /**
   * Plain semantic HTML without editor classes (code as `<pre><code class="language-x">`,
   * images with `width`, tables with `colspan` / `rowspan`): for platforms that take pasted or
   * imported HTML and strip classes and styles.
   */
  portableHtml: string;
  markdown: string;
  text: string;
  toc: TocItem[];
  /** Unique image `src` values, in document order. */
  images: string[];
  /** Text of the first `h1`, or `''`. */
  title: string;
  /** First 120 characters of the plain text with whitespace collapsed. */
  summary: string;
  /** What `mask` replaced (absent when masking was off). Every output above already carries the `**`. */
  masked?: MaskSummary;
  /** 「我们帮你做了什么」 of the conversion itself: masking, phone-first images / tables. */
  report?: ReportItem[];
}

export interface ConvertOptions {
  /** Heading levels that go into `toc`. Default `[2, 3]`. */
  tocLevels?: number[];
  /** Characters kept in `summary`. Default `120`. */
  summaryLength?: number;
  /**
   * Renders `Doc.html` (the TOC, images and text still come from this converter). Heading ids
   * must follow `headingId()` so the TOC links land.
   */
  renderHtml?: (json: TiptapJSON) => string;
  /**
   * 敏感词自动打码 (`@starnote/moderation`), on by default: hits in the text become `**` in every output; with
   * `{ preview: true }` the HTML outputs mark them (`<mark class="sn-masked">`) for a preview. `false`: off.
   * Never blocks anything.
   */
  mask?: ConvertMask;
  /**
   * Phone-first HTML (`mobileHtml`) for `mobileFirst` platforms: images at screen width, tables scrolling or as
   * cards. `true` = default options. Off by default; `mobileOptionsFor(platform)` gives the registry's choice.
   */
  mobile?: boolean | MobileOptions;
}

/**
 * Where a platform is published from: the browser, the desktop app, or 辰记's server (the Python API, which adds
 * the stored credential and calls the platform; there is no Node publishing service). `'node'` is the deprecated
 * name of `'server'`; it is still accepted and read as `'server'` (`normalizeRuntime`).
 */
export type Runtime = 'web' | 'electron' | 'server' | /** @deprecated use `'server'` */ 'node';

export interface PublishEventAction {
  id: string;
  label: string;
  kind: 'retry' | 'relogin' | 'skip' | 'help';
  href?: string;
}

export type PublishEvent =
  | { type: 'progress'; percent: number; text?: string; at: string }
  | { type: 'log'; level: 'info' | 'warn'; text: string; at: string }
  | { type: 'asset'; kind: 'screenshot' | 'file'; url: string; text?: string; at: string }
  | {
      type: 'needInput';
      id: string;
      kind: 'qrcode' | 'text' | 'confirm' | 'choice';
      title: string;
      image?: string;
      options?: string[];
      at: string;
    }
  /** 「我们帮你做了什么」; may come several times, later items replace earlier ones of the same kind. */
  | { type: 'report'; items: ReportItem[]; at: string }
  | {
      type: 'done';
      url: string;
      externalId?: string;
      /** Absent means `published`. */
      state?: PublishState;
      /** Final merged report. */
      report?: ReportItem[];
      /** `state: 'handoff'`: the page the user opens to finish, and the text to paste there. */
      handoff?: PublishHandoff;
      at: string;
    }
  | {
      type: 'failed';
      reason: string;
      code?: string;
      actions?: PublishEventAction[];
      /** Rate-limited: seconds to wait before retrying (from the thrown error's `retryAfterSec`). */
      retryAfterSec?: number;
      at: string;
    };

/** An event as adapters emit it: `at` is stamped by the publisher. */
export type PublishEventInput = PublishEvent extends infer E
  ? E extends { at: string }
    ? Omit<E, 'at'> & { at?: string }
    : never
  : never;

export interface NeedInputRequest {
  id: string;
  kind: 'qrcode' | 'text' | 'confirm' | 'choice';
  title: string;
  image?: string;
  options?: string[];
}

/** A hand-off to the platform's own page (share intent, import URL…): opened by the user's click. */
export interface PublishHandoff {
  via: HandoffVia;
  /** The page to open. */
  openUrl: string;
  /** What to paste there (post text, or the link to import). */
  copyText?: string;
  /**
   * Files the user hands over (Instagram: the images, shared with `navigator.share({ files })` on a phone, or
   * downloaded on a computer). Absolute URLs; the host fetches them inside the user's click.
   */
  files?: Array<{ url: string; filename: string; mime?: string }>;
}

/** Where a post ended up: live, only a draft, waiting for review, or handed off to the user. */
export type PublishState = 'published' | 'draft' | 'pending-review' | 'handoff';

export interface AdapterCapabilities {
  supportsUpdate: boolean;
  coverRatio?: number;
  titleMax?: number;
  needsLogin?: boolean;
}

export interface PrefillContext {
  categories?: { id: string; name: string }[];
  /** Tag names on the note. */
  tags?: string[];
  /** Extra keywords (for example from the AI helper). */
  keywords?: string[];
}

export interface PublishContext {
  emit(e: PublishEventInput): void;
  needInput(req: NeedInputRequest): Promise<string>;
  fetch: typeof fetch;
  signal: AbortSignal;
  runtime: Runtime;
  /** The note being published. */
  noteId: string;
  /** API root without trailing slash, e.g. `/api/v1`. */
  apiBase: string;
  /** Electron only: a browser page in the given session partition, for site automation. */
  page?(partition: string): Promise<unknown>;
  /**
   * Electron only: a request made inside the platform's page of a `persist:pub-*` partition (the account's
   * logged-in session). Implemented by the desktop main process; see `desktop-session.ts`.
   */
  sessionFetch?: SessionFetch;
  /**
   * Electron only: put a prefilled platform editor on the desktop's 发布台 (publish desk). The user checks it and
   * presses「发布」there; the desk reports「已发布」back to the host (SPEC-r8「发布台」).
   */
  handoff?: (req: HandoffRequest) => Promise<HandoffTicket>;
  /** The bound account to publish with (`PublishJob.accounts[platform]`). */
  account?: AccountRef;
  /** The earlier post on this platform (`PublishJob.previous[platform]`): update it instead of creating. */
  previous?: PostRef;
}

/** Cover sizes besides the main (3:2) cover. */
export type CoverVariantKey = 'og' | 'wide' | 'square' | 'portrait';
export type CoverVariants = Partial<Record<CoverVariantKey, string>>;

/** Pixel sizes of the cover variants. */
export const COVER_VARIANT_SIZES: Record<CoverVariantKey, { w: number; h: number }> = {
  og: { w: 1200, h: 630 },
  wide: { w: 900, h: 383 },
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1440 },
};

export interface CommonFormShape {
  title?: string;
  summary?: string;
  cover?: string;
  /** Asset hashes of the cover at other sizes; see `COVER_VARIANT_SIZES`. */
  coverVariants?: CoverVariants;
  coverAlt?: string;
  tags?: string[];
  scheduleAt?: string;
}

/** What `Adapter.preview` returns: the body as it will be submitted, plus a predicted report. */
export interface AdapterPreview {
  format: 'html' | 'markdown' | 'text' | 'files';
  title: string;
  /** The body to submit (for `files`, the main file). */
  body: string;
  /** Full HTML for a sandboxed iframe, when it differs from `body`. */
  previewHtml?: string;
  /** Multi-file targets (GitHub Pages): every file that will be written. */
  files?: Array<{ path: string; content: string }>;
  /** Where the post will be, when known in advance. */
  url?: string;
  report: ReportItem[];
}

/** What `Adapter.publish` resolves with. Only `url` is required, as before. */
export interface PublishOutput {
  url: string;
  externalId?: string;
  /** Default `published`. */
  state?: PublishState;
  report?: ReportItem[];
  /** `state: 'handoff'`: where the user finishes. */
  handoff?: PublishHandoff;
}

export interface Adapter<S extends z.ZodType = z.ZodType> {
  key: string;
  label: string;
  /**
   * Plain runtime list. Kept as the alias of `runtimes` (it is what older hosts read); `defineAdapter`
   * derives it from `runtimes`.
   */
  runtime: Runtime[];
  /** Per-runtime support with mode / needs / schedulable (SPEC-r8 §12.2). Wins over `runtime` when set. */
  runtimes?: RuntimeSupport[];
  /** Content kinds the platform takes. Default `['article']`. */
  contentTypes?: ContentKind[];
  /** How accounts are bound and where the credential lives. */
  binding?: BindingSpec;
  /** bind / status / unbind, where this runtime can do it. */
  binder?: BindingDriver;
  capabilities: AdapterCapabilities;
  /** Platform-specific fields. */
  schema: S;
  prefill?(doc: Doc, ctx: PrefillContext): Partial<z.infer<S>>;
  /** What will be submitted, without side effects (for the preview tab). */
  preview?(
    doc: Doc,
    form: z.infer<S>,
    common?: CommonFormShape,
    content?: PublishContent
  ): AdapterPreview | Promise<AdapterPreview>;
  publish(args: {
    doc: Doc;
    form: z.infer<S>;
    common: CommonFormShape;
    ctx: PublishContext;
    /** The content for this platform; `{ kind: 'article', doc }` when the job gave none. */
    content?: PublishContent;
  }): Promise<PublishOutput>;
  /** Types only for now (SPEC-r8 §10.4). */
  fetchStats?(externalId: string, ctx: StatsContext): Promise<PlatformStats | null>;
  /** Types only for now (SPEC-r8 §7.4). */
  engage?: EngageDriver;
}

export interface PublishJob {
  noteId: string;
  doc: Doc;
  platforms: string[];
  common: CommonFormShape;
  perPlatform: Record<string, unknown>;
  /** What is published; default `{ kind: 'article', doc }`. */
  content?: PublishContent;
  /** Per-platform content (e.g. an image set derived for 小红书). */
  perPlatformContent?: Record<string, PublishContent>;
  /** The bound account per platform, handed to the adapter as `ctx.account`. */
  accounts?: Record<string, AccountRef>;
  /** The earlier post per platform, handed to the adapter as `ctx.previous` (update instead of create). */
  previous?: Record<string, PostRef>;
}

export interface PlatformResult {
  ok: boolean;
  url?: string;
  externalId?: string;
  error?: string;
  /** Set on success; absent means `published`. */
  state?: PublishState;
  /** Everything the adapter reported, merged by kind (also on failure, when anything was reported). */
  report?: ReportItem[];
  /** On a runtime failure: what the host can offer instead (`planRuntime`). */
  guides?: RuntimeGuide[];
  /** `state: 'handoff'`: where the user finishes. */
  handoff?: PublishHandoff;
  /** On failure: the error code and the actions offered (relogin / retry / help). */
  code?: string;
  actions?: PublishEventAction[];
  retryAfterSec?: number;
}

export interface JobResult {
  results: Record<string, PlatformResult>;
}

export interface CreatePublisherOptions {
  adapters: Adapter<any>[];
  runtime: Runtime;
  fetch?: typeof fetch;
  onEvent?: (platform: string, event: PublishEvent) => void;
  /** API root passed to adapters as `ctx.apiBase`. Default `/api/v1`. */
  apiBase?: string;
  /** How many platforms run at once. Default `1` (sequential). */
  concurrency?: number;
  /** Electron only: hands adapters a page in a session partition. */
  page?: (partition: string) => Promise<unknown>;
  /** Electron only: `ctx.sessionFetch` (requests inside a logged-in platform session). */
  sessionFetch?: SessionFetch;
  /** Electron only: `ctx.handoff` (the 发布台). */
  handoff?: (req: HandoffRequest) => Promise<HandoffTicket>;
  /** The rest of the host environment, for `publisher.plan` and runtime-failure guides. */
  env?: Omit<HostEnv, 'runtime'>;
}

export interface PublishOptions {
  signal?: AbortSignal;
}

export interface Publisher {
  publish(job: PublishJob, opts?: PublishOptions): Promise<JobResult>;
  capabilities(key: string): AdapterCapabilities | undefined;
  /** Resolves a pending `needInput` of `platform`. Returns false when nothing waits for it. */
  answer(platform: string, inputId: string, value: string): boolean;
  adapters: Adapter<any>[];
  /** How `platform` can be published from this host (`planRuntime` on the adapter or registry entry). */
  plan(platform: string, opts?: PlanOptions & { env?: Partial<HostEnv> }): RuntimeGuide[];
  /** `adapter.preview` after validating the form; `undefined` when the adapter has no preview. */
  preview(
    platform: string,
    args: { doc: Doc; form?: unknown; common?: CommonFormShape; content?: PublishContent }
  ): Promise<AdapterPreview | undefined>;
}
