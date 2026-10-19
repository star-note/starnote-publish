import { articleContent } from './content';
import { platformMeta } from './platforms';
import { mergeReports } from './report';
import { normalizeRuntime, planRuntime, resolveRuntimes, runtimeList } from './runtime';
import { formatZodError } from './schema';

import type { PublishContent } from './content';
import type { ReportItem } from './report';
import type { HostEnv, PlanOptions, PlanTarget } from './runtime';
import type {
  Adapter,
  AdapterPreview,
  CommonFormShape,
  Doc,
  CreatePublisherOptions,
  JobResult,
  NeedInputRequest,
  PlatformResult,
  PublishContext,
  PublishEvent,
  PublishEventAction,
  PublishEventInput,
  PublishJob,
  PublishOptions,
  Publisher,
} from './types';

export const UNKNOWN_PLATFORM = '该平台适配器尚未接入';

const RETRY_ACTION = { id: 'retry', label: '重试', kind: 'retry' as const };

const RUNTIME_NAME = { web: '浏览器', electron: '桌面端', server: '服务器' } as const;

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
    return planRuntime(planTarget(platform), hostEnv(env), planOpts).guides;
  }

  async function preview(
    platform: string,
    args: { doc: Doc; form?: unknown; common?: CommonFormShape; content?: PublishContent }
  ): Promise<AdapterPreview | undefined> {
    const adapter = byKey.get(platform);
    if (!adapter?.preview) return undefined;
    const parsed = adapter.schema.safeParse(args.form ?? {});
    if (!parsed.success) throw new Error(formatZodError(parsed.error));
    return adapter.preview(args.doc, parsed.data, args.common ?? {}, args.content);
  }

  async function runPlatform(
    platform: string,
    job: PublishJob,
    signal: AbortSignal
  ): Promise<PlatformResult> {
    let finished = false;
    let report: ReportItem[] = [];
    const emit = (input: PublishEventInput) => {
      if (finished) return;
      const event = { ...input, at: input.at ?? now() } as PublishEvent;
      if (event.type === 'report') report = mergeReports(report, event.items);
      if (event.type === 'done' && event.report) report = mergeReports(report, event.report);
      if (event.type === 'done' || event.type === 'failed') finished = true;
      options.onEvent?.(platform, event);
    };
    const withReport = <T extends PlatformResult>(r: T): T =>
      report.length ? { ...r, report } : r;

    // A platform still queued when the job was cancelled never starts (adapters that ignore `signal`
    // would otherwise publish after the user cancelled).
    if (signal.aborted) {
      emit({ type: 'failed', reason: '已取消', code: 'aborted' });
      return { ok: false, error: '已取消', code: 'aborted' };
    }
    const adapter = byKey.get(platform);
    if (!adapter) {
      emit({ type: 'failed', reason: UNKNOWN_PLATFORM, code: 'unsupported' });
      return { ok: false, error: UNKNOWN_PLATFORM };
    }
    if (!runtimeList(adapter).includes(runtime)) {
      const reason = `${adapter.label} 不能在${RUNTIME_NAME[runtime]}发布`;
      emit({ type: 'failed', reason, code: 'runtime' });
      return { ok: false, error: reason, guides: plan(platform) };
    }

    const content: PublishContent =
      job.perPlatformContent?.[platform] ?? job.content ?? articleContent(job.doc);
    const kinds = adapter.contentTypes ?? ['article'];
    if (!kinds.includes(content.kind)) {
      const reason = `${adapter.label} 不支持发布这种内容（${content.kind}）`;
      emit({ type: 'failed', reason, code: 'kind_unsupported' });
      return { ok: false, error: reason };
    }

    const parsed = adapter.schema.safeParse(job.perPlatform[platform] ?? {});
    if (!parsed.success) {
      const reason = formatZodError(parsed.error);
      emit({ type: 'failed', reason, code: 'invalid_form' });
      return { ok: false, error: reason };
    }

    const owned = new Set<string>();
    const ctx: PublishContext = {
      emit,
      fetch: doFetch,
      signal,
      runtime,
      noteId: job.noteId,
      apiBase,
      page: options.page,
      ...(options.sessionFetch ? { sessionFetch: options.sessionFetch } : {}),
      ...(options.handoff ? { handoff: options.handoff } : {}),
      ...(job.accounts?.[platform] ? { account: job.accounts[platform] } : {}),
      ...(job.previous?.[platform] ? { previous: job.previous[platform] } : {}),
      needInput: (req: NeedInputRequest) =>
        new Promise<string>((resolve, reject) => {
          const k = key(platform, req.id);
          owned.add(k);
          pending.set(k, { resolve, reject });
          emit({ type: 'needInput', ...req });
          if (signal.aborted) {
            pending.delete(k);
            reject(signal.reason ?? new Error('已取消'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              if (pending.delete(k)) reject(signal.reason ?? new Error('已取消'));
            },
            { once: true }
          );
        }),
    };

    try {
      const result = await adapter.publish({
        doc: job.doc,
        form: parsed.data,
        common: job.common,
        ctx,
        content,
      });
      if (result.report?.length) report = mergeReports(report, result.report);
      // The adapter may already have emitted `done`; exactly one event ends the stream.
      emit({
        type: 'done',
        url: result.url,
        externalId: result.externalId,
        ...(result.state ? { state: result.state } : {}),
        ...(report.length ? { report } : {}),
        ...(result.handoff ? { handoff: result.handoff } : {}),
      });
      return withReport({
        ok: true,
        url: result.url,
        externalId: result.externalId,
        ...(result.state ? { state: result.state } : {}),
        ...(result.handoff ? { handoff: result.handoff } : {}),
      });
    } catch (cause) {
      const reason = signal.aborted ? '已取消' : errorMessage(cause);
      const code: string | undefined = signal.aborted ? 'aborted' : (cause as any)?.code;
      const wait = Number((cause as any)?.retryAfterSec);
      const retryAfterSec = !signal.aborted && wait > 0 ? Math.ceil(wait) : undefined;
      // Adapters may say what helps (relogin / retry / help, `PlatformSessionError`, kit's
      // `PlatformError`); otherwise retry, labelled with the wait when the platform gave one.
      const given: PublishEventAction[] | undefined =
        !signal.aborted && Array.isArray((cause as any)?.actions) && (cause as any).actions.length
          ? (cause as any).actions
          : undefined;
      const actions: PublishEventAction[] =
        given ??
        (retryAfterSec
          ? [{ ...RETRY_ACTION, label: `${retryAfterSec} 秒后重试` }]
          : [RETRY_ACTION]);
      emit({
        type: 'failed',
        reason,
        ...(code ? { code } : {}),
        actions,
        ...(retryAfterSec ? { retryAfterSec } : {}),
      });
      return withReport({
        ok: false,
        error: reason,
        // Structured failures (the adapter said what helps) carry the details on the result too.
        ...(given || retryAfterSec ? { ...(code ? { code } : {}), actions } : {}),
        ...(retryAfterSec ? { retryAfterSec } : {}),
      });
    } finally {
      for (const k of owned) {
        const entry = pending.get(k);
        if (entry) {
          pending.delete(k);
          entry.reject(new Error('发布已结束'));
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
    const queue = [...job.platforms];
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    const worker = async () => {
      while (queue.length) {
        const platform = queue.shift();
        if (platform === undefined) break;
        results[platform] = await runPlatform(platform, job, controller.signal);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    // Keep the caller's platform order.
    const ordered: Record<string, PlatformResult> = {};
    for (const platform of job.platforms) {
      const r = results[platform];
      if (r) ordered[platform] = r;
    }
    return { results: ordered };
  }

  return { publish, capabilities, answer, adapters, plan, preview };
}
