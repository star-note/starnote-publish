import { needsBinding } from './binding';
import { coreMessages } from './i18n/messages';
import { pickText } from './i18n/lang';
import { localizedLabel } from './i18n/labels';

import type { BindingSpec } from './binding';
import type { I18nText, SdkLang } from './i18n/lang';
import type { ContentKind } from './content';
import type { Runtime } from './types';

/**
 * How a platform is driven on a runtime (SPEC-r8 §12.2): an official `api`, site `automation` with a
 * login state, a `handoff` to the platform's own app / page, or `manual` copy-paste.
 */
export type RuntimeMode = 'api' | 'automation' | 'handoff' | 'manual';

export type RuntimeNeed =
  'session' | 'token' | 'fixed-ip' | 'premium' | 'app-review' | 'verified-account';

/** `copy`: no share page — the text is copied and the platform's app / page opened (Discord, Slack, SPEC-r11 §10). */
export type HandoffVia =
  'deeplink' | 'share-intent' | 'import-url' | 'qrcode' | 'web-share' | 'copy';

/** One runtime a platform supports, in the platform's order of preference. */
export interface RuntimeSupport {
  runtime: Runtime;
  mode: RuntimeMode;
  /** What this way still needs: a login state, a fixed egress IP, a paid plan… */
  needs?: RuntimeNeed[];
  /** Can run at `scheduleAt` (only `server` truly can; `electron` catches up when it comes online). */
  schedulable?: boolean;
  /** Restricts this way to some content kinds. */
  kinds?: ContentKind[];
  /** `mode: 'handoff'`: how and where to hand over. */
  handoff?: { via: HandoffVia; url?: string };
  /** Shown to the user (简体 source); `notes` has it in the other languages (`runtimeNote`). */
  note?: string;
  notes?: I18nText;
}

/** `note` in `lang` (SPEC-r14 B5). */
export function runtimeNote(s: Pick<RuntimeSupport, 'note' | 'notes'>, lang?: string | null) {
  return s.note === undefined ? undefined : pickText(s.note, s.notes, lang);
}

/** Where the host runs and what else is reachable from it. */
export interface HostEnv {
  runtime: Runtime;
  /** Mobile H5 (still `runtime: 'web'`). */
  mobile?: boolean;
  /** The user has a desktop app online (API presence). */
  desktopOnline?: boolean;
  /** The server runner can publish on the user's behalf. */
  serverRelay?: boolean;
  /**
   * Bound accounts per platform key. Leave undefined when unknown: binding is then not checked.
   * Values are `AccountRef[]` in practice; only their count matters here.
   */
  accounts?: Record<string, readonly unknown[] | undefined>;
  /** Platforms switched off remotely (site script `flags.disabled`). */
  disabled?: readonly string[];
  links?: { downloadDesktop?: string; bind?: (platform: string) => string };
}

/** The unified answer to 「在这个端能不能发，不能的话怎么办」. */
export type GuideKind =
  | 'run-here'
  | 'server'
  | 'desktop'
  | 'download-desktop'
  | 'bind-first'
  | 'handoff'
  | 'copy'
  | 'unavailable';

export interface RuntimeGuide {
  kind: GuideKind;
  /** Short button / card text, e.g. 「由服务器代发（支持定时）」. */
  label: string;
  href?: string;
  /** Why this is offered. */
  reason?: string;
  /** `run-here`: how it runs. */
  mode?: RuntimeMode;
  /** `handoff`: the channel. */
  via?: HandoffVia;
  /** `desktop`: whether a desktop is online now (else the task waits in the queue). */
  online?: boolean;
  /** Can honour `scheduleAt`. */
  schedulable?: boolean;
  /** `unavailable`: why. */
  code?: 'no-runtime' | 'disabled-remotely' | 'kind-unsupported';
}

/** Anything plannable: a registry entry or an adapter. */
export interface PlanTarget {
  key: string;
  label: string;
  homepage?: string;
  contentTypes?: readonly ContentKind[];
  runtimes?: readonly RuntimeSupport[];
  /** Plain runtime list (legacy `Adapter.runtime`), used when `runtimes` is absent. */
  runtime?: readonly Runtime[];
  binding?: Pick<BindingSpec, 'kind'>;
}

