import type { z } from 'zod';

import type { AccountRef, BindingDriver, BindingSpec } from './binding';
import type { ContentKind, PublishContent } from './content';
import type { HandoffRequest, HandoffTicket, SessionFetch } from './desktop-session';
import type { EngageDriver, PlatformStats, PostRef, StatsContext, StatsDriver } from './insights';
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

/**
 * What kind of failure it was (SPEC-r11 §1), deciding what happens next:
 *
 * - `refresh`: the token expired but can be refreshed — the server refreshes and retries **once**; the user sees nothing;
 * - `retry`: 429, 5xx, or a network error where the request **certainly was not sent** — retry later (`retryAfterSec`);
 * - `bad_body`: the platform refused the content (bad field, too long, policy) — no retry, show why;
 * - `disconnect`: authorization revoked / account gone / missing permission — the account needs rebinding;
 * - `unknown`: a write was sent but the answer is unknown (timeout, dropped connection) — **never retried**
 *   automatically; the user checks on the platform (「去平台确认」「确认已发出」「仍要重发」).
 *
 * **Writes are never retried automatically** (creating a post or a comment, `finalize`): a retry after an
 * `unknown` could post twice. Only reads (status checks, stats, account info) may be retried by the SDK or a
 * host without asking. A user's 「重试」 is a new attempt (`PublishJob.attempt` + 1, a new `Idempotency-Key`);
 * network replays inside one attempt reuse the key (SPEC-r11 §3).
 */
export type ErrorKind = 'refresh' | 'retry' | 'bad_body' | 'disconnect' | 'unknown';

export const ERROR_KINDS: readonly ErrorKind[] = [
  'refresh',
  'retry',
  'bad_body',
  'disconnect',
  'unknown',
];

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
      /** What kind of failure (SPEC-r11 §1); absent when unknown to the SDK (cancelled, unsupported…). */
      kind?: ErrorKind;
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

/**
 * Where a post ended up: live, only a draft, waiting for review, handed off to the user, or still being processed
 * by the platform (`processing`, SPEC-r11 §2: a Threads / Instagram container or a video; see `Adapter.checkStatus`).
 */
export type PublishState = 'published' | 'draft' | 'pending-review' | 'handoff' | 'processing';

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
  /** The bound account to publish with (`PublishTarget.account`, else `PublishJob.accounts[platform]`). */
  account?: AccountRef;
  /**
   * `platform_accounts.id` of the account to use (SPEC-r11 §5.3): `PublishTarget.accountId`, else `account.id`.
   * The relay sends it as `account_id`; absent means the platform's default account.
   */
  accountId?: string;
  /** The earlier post on this platform (`PublishJob.previous[platform]`): update it instead of creating. */
  previous?: PostRef;
  /**
   * Idempotency (SPEC-r11 §3). `idempotencyKey` wins when given (a scheduled task's stored key); otherwise the kit
   * derives `${jobId}:${platform}:${accountId ?? 'default'}:${attempt}` when `jobId` is set (see `idempotencyKeyOf`).
   * No `jobId` and no key: no `Idempotency-Key` header (the behaviour before r11).
   */
  idempotencyKey?: string;
  /** `PublishJob.jobId`: one id per publish run (a schedule's task id, or a random id per click). */
  jobId?: string;
  /** `PublishJob.attempt`: 1 for the first try, +1 each time the user presses 「重试」. */
  attempt?: number;
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
  /**
   * `state: 'processing'`: what `checkStatus` / `finalize` need (a container id…). Opaque to the publisher; the
   * server stores it as `publish_tasks.pending`, so it must be plain JSON.
   */
  pending?: unknown;
}

/**
 * The answer of `Adapter.checkStatus` / `finalize` (SPEC-r11 §2):
 * `pending` still processing; `ready` processed, call `finalize`; `completed` live at `url`.
 */
export type PendingCheck =
  | { status: 'pending'; pending: unknown }
  | { status: 'ready'; pending: unknown }
  | { status: 'completed'; url: string; externalId: string };

/** What a relay task posts at run time (SPEC-r11 §4.2 `publish_tasks.request`): the body as `relayPublish` sends it. */
export interface RelayRequest {
  body: unknown;
  previous?: { external_id: string; url?: string };
}

