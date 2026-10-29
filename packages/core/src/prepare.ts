/**
 * `publisher.prepare` (SPEC-r11 §4.1, §12): turns the publish panel's targets into the tasks of a scheduled
 * publish. Pure — the adapters' `renderRequest` / `renderHandoff` and `planRuntime`; no request is sent.
 *
 * Runtime per target:
 * - 辰记 → `server`;
 * - an account with 云端代发 on → `server` (the server adds the credential at the time);
 * - an account held on a desktop (local token, login session, Bluesky) → `desktop` (`waiting_desktop` until a
 *   desktop claims it; 发布台 platforms carry no request, the desktop renders them when claiming);
 * - no account needed (share links, Medium import) or none bound → `handoff` (the user is reminded to share);
 * - bound only in a page (no cloud, no desktop) → `server` with `problem: needs_cloud` and the hand-off as the
 *   alternative, so the host can offer 「开启云端代发」 or 「改为到点提醒」.
 */
import { needsBinding } from './binding';
import { articleContent, visibleLinkOf, withTrackingUrl } from './content';
import { coreMessages } from './i18n/messages';
import { localizedLabel } from './i18n/labels';
import { planRuntime, resolveRuntimes } from './runtime';
import { adapterSchema, formatZodError } from './schema';
import { CANONICAL_PLACEHOLDER, hasCanonicalPlaceholder, targetKey } from './targets';

import type { PublishContent } from './content';
import type { PlanTarget } from './runtime';
import type {
  Adapter,
  AdapterRenderArgs,
  PrepareAccount,
  PreparedTask,
  PrepareInput,
  PrepareProblemCode,
  PublishHandoff,
  PublishTarget,
  RelayRequest,
  TaskRuntime,
} from './types';

export interface PrepareDeps {
  adapterOf(platform: string): Adapter<any> | undefined;
  planTarget(platform: string): PlanTarget & { homepage?: string };
}

const isAuto = (mode: string) => mode === 'api' || mode === 'automation';

/** The content of a target with the link back to 辰记 filled in (the real one, or the placeholder). */
function withCanonical(content: PublishContent, canonical: string | undefined): PublishContent {
  if (!canonical) return content;
  switch (content.kind) {
    case 'article':
      return content.canonicalUrl ? content : { ...content, canonicalUrl: canonical };
    case 'short-text':
      return content.link ? content : { ...content, link: canonical };
    case 'image-set':
      return content.from && !content.from.canonicalUrl
        ? { ...content, from: { ...content.from, canonicalUrl: canonical } }
        : content;
    default:
      return content;
  }
}

function pickAccount(
  accounts: readonly PrepareAccount[] | undefined,
  target: PublishTarget
): PrepareAccount | undefined {
  const mine = (accounts ?? []).filter((a) => a.platform === target.platform);
  if (target.accountId) return mine.find((a) => a.accountId === target.accountId);
  return mine.find((a) => a.isDefault) ?? mine[0];
}

