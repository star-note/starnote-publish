import { articleContent, withTrackingUrl } from './content';
import { coreMessages } from './i18n/messages';
import { localizedLabel } from './i18n/labels';
import { platformMeta } from './platforms';
import { shortcodeOf } from './post-url';
import { prepareTasks } from './prepare';
import { mergeReports } from './report';
import { normalizeRuntime, planRuntime, resolveRuntimes, runtimeList } from './runtime';
import { adapterSchema, formatZodError } from './schema';
import { errorKindOf, targetKey } from './targets';

import type { PublishContent } from './content';
import type { SdkLang } from './i18n/lang';
import type { ReportItem } from './report';
import type { HostEnv, PlanOptions, PlanTarget } from './runtime';
import type {
  Adapter,
  AdapterPreview,
  CommonFormShape,
  Doc,
  CreatePublisherOptions,
  ErrorKind,
  FollowUpResult,
  JobResult,
  NeedInputRequest,
  PlatformResult,
  PublishContext,
  PublishEvent,
  PublishEventAction,
  PublishEventInput,
  PublishJob,
  PublishOptions,
  PublishOutput,
  Publisher,
  PublishTarget,
} from './types';

/** The `zh-CN` text of an unknown platform's failure (`coreMessages(lang).publisher.unknownPlatform`). */
export const UNKNOWN_PLATFORM = '该平台适配器尚未接入';

/** SPEC-r11 §2 defaults. */
export const DEFAULT_POLL_INTERVAL_SEC = 5;
export const DEFAULT_POLL_TIMEOUT_SEC = 600;

/** `unknown`: the write may have gone through — the user checks the platform before sending again. */
const checkAction = (lang?: string): PublishEventAction => ({
  id: 'check',
  label: coreMessages(lang).common.checkOnPlatform,
  kind: 'help',
});
const resendAction = (lang?: string): PublishEventAction => ({
  id: 'retry',
  label: coreMessages(lang).common.resendAnyway,
  kind: 'retry',
});

const realClock = {
  now: () => Date.now(),
  sleep: (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason ?? new Error('已取消'));
      const t = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error('已取消'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }),
};

/** Thrown inside the polling loop; carries its kind to the `failed` event. */
class PollError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly errorKind: ErrorKind
  ) {
    super(message);
    this.name = 'PollError';
  }
}