/** Arguments of the pure renderers (`renderRequest` / `renderHandoff`): what `publish` gets, without the context. */
export interface AdapterRenderArgs<F = unknown> {
  doc: Doc;
  form: F;
  common: CommonFormShape;
  /** The content for this platform; `{ kind: 'article', doc }` when the job gave none. */
  content?: PublishContent;
  account?: AccountRef;
  previous?: PostRef;
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
  /**
   * Pure, no network: the relay request `publish` would send (SPEC-r11 §4.1, §12). `publisher.prepare` stores it
   * on a scheduled task; the server adds the credential at run time. Throws when the content cannot be rendered
   * (no link yet…). Adapters that talk to the platform themselves (session / 发布台) leave it out.
   */
  renderRequest?(args: AdapterRenderArgs<z.infer<S>>): RelayRequest & { report?: ReportItem[] };
  /**
   * Pure, no network: the hand-off used when no account is bound (share page, 「复制文案」), SPEC-r11 §10. The same
   * share / copy the registry's `handoff` / `manual` runtime describes.
   */
  renderHandoff?(args: AdapterRenderArgs<z.infer<S>>): {
    handoff: PublishHandoff;
    report?: ReportItem[];
  };
  /**
   * Three-stage publishing (SPEC-r11 §2): when `publish` returned `state: 'processing'` with `pending`, the
   * publisher polls `checkStatus` every `pollIntervalSec` (a read: may be retried); on `ready` it calls `finalize`
   * once (a write: never retried automatically) and stops on `completed`. Contract: once `finalize` took effect
   * on the platform, `checkStatus` must answer `completed`, never `ready` again (a replay would post twice).
   */
  checkStatus?(pending: unknown, ctx: PublishContext): Promise<PendingCheck>;
  finalize?(pending: unknown, ctx: PublishContext): Promise<PendingCheck>;
  /** Seconds between `checkStatus` calls. Default 5. */
  pollIntervalSec?: number;
  /** Give up after this many seconds: `failed` with `kind: 'unknown'`. Default 600. */
  pollTimeoutSec?: number;
  /**
   * At most this many publishes of this platform at once when the publisher's `concurrency` > 1 (SPEC-r11 §6).
   * Default: no extra limit.
   */
  maxConcurrent?: number;
  /**
   * Post stats (SPEC-r11 §7): views / likes / comments / shares of a published post. A read: may be retried.
   * `null` when the post is gone or hidden. See `StatsContext` for credentials.
   */
  fetchStats?(externalId: string, ctx: StatsContext): Promise<PlatformStats | null>;
  /** What `fetchStats` needs (`StatsDriver.requires`): the host runs it where that is available. Default `none`. */
  statsRequires?: StatsDriver['requires'];
  /** Types only for now (SPEC-r8 §7.4). */
  engage?: EngageDriver;
}

/**
 * One publish of one platform with one account (SPEC-r11 §5.3). Several targets may share a platform (one per
 * account); their results are keyed by `targetKey`.
 */
export interface PublishTarget {
  platform: string;
  /** `platform_accounts.id` (or a desktop `local-…` id); absent = the platform's default account. */
  accountId?: string;
  /** The account handed to the adapter as `ctx.account`; else `PublishJob.accounts[platform]` when its id matches. */
  account?: AccountRef;
  /** This target's form; else `perPlatform[targetKey]`, then `perPlatform[platform]`. */
  form?: unknown;
  /** The earlier post of this account; else `PublishJob.previous[targetKey]`, then `[platform]`. */
  previous?: PostRef;
  /** A stored key (a scheduled task's `idempotency_key`): wins over the derived one. */
  idempotencyKey?: string;
  /** This target's content; else `perPlatformContent[platform]`, then `content`. */
  content?: PublishContent;
}

export interface PublishJob {
  noteId: string;
  doc: Doc;
  /** One target per platform (the default account). Ignored when `targets` is given. */
  platforms?: string[];
  /** SPEC-r11 §5.3: per-account targets (several accounts of one platform publish once each). Wins over `platforms`. */
  targets?: PublishTarget[];
  /** One id per publish run; with `attempt` it makes the relay's `Idempotency-Key` (SPEC-r11 §3). */
  jobId?: string;
  /** 1 for the first try; the host adds one when the user presses 「重试」. Default 1. */
  attempt?: number;
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
  /** On failure: what kind (SPEC-r11 §1). */
  kind?: ErrorKind;
  /** The target's platform and account (results are keyed by `targetKey`). */
  platform?: string;
  accountId?: string;
  /** `state: 'processing'` with `pollProcessing: false`: hand to `checkStatus` / the server later. */
  pending?: unknown;
}

export interface JobResult {
  /** Keyed by `targetKey(target)`: the platform key, or `platform@accountId` for a target with an account id. */
  results: Record<string, PlatformResult>;
}

/** Where a prepared task runs at its time (SPEC-r11 §4.1). */
export type TaskRuntime = 'server' | 'desktop' | 'handoff';