export function prepareTasks(input: PrepareInput, deps: PrepareDeps): PreparedTask[] {
  const article = input.content?.kind === 'article' ? input.content : undefined;
  const known = input.canonicalUrl || article?.canonicalUrl;
  const withChenji = input.targets.some((t) => t.platform === 'chenji');
  // 辰记 in the batch and not published yet: links back to it are filled in by the server after it ran.
  const canonical = known || (withChenji ? CANONICAL_PLACEHOLDER : undefined);

  let seq = 0;
  const lang = input.lang;
  const m = coreMessages(lang).prepare;
  const tasks: PreparedTask[] = input.targets.map((target) => {
    const p = target.platform;
    const key = targetKey(target);
    const adapter = deps.adapterOf(p);
    const plan = deps.planTarget(p);
    const chosen = pickAccount(input.accounts, target);
    const accountId = target.accountId ?? chosen?.accountId;
    const base = localizedLabel(p, adapter?.label ?? plan.label ?? p, lang);
    const label = chosen?.label ? `${base} · ${chosen.label}` : base;
    const rawContent =
      target.content ??
      input.perPlatformContent?.[p] ??
      input.content ??
      articleContent(input.doc, known ? { canonicalUrl: known } : {});
    // SPEC-r12 §5.3: 辰记 itself never gets a short link; the rest show it where readers click
    const content =
      p === 'chenji'
        ? rawContent
        : withTrackingUrl(withCanonical(rawContent, canonical), target.trackingUrl);
    const out: PreparedTask = {
      platform: p,
      ...(accountId ? { accountId } : {}),
      runtime: 'handoff',
      seq: 0,
      label,
    };
    const fail = (code: PrepareProblemCode, message: string) => {
      out.problem = { code, message };
      return out;
    };

    // availability: content kind, remote switch
    const guide = planRuntime(
      plan,
      { runtime: 'server', ...(input.disabled ? { disabled: input.disabled } : {}) },
      { contentKind: content.kind, ...(lang ? { lang } : {}) }
    ).primary;
    if (guide.kind === 'unavailable')
      return fail(
        guide.code === 'disabled-remotely' ? 'disabled' : 'unsupported',
        guide.reason ?? m.unsupported(base)
      );

    // the form
    let form: unknown = target.form ?? input.perPlatform?.[key] ?? input.perPlatform?.[p] ?? {};
    if (adapter) {
      const parsed = adapterSchema(adapter, lang).safeParse(form);
      if (!parsed.success) return fail('invalid_form', formatZodError(parsed.error, { lang }));
      form = parsed.data;
    }
    const previous = target.previous ?? input.previous?.[key] ?? input.previous?.[p];
    const args: AdapterRenderArgs = {
      doc: input.doc,
      form,
      common: input.common,
      content,
      ...((target.account ?? chosen?.account)
        ? { account: target.account ?? chosen?.account }
        : {}),
      ...(previous ? { previous } : {}),
      ...(target.trackingUrl && p !== 'chenji' ? { trackingUrl: target.trackingUrl } : {}),
      ...(lang ? { lang } : {}),
    };

    const runtimes = resolveRuntimes(plan);
    const auto = runtimes.some((s) => isAuto(s.mode));
    const desktopAuto = runtimes.some((s) => s.runtime === 'electron' && isAuto(s.mode));
    const bindable = needsBinding(plan.binding);

    const handoffOf = (): PreparedTask['handoff'] => {
      if (adapter?.renderHandoff) {
        try {
          const h = adapter.renderHandoff(args).handoff;
          return {
            open_url: h.openUrl,
            ...(h.copyText !== undefined ? { copy_text: h.copyText } : {}),
            ...(h.files?.length ? { files: h.files } : {}),
          };
        } catch {
          /* fall through to the plain copy */
        }
      }
      // 「复制后手动发」: the title and the link, opened on the platform's home page
      const link = visibleLinkOf(content);
      const title = input.common.title || input.doc.title;
      return {
        open_url: plan.homepage ?? '',
        copy_text: [title, link].filter(Boolean).join('\n'),
      };
    };
    const hasOwnHandoff =
      !!adapter?.renderHandoff ||
      runtimes.some((s) => s.mode === 'handoff' && s.handoff?.via !== 'deeplink');

    let runtime: TaskRuntime;
    let problem: { code: PrepareProblemCode; message: string } | undefined;
    if (p === 'chenji') runtime = 'server';
    else if (!bindable || !auto) runtime = auto && !hasOwnHandoff ? 'server' : 'handoff';
    else if (chosen?.cloud) runtime = 'server';
    else if (chosen?.local && desktopAuto) runtime = 'desktop';
    else if (chosen) {
      runtime = 'server';
      problem = {
        code: 'needs_cloud',
        message: m.needsCloud(label),
      };
    } else {
      runtime = 'handoff';
      if (!hasOwnHandoff)
        problem = {
          code: 'needs_binding',
          message: m.needsBinding(base),
        };
    }
    out.runtime = runtime;
    if (problem) out.problem = problem;

    if (runtime === 'handoff' || problem?.code === 'needs_cloud') {
      const h = handoffOf();
      if (h) out.handoff = h;
    }
    if (runtime !== 'handoff') {
      if (adapter?.renderRequest) {
        try {
          const r = adapter.renderRequest(args);
          out.request = {
            body: r.body,
            ...(r.previous ? { previous: r.previous } : {}),
            // SPEC-r12 §2.3: the runner posts the link comment after the post
            ...(r.follow_up ? { follow_up: r.follow_up } : {}),
          };
          if (r.report?.length) out.report = r.report;
        } catch (e) {
          return fail('render_failed', e instanceof Error ? e.message : String(e));
        }
      } else if (runtime === 'server') {
        return fail('unsupported', m.noServer(base));
      }
      // desktop without `renderRequest` (发布台 / login session): rendered by the desktop when it claims the task
    }
    if (hasCanonicalPlaceholder(out.request) || hasCanonicalPlaceholder(out.handoff))
      out.dependsOnChenji = true;
    return out;
  });

  // 辰记 first (`seq = 0`), the rest in the given order.
  const ordered = [
    ...tasks.filter((t) => t.platform === 'chenji'),
    ...tasks.filter((t) => t.platform !== 'chenji'),
  ];
  for (const t of ordered) t.seq = t.platform === 'chenji' ? 0 : ++seq;
  return ordered;
}