export interface PlanOptions {
  scheduleAt?: string;
  /** Kind of content about to be published. Default `article`. */
  contentKind?: ContentKind;
  /** Language of the guide texts (SPEC-r14 B5). Default `zh-CN`. */
  lang?: SdkLang | string;
}

export interface RuntimePlan {
  platform: string;
  /** True when the first guide is `run-here`. */
  canPublish: boolean;
  /** The default way (`guides[0]`). */
  primary: RuntimeGuide;
  /** Every way, best first; always ends with `copy` unless the content kind is unsupported. */
  guides: RuntimeGuide[];
}

export const DEFAULT_GUIDE_LINKS = {
  downloadDesktop: '/download',
  bind: (platform: string) => `/settings?tab=platforms&bind=${platform}`,
};

/** `'node'` (deprecated) → `'server'`; other runtimes unchanged. */
export function normalizeRuntime<R extends Runtime>(runtime: R): Exclude<R, 'node'> | 'server' {
  return (runtime === 'node' ? 'server' : runtime) as Exclude<R, 'node'> | 'server';
}

/** `runtimes`, or the legacy `runtime` list read as official-API support. */
export function resolveRuntimes(
  target: Pick<PlanTarget, 'runtimes' | 'runtime'>
): RuntimeSupport[] {
  if (target.runtimes?.length)
    return target.runtimes.map((s) =>
      s.runtime === 'node' ? { ...s, runtime: normalizeRuntime(s.runtime) } : s
    );
  return (target.runtime ?? []).map((r) => {
    const runtime = normalizeRuntime(r);
    return {
      runtime,
      mode: 'api' as const,
      ...(runtime === 'server' ? { schedulable: true } : {}),
    };
  });
}

/** The plain runtime list of a target (what `Adapter.runtime` used to be). */
export function runtimeList(target: Pick<PlanTarget, 'runtimes' | 'runtime'>): Runtime[] {
  return [...new Set(resolveRuntimes(target).map((r) => r.runtime))];
}

function acceptsKind(support: RuntimeSupport, kind: ContentKind): boolean {
  return !support.kinds || support.kinds.includes(kind);
}

/**
 * Pure: for the current host, how this platform can be published, best way first (SPEC-r8 §12.2).
 *
 * 1. content kind not accepted → `unavailable` (kind-unsupported);
 * 2. switched off remotely → `unavailable` (disabled-remotely) + `copy`;
 * 3. needs an account and none is bound → `bind-first` first;
 * 4. the current runtime has an `api` / `automation` way (that can honour `scheduleAt`) → `run-here`;
 * 5. `server` supported (辰记's Python API) and the relay is up → `server` (服务器代发);
 * 6. `electron` supported → `desktop` (online or queued) and, in a desktop-less browser, `download-desktop`;
 * 7. a `handoff` way → `handoff` (app deeplinks only on a phone);
 * 8. always `copy` last.
 */