function now(): string {
  return new Date().toISOString();
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

interface Pending {
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

/**
 * Runs publish jobs through the registered adapters. Each platform gets a
 * stream of events (`progress`, `log`, `needInput`…) and always ends in one
 * `done` or one `failed`; the job resolves with a result per platform.
 */
export function createPublisher(options: CreatePublisherOptions): Publisher {
  const adapters = options.adapters;
  // `'node'` is the deprecated name of `'server'` (辰记's Python API).
  const runtime = normalizeRuntime(options.runtime);
  const byKey = new Map<string, Adapter<any>>(adapters.map((a) => [a.key, a]));
  const pending = new Map<string, Pending>();
  const apiBase = (options.apiBase ?? '/api/v1').replace(/\/$/, '');
  const doFetch: typeof fetch =
    options.fetch ?? ((...args) => globalThis.fetch(...(args as Parameters<typeof fetch>)));

  const key = (platform: string, id: string) => `${platform}::${id}`;

  function answer(platform: string, inputId: string, value: string): boolean {
    const entry = pending.get(key(platform, inputId));
    if (!entry) return false;
    pending.delete(key(platform, inputId));
    entry.resolve(value);
    return true;
  }

  function capabilities(platform: string) {
    return byKey.get(platform)?.capabilities;
  }

  function hostEnv(extra?: Partial<HostEnv>): HostEnv {
    return { ...options.env, ...extra, runtime: normalizeRuntime(extra?.runtime ?? runtime) };
  }

  /** The adapter when registered, else the registry entry (so unregistered platforms still get guides). */
  function planTarget(platform: string): PlanTarget {
    const adapter = byKey.get(platform);
    const meta = platformMeta(platform);
    if (adapter)
      return {
        key: adapter.key,
        label: adapter.label,
        homepage: meta?.homepage,
        // What the adapter implements wins over the registry's recommendation.
        runtimes: resolveRuntimes(adapter),
        contentTypes: adapter.contentTypes ?? meta?.contentTypes,
        binding: adapter.binding ?? meta?.binding,
      };
    if (meta) return meta;
    return { key: platform, label: platform, runtime: [] };
  }

  function plan(platform: string, opts: PlanOptions & { env?: Partial<HostEnv> } = {}) {
    const { env, ...planOpts } = opts;
    const lang = planOpts.lang ?? options.lang;
    return planRuntime(planTarget(platform), hostEnv(env), {
      ...planOpts,
      ...(lang ? { lang } : {}),
    }).guides;
  }

  async function preview(
    platform: string,
    args: {
      doc: Doc;
      form?: unknown;
      common?: CommonFormShape;
      content?: PublishContent;
      trackingUrl?: string;
      lang?: SdkLang;
    }
  ): Promise<AdapterPreview | undefined> {
    const adapter = byKey.get(platform);
    if (!adapter?.preview) return undefined;
    const lang = args.lang ?? options.lang;
    const parsed = adapterSchema(adapter, lang).safeParse(args.form ?? {});
    if (!parsed.success) throw new Error(formatZodError(parsed.error, { lang }));
    // SPEC-r12 §5.3: the short link goes on the content, where the renderers read the visible link
    const content = args.trackingUrl
      ? withTrackingUrl(args.content ?? articleContent(args.doc), args.trackingUrl)
      : args.content;
    return adapter.preview(
      args.doc,
      parsed.data,
      args.common ?? {},
      content,
      args.trackingUrl || lang
        ? {
            ...(args.trackingUrl ? { trackingUrl: args.trackingUrl } : {}),
            ...(lang ? { lang } : {}),
          }
        : undefined
    );
  }

  /**
   * SPEC-r12 §2.2: the follow-up (link comment) of a post that is live — once, never retried. Its failure is
   * returned (and reported as a `warn`), never thrown: the post itself succeeded.
   */
  async function postFollowUp(
    adapter: Adapter<any>,
    out: PublishOutput,
    ctx: PublishContext
  ): Promise<{ result: FollowUpResult; report: ReportItem[] } | undefined> {
    const req = out.followUp;
    if (!req) return undefined;
    const m = coreMessages(ctx.lang);
    const name = localizedLabel(adapter.key, adapter.label, ctx.lang);
    const base = { kind: req.kind, text: req.text };
    // a draft / hand-off / review post has nothing to comment on yet; nor has a pasted-back `code:` id (no API id)
    if (
      (out.state ?? 'published') !== 'published' ||
      !out.externalId ||
      shortcodeOf(out.externalId) !== undefined
    )
      return { result: { ...base, state: 'skipped' }, report: [] };
    if (!adapter.followUp)
      return {
        result: { ...base, state: 'skipped' },
        report: [
          {
            kind: 'followup.failed',
            level: 'warn',
            text: m.publisher.followUpUnsupported(name),
            detail: { text: req.text },
          },
        ],
      };
    // the user cancelled: nothing more is sent
    if (ctx.signal.aborted) return { result: { ...base, state: 'skipped' }, report: [] };
    ctx.emit({ type: 'progress', percent: 97, text: m.publisher.followUpProgress });
    try {
      const r = await adapter.followUp(
        {
          externalId: out.externalId,
          url: out.url,
          ...(req.meta !== undefined ? { meta: req.meta } : {}),
        },
        base,
        ctx
      );
      return {
        result: {
          ...base,
          state: 'succeeded',
          ...(r.externalId ? { externalId: r.externalId } : {}),
          ...(r.url ? { url: r.url } : {}),
        },
        report: [{ kind: 'followup.posted', text: m.publisher.followUpPosted }],
      };
    } catch (cause) {
      const code = ctx.signal.aborted
        ? 'aborted'
        : typeof (cause as any)?.code === 'string' && (cause as any).code
          ? String((cause as any).code)
          : 'failed';
      const message = ctx.signal.aborted ? m.common.cancelled : errorMessage(cause);
      // a write that failed without saying why may still have gone through
      const kind: ErrorKind = errorKindOf(cause) ?? 'unknown';
      return {
        result: { ...base, state: 'failed', error: { kind, code, message } },
        report: [
          {
            kind: 'followup.failed',
            level: 'warn',
            text: m.publisher.followUpFailed,
            detail: { text: req.text, error: message, code },
          },
        ],
      };
    }
  }

  /** Polls `checkStatus` / `finalize` until `completed` (SPEC-r11 §2). */
  async function settle(
    adapter: Adapter<any>,
    first: PublishOutput,
    ctx: PublishContext
  ): Promise<PublishOutput> {
    const m = coreMessages(ctx.lang).publisher;
    const name = localizedLabel(adapter.key, adapter.label, ctx.lang);
    if (!adapter.checkStatus)
      throw new PollError(m.noCheckStatus(name), 'processing_unsupported', 'unknown');
    const clock = options.clock ?? realClock;
    const interval = Math.max(0, adapter.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC) * 1000;
    const timeout = Math.max(0, adapter.pollTimeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC) * 1000;
    const started = clock.now();
    let pending = first.pending;
    let finalized = false;
    let polls = 0;
    for (;;) {
      if (clock.now() - started >= timeout)
        throw new PollError(m.pollTimeout(name, Math.round(timeout / 1000)), 'timeout', 'unknown');
      await clock.sleep(interval, ctx.signal);
      polls += 1;
      ctx.emit({
        type: 'progress',
        percent: Math.min(95, 60 + polls * 5),
        text: finalized ? m.waitingPublish : m.processing,
      });
      let check: Awaited<ReturnType<NonNullable<Adapter['checkStatus']>>>;
      try {
        check = await adapter.checkStatus(pending, ctx);
      } catch (cause) {
        // a status check is a read: a transient failure just waits for the next round
        if (ctx.signal.aborted) throw cause;
        const kind = errorKindOf(cause);
        if (kind === 'retry' || kind === 'refresh') continue;
        throw cause;
      }
      if (check.status === 'completed')
        return { ...first, url: check.url, externalId: check.externalId, state: 'published' };
      pending = check.pending;
      if (check.status === 'pending') continue;
      // ready
      if (finalized) throw new PollError(m.finalizeReplayed(name), 'finalize_replayed', 'unknown');
      if (!adapter.finalize) continue;
      ctx.emit({ type: 'progress', percent: 90, text: m.publishing });
      finalized = true;
      // a write: never retried here
      const done = await adapter.finalize(pending, ctx);
      if (done.status === 'completed')
        return { ...first, url: done.url, externalId: done.externalId, state: 'published' };
      pending = done.pending;
    }
  }

  async function runPlatform(
    target: PublishTarget,
    job: PublishJob,
    signal: AbortSignal
  ): Promise<PlatformResult> {
    const platform = target.platform;
    const rkey = targetKey(target);
    const lang = job.lang ?? options.lang;
    const m = coreMessages(lang);
    let finished = false;
    let report: ReportItem[] = [];
    const emit = (input: PublishEventInput) => {
      if (finished) return;
      const event = { ...input, at: input.at ?? now() } as PublishEvent;
      if (event.type === 'report') report = mergeReports(report, event.items);
      if (event.type === 'done' && event.report) report = mergeReports(report, event.report);
      if (event.type === 'done' || event.type === 'failed') finished = true;
      options.onEvent?.(rkey, event, target);
    };
    // Results of per-account targets say whose they are (plain platform targets stay as before).
    const who = target.accountId ? { platform, accountId: target.accountId } : {};
    const withReport = <T extends PlatformResult>(r: T): T =>
      ({ ...r, ...who, ...(report.length ? { report } : {}) }) as T;

    // A platform still queued when the job was cancelled never starts (adapters that ignore `signal`
    // would otherwise publish after the user cancelled).
    if (signal.aborted) {
      emit({ type: 'failed', reason: m.common.cancelled, code: 'aborted' });
      return { ok: false, error: m.common.cancelled, code: 'aborted', ...who };
    }
    const adapter = byKey.get(platform);
    if (!adapter) {
      emit({ type: 'failed', reason: m.publisher.unknownPlatform, code: 'unsupported' });
      return { ok: false, error: m.publisher.unknownPlatform, ...who };
    }
    const name = localizedLabel(adapter.key, adapter.label, lang);
    if (!runtimeList(adapter).includes(runtime)) {
      const reason = m.publisher.wrongRuntime(name, m.runtime.names[runtime]);
      emit({ type: 'failed', reason, code: 'runtime' });
      return { ok: false, error: reason, guides: plan(platform, lang ? { lang } : {}), ...who };
    }

    // SPEC-r12 §5.3: the tracking short link rides on the content (`visibleLinkOf`) and on `ctx.trackingUrl`
    const content: PublishContent = withTrackingUrl(
      target.content ??
        job.perPlatformContent?.[platform] ??
        job.content ??
        articleContent(job.doc),
      target.trackingUrl
    );
    const kinds = adapter.contentTypes ?? ['article'];
    if (!kinds.includes(content.kind)) {
      const reason = m.publisher.kindUnsupported(name, content.kind);
      emit({ type: 'failed', reason, code: 'kind_unsupported', kind: 'bad_body' });
      return { ok: false, error: reason, kind: 'bad_body', ...who };
    }

    const parsed = adapterSchema(adapter, lang).safeParse(
      target.form ?? job.perPlatform[rkey] ?? job.perPlatform[platform] ?? {}
    );
    if (!parsed.success) {
      const reason = formatZodError(parsed.error, { lang });
      emit({ type: 'failed', reason, code: 'invalid_form', kind: 'bad_body' });
      return { ok: false, error: reason, kind: 'bad_body', ...who };
    }

    // The account: the target's own, else the job's account of the platform (when it is the one asked for).
    const jobAccount = job.accounts?.[rkey] ?? job.accounts?.[platform];
    const account =
      target.account ??
      (jobAccount && (!target.accountId || jobAccount.id === target.accountId)
        ? jobAccount
        : undefined);
    const accountId = target.accountId ?? account?.id;
    const previous = target.previous ?? job.previous?.[rkey] ?? job.previous?.[platform];

    const owned = new Set<string>();
    const ctx: PublishContext = {
      emit,
      fetch: doFetch,
      signal,
      runtime,
      ...(lang ? { lang } : {}),
      noteId: job.noteId,
      apiBase,
      page: options.page,
      ...(options.sessionFetch ? { sessionFetch: options.sessionFetch } : {}),
      ...(options.handoff ? { handoff: options.handoff } : {}),
      ...(account ? { account } : {}),
      ...(accountId ? { accountId } : {}),
      ...(previous ? { previous } : {}),
      ...(target.idempotencyKey ? { idempotencyKey: target.idempotencyKey } : {}),
      ...(job.jobId ? { jobId: job.jobId } : {}),
      ...(job.jobId || job.attempt ? { attempt: Math.max(1, Math.floor(job.attempt ?? 1)) } : {}),
      ...(target.trackingUrl ? { trackingUrl: target.trackingUrl } : {}),
      needInput: (req: NeedInputRequest) =>
        new Promise<string>((resolve, reject) => {
          const k = key(rkey, req.id);
          owned.add(k);
          pending.set(k, { resolve, reject });
          emit({ type: 'needInput', ...req });
          if (signal.aborted) {
            pending.delete(k);
            reject(signal.reason ?? new Error(m.common.cancelled));
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              if (pending.delete(k)) reject(signal.reason ?? new Error(m.common.cancelled));
            },
            { once: true }
          );
        }),
    };

    try {
      let result = await adapter.publish({
        doc: job.doc,
        form: parsed.data,
        common: job.common,
        ctx,
        content,
      });
      if (result.state === 'processing') {
        if (options.pollProcessing === false) {
          if (result.report?.length) report = mergeReports(report, result.report);
          // the host takes the post over before it is live: the follow-up is left to it
          const skipped: FollowUpResult | undefined = result.followUp
            ? { kind: result.followUp.kind, text: result.followUp.text, state: 'skipped' }
            : undefined;
          emit({
            type: 'done',
            url: result.url,
            ...(result.externalId ? { externalId: result.externalId } : {}),
            state: 'processing',
            ...(report.length ? { report } : {}),
            ...(skipped ? { followUp: skipped } : {}),
          });
          return withReport({
            ok: true,
            url: result.url,
            ...(result.externalId ? { externalId: result.externalId } : {}),
            state: 'processing',
            pending: result.pending,
            ...(skipped ? { followUp: skipped } : {}),
          });
        }
        result = await settle(adapter, result, ctx);
      }
      if (result.report?.length) report = mergeReports(report, result.report);
      // SPEC-r12 §2.2: the link comment, once the post is live (three-stage platforms: after `finalize`)
      const follow = await postFollowUp(adapter, result, ctx);
      if (follow?.report.length) report = mergeReports(report, follow.report);
      const followUp = follow ? { followUp: follow.result } : {};
      // The adapter may already have emitted `done`; exactly one event ends the stream.
      emit({
        type: 'done',
        url: result.url,
        externalId: result.externalId,
        ...(result.state ? { state: result.state } : {}),
        ...(report.length ? { report } : {}),
        ...(result.handoff ? { handoff: result.handoff } : {}),
        ...followUp,
      });
      return withReport({
        ok: true,
        url: result.url,
        externalId: result.externalId,
        ...(result.state ? { state: result.state } : {}),
        ...(result.handoff ? { handoff: result.handoff } : {}),
        ...followUp,
      });
    } catch (cause) {
      const reason = signal.aborted ? m.common.cancelled : errorMessage(cause);
      const code: string | undefined = signal.aborted ? 'aborted' : (cause as any)?.code;
      const wait = Number((cause as any)?.retryAfterSec);
      const retryAfterSec = !signal.aborted && wait > 0 ? Math.ceil(wait) : undefined;
      // Adapters may say what helps (relogin / retry / help, `PlatformSessionError`, kit's
      // `PlatformError`); otherwise retry, labelled with the wait when the platform gave one.
      const given: PublishEventAction[] | undefined =
        !signal.aborted && Array.isArray((cause as any)?.actions) && (cause as any).actions.length
          ? (cause as any).actions
          : undefined;
      const kind = signal.aborted ? undefined : errorKindOf(cause);
      const actions: PublishEventAction[] =
        given ??
        (kind === 'unknown'
          ? [checkAction(lang), resendAction(lang)]
          : [
              {
                id: 'retry',
                label: retryAfterSec ? m.publisher.retryAfterSec(retryAfterSec) : m.common.retry,
                kind: 'retry' as const,
              },
            ]);
      emit({
        type: 'failed',
        reason,
        ...(code ? { code } : {}),
        actions,
        ...(retryAfterSec ? { retryAfterSec } : {}),
        ...(kind ? { kind } : {}),
      });
      return withReport({
        ok: false,
        error: reason,
        // Structured failures (the adapter said what helps) carry the details on the result too.
        ...(given || retryAfterSec || kind ? { ...(code ? { code } : {}), actions } : {}),
        ...(retryAfterSec ? { retryAfterSec } : {}),
        ...(kind ? { kind } : {}),
      });
    } finally {
      for (const k of owned) {
        const entry = pending.get(k);
        if (entry) {
          pending.delete(k);
          entry.reject(new Error(m.common.publishEnded));
        }
      }
    }
  }

  async function publish(job: PublishJob, opts: PublishOptions = {}): Promise<JobResult> {
    const controller = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(opts.signal.reason);
      else
        opts.signal.addEventListener('abort', () => controller.abort(opts.signal?.reason), {
          once: true,
        });
    }
    const results: Record<string, PlatformResult> = {};
    const targets: PublishTarget[] =
      job.targets ?? (job.platforms ?? []).map((platform) => ({ platform }));
    const queue = [...targets];
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    // SPEC-r11 §6: with concurrency > 1, at most `adapter.maxConcurrent` of one platform at once.
    const active = new Map<string, number>();
    let waiting: Array<() => void> = [];
    const limitOf = (platform: string) => {
      const n = byKey.get(platform)?.maxConcurrent;
      return n && n > 0 ? Math.floor(n) : Infinity;
    };
    const next = async (): Promise<PublishTarget | undefined> => {
      for (;;) {
        if (!queue.length) return undefined;
        const i =
          concurrency === 1
            ? 0
            : queue.findIndex((t) => (active.get(t.platform) ?? 0) < limitOf(t.platform));
        if (i >= 0) {
          const target = queue.splice(i, 1)[0]!;
          // counted when picked (synchronously), so a second worker sees it before this one runs
          active.set(target.platform, (active.get(target.platform) ?? 0) + 1);
          return target;
        }
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
    };
    const worker = async () => {
      for (;;) {
        const target = await next();
        if (target === undefined) break;
        try {
          results[targetKey(target)] = await runPlatform(target, job, controller.signal);
        } finally {
          active.set(target.platform, (active.get(target.platform) ?? 1) - 1);
          const wake = waiting;
          waiting = [];
          for (const w of wake) w();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    // Keep the caller's order.
    const ordered: Record<string, PlatformResult> = {};
    for (const target of targets) {
      const k = targetKey(target);
      const r = results[k];
      if (r) ordered[k] = r;
    }
    return { results: ordered };
  }

  function prepare(input: Parameters<Publisher['prepare']>[0]) {
    const lang = input.lang ?? options.lang;
    return prepareTasks(lang ? { ...input, lang } : input, {
      adapterOf: (p) => byKey.get(p),
      planTarget,
    });
  }

  return { publish, capabilities, answer, adapters, plan, preview, prepare };
}