/** One task of `POST /publish/schedules` as the API takes it (`TaskIn`, snake_case). */
export interface ScheduleTaskIn {
  platform: string;
  /**
   * The account: a `platform_accounts.id` for `server` tasks; for `desktop` / `handoff` tasks it may be a desktop
   * `local-…` id — the server stores it as is and hands it back to the desktop that claims the task.
   */
  account_id?: string;
  runtime: TaskRuntime;
  seq: number;
  request?: RelayRequest;
  handoff?: { open_url: string; copy_text?: string; files?: PublishHandoff['files'] };
  label: string;
}

/** Problems that make a task unable to run at all; such tasks are left out by `toScheduleTasks`. */
export const BLOCKING_PROBLEMS: readonly PrepareProblemCode[] = [
  'invalid_form',
  'render_failed',
  'unsupported',
  'disabled',
];

/**
 * `PreparedTask[]` → the `tasks` of `POST /publish/schedules` (SPEC-r11 §4.4). Drops `report`, `problem` and
 * `dependsOnChenji`, and:
 * - leaves out tasks with a blocking problem (`BLOCKING_PROBLEMS`: the host shows them to the user instead);
 * - turns `needs_cloud` tasks into their `handoff` alternative (「改为到点提醒」) — the server would refuse them with
 *   409 `needs_cloud`; pass `{ needsCloud: 'drop' }` to leave them out, or `'keep'` after the user enabled 云端代发;
 * - keeps `needs_binding` tasks (they already are hand-off reminders with the copy text);
 * - leaves out tasks that contain `CANONICAL_PLACEHOLDER` when the batch has no runnable 辰记 task.
 * `seq` is renumbered to stay consecutive (辰记 keeps 0).
 */
export function toScheduleTasks(
  prepared: readonly PreparedTask[],
  opts: { needsCloud?: 'handoff' | 'drop' | 'keep' } = {}
): ScheduleTaskIn[] {
  const mode = opts.needsCloud ?? 'handoff';
  const blocked = (t: PreparedTask) => !!t.problem && BLOCKING_PROBLEMS.includes(t.problem.code);
  // without a runnable 辰记 task nobody fills the placeholder: its dependents are left out too
  const chenjiRuns = prepared.some((t) => t.platform === 'chenji' && !blocked(t));
  const out: ScheduleTaskIn[] = [];
  for (const t of prepared) {
    const code = t.problem?.code;
    if (blocked(t)) continue;
    if (t.dependsOnChenji && !chenjiRuns) continue;
    let runtime = t.runtime;
    let request = t.request;
    if (code === 'needs_cloud' && mode !== 'keep') {
      if (mode === 'drop' || !t.handoff) continue;
      runtime = 'handoff';
      request = undefined;
    }
    if (runtime === 'server' && !request) continue;
    out.push({
      platform: t.platform,
      ...(t.accountId ? { account_id: t.accountId } : {}),
      runtime,
      seq: t.seq,
      ...(runtime !== 'handoff' && request ? { request } : {}),
      ...(runtime === 'handoff' && t.handoff ? { handoff: t.handoff } : {}),
      label: t.label,
    });
  }
  let n = 0;
  for (const t of out) t.seq = t.platform === 'chenji' ? 0 : ++n;
  return out;
}