export function planRuntime(
  target: PlanTarget,
  hostEnv: HostEnv,
  opts: PlanOptions = {}
): RuntimePlan {
  const env: HostEnv = { ...hostEnv, runtime: normalizeRuntime(hostEnv.runtime) };
  const kind = opts.contentKind ?? 'article';
  const links = { ...DEFAULT_GUIDE_LINKS, ...env.links };
  const lang = opts.lang;
  const m = coreMessages(lang).runtime;
  const name = localizedLabel(target.key, target.label, lang);
  const where = m.names[normalizeRuntime(env.runtime) as 'web' | 'electron' | 'server'];
  const copy: RuntimeGuide = {
    kind: 'copy',
    label: m.copyLabel,
    ...(target.homepage ? { href: target.homepage } : {}),
    reason: m.copyReason,
  };
  const finish = (guides: RuntimeGuide[]): RuntimePlan => {
    const seen = new Set<string>();
    const unique = guides.filter((g) => {
      const id = `${g.kind}:${g.online ?? ''}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const primary = unique[0] ?? copy;
    return {
      platform: target.key,
      canPublish: primary.kind === 'run-here',
      primary,
      guides: unique,
    };
  };

  const contentTypes = target.contentTypes ?? ['article'];
  if (!contentTypes.includes(kind)) {
    return finish([
      {
        kind: 'unavailable',
        code: 'kind-unsupported',
        label: m.unsupportedLabel,
        reason: m.kindUnsupported(name, contentTypes.join(' / ')),
      },
    ]);
  }
  if (env.disabled?.includes(target.key)) {
    return finish([
      {
        kind: 'unavailable',
        code: 'disabled-remotely',
        label: m.disabledLabel,
        reason: m.disabledReason(name),
      },
      copy,
    ]);
  }

  const supports = resolveRuntimes(target).filter((s) => acceptsKind(s, kind));
  const guides: RuntimeGuide[] = [];

  // A hand-off (share intent, import URL) needs no account: only automatic ways ask to bind first.
  const automatic = supports.some((s) => s.mode === 'api' || s.mode === 'automation');
  if (
    automatic &&
    needsBinding(target.binding) &&
    env.accounts &&
    !env.accounts[target.key]?.length
  ) {
    guides.push({
      kind: 'bind-first',
      label: m.bindFirstLabel,
      href: links.bind(target.key),
      reason: m.bindFirstReason(name),
    });
  }

  // Automatic ways first; hand-offs and copy-paste come after the server / desktop relays.
  const here = supports.find(
    (s) => s.runtime === env.runtime && (s.mode === 'api' || s.mode === 'automation')
  );
  const scheduled = !!opts.scheduleAt;
  if (here && (!scheduled || env.runtime === 'server')) {
    guides.push({
      kind: 'run-here',
      label: here.mode === 'automation' ? m.runHereAutomation : m.runHereApi,
      mode: here.mode,
      schedulable: env.runtime === 'server',
      reason: m.runHereReason(where, name),
    });
  }

  // The hand-off works from any runtime (it is a link the user opens), after the automatic ways.
  let handoff: RuntimeGuide | undefined;
  for (const s of supports) {
    if (s.mode !== 'handoff') continue;
    const via = s.handoff?.via ?? 'deeplink';
    // An app deeplink, or the system share sheet with files (Web Share), only helps on a phone.
    if ((via === 'deeplink' || via === 'web-share') && !env.mobile) continue;
    handoff = {
      kind: 'handoff',
      label: m.handoff[via],
      via,
      ...(s.handoff?.url ? { href: s.handoff.url } : {}),
      reason: runtimeNote(s, lang) ?? m.handoffReason(name),
    };
    break;
  }

  const server = supports.find(
    (s) => s.runtime === 'server' && (s.mode === 'api' || s.mode === 'automation')
  );
  if (server && env.runtime !== 'server' && env.serverRelay) {
    guides.push({
      kind: 'server',
      label: m.serverLabel,
      schedulable: true,
      reason: here ? m.serverReasonSchedule : m.serverReasonCannot(where, name),
    });
  }

  // A desktop `handoff` way is the same hand-off as in the browser, not a reason to fetch the desktop app.
  const desktop = supports.find(
    (s) => s.runtime === 'electron' && (s.mode === 'api' || s.mode === 'automation')
  );
  if (desktop && env.runtime !== 'electron') {
    const reason = scheduled
      ? m.desktopScheduled
      : desktop.mode === 'automation'
        ? m.desktopNeedsSession(name)
        : m.desktopNeeds(name);
    if (env.desktopOnline) {
      guides.push({ kind: 'desktop', label: m.desktopOnlineLabel, online: true, reason });
    } else {
      if (env.runtime === 'web' && !env.mobile) {
        guides.push({
          kind: 'download-desktop',
          label: m.downloadDesktopLabel,
          href: links.downloadDesktop,
          reason: m.desktopOnlyReason(name),
        });
      }
      guides.push({ kind: 'desktop', label: m.desktopQueueLabel, online: false, reason });
    }
  }

  if (handoff) guides.push(handoff);
  guides.push(copy);
  return finish(guides);
}

/** `planRuntime` for many targets at once, keyed by platform. */
export function planPlatforms(
  targets: readonly PlanTarget[],
  env: HostEnv,
  opts: PlanOptions = {}
): Record<string, RuntimePlan> {
  const out: Record<string, RuntimePlan> = {};
  for (const t of targets) out[t.key] = planRuntime(t, env, opts);
  return out;
}