/** Bound accounts as `publisher.prepare` sees them: where each one's credential is usable. */
export interface PrepareAccount {
  platform: string;
  accountId: string;
  /** 云端代发 on: the server holds an encrypted credential and can publish at the time. */
  cloud: boolean;
  /** Held on a desktop (local token / login session): the desktop publishes when it claims the task. */
  local: boolean;
  label?: string;
  isDefault?: boolean;
  /** The full account, handed to the renderers (Mastodon's `max_characters`, the Facebook Page…). */
  account?: AccountRef;
}

export interface PrepareInput {
  doc: Doc;
  targets: PublishTarget[];
  common: CommonFormShape;
  perPlatform?: Record<string, unknown>;
  /** Default `{ kind: 'article', doc }` (with `canonicalUrl`). */
  content?: PublishContent;
  perPlatformContent?: Record<string, PublishContent>;
  accounts?: PrepareAccount[];
  /** Earlier posts, keyed by `targetKey` or platform. */
  previous?: Record<string, PostRef>;
  /**
   * The note's 辰记 link when it is already published there. Absent and `chenji` in `targets`: every link back to
   * 辰记 is written as `CANONICAL_PLACEHOLDER`, and the server fills it in after 辰记 ran (SPEC-r11 §4.1).
   */
  canonicalUrl?: string;
  /** Platforms switched off remotely (`HostEnv.disabled`). */
  disabled?: readonly string[];
}

export type PrepareProblemCode =
  /** Not bound, and no hand-off: the task can only remind the user (copy + the platform's home page). */
  | 'needs_binding'
  /** Bound, but only in a page / on no desktop: turn on 云端代发, or switch the task to `handoff`. */
  | 'needs_cloud'
  | 'invalid_form'
  | 'render_failed'
  | 'unsupported'
  | 'disabled';

/** One task of `POST /publish/schedules` (SPEC-r11 §4.4), field names as the API takes them where sent as is. */
export interface PreparedTask {
  platform: string;
  accountId?: string;
  runtime: TaskRuntime;
  /** 0 for 辰记, then the order of `targets`. */
  seq: number;
  /** `server` / `desktop`: the relay request. Absent for 发布台 platforms (the desktop renders them when claiming). */
  request?: RelayRequest;
  /** `handoff`: what the reminder opens. Also given as the alternative on a `needs_cloud` task. */
  handoff?: { open_url: string; copy_text?: string; files?: PublishHandoff['files'] };
  /** 「平台名 · 账号」 */
  label: string;
  /** The renderer's predicted report. */
  report?: ReportItem[];
  /** True when the request / hand-off contains `CANONICAL_PLACEHOLDER` (it depends on the 辰记 task). */
  dependsOnChenji?: boolean;
  /** Why the task cannot run as planned; the host asks the user (bind / enable cloud / switch to hand-off / drop). */
  problem?: { code: PrepareProblemCode; message: string };
}

export interface CreatePublisherOptions {
  adapters: Adapter<any>[];
  runtime: Runtime;
  fetch?: typeof fetch;
  /**
   * Every event of every target. `key` is `targetKey(target)`: the platform key, or `platform@accountId` for a
   * target with an account id (SPEC-r11 §5.3).
   */
  onEvent?: (key: string, event: PublishEvent, target: PublishTarget) => void;
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
  /**
   * Three-stage platforms: poll `checkStatus` / `finalize` until `completed` (default `true`). `false`: the result
   * stays `state: 'processing'` with `pending` (the host hands it to the server).
   */
  pollProcessing?: boolean;
  /** Time source for the polling loop (tests). */
  clock?: { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void> };
}

export interface PublishOptions {
  signal?: AbortSignal;
}

export interface Publisher {
  publish(job: PublishJob, opts?: PublishOptions): Promise<JobResult>;
  capabilities(key: string): AdapterCapabilities | undefined;
  /** Resolves a pending `needInput` of a target (`targetKey`, the platform key by default). False when nothing waits. */
  answer(platform: string, inputId: string, value: string): boolean;
  adapters: Adapter<any>[];
  /** How `platform` can be published from this host (`planRuntime` on the adapter or registry entry). */
  plan(platform: string, opts?: PlanOptions & { env?: Partial<HostEnv> }): RuntimeGuide[];
  /** `adapter.preview` after validating the form; `undefined` when the adapter has no preview. */
  preview(
    platform: string,
    args: { doc: Doc; form?: unknown; common?: CommonFormShape; content?: PublishContent }
  ): Promise<AdapterPreview | undefined>;
  /**
   * SPEC-r11 §12: the tasks of a scheduled publish — per target its runtime (`server` / `desktop` / `handoff`),
   * the relay request or the hand-off, and a label. Pure: renders with the adapters' `renderRequest` /
   * `renderHandoff` and plans with `planRuntime`; sends nothing.
   */
  prepare(input: PrepareInput): PreparedTask[];
}
