import { needsBinding } from './binding';

import type { BindingSpec } from './binding';
import type { ContentKind } from './content';
import type { Runtime } from './types';

/**
 * How a platform is driven on a runtime (SPEC-r8 §12.2): an official `api`, site `automation` with a
 * login state, a `handoff` to the platform's own app / page, or `manual` copy-paste.
 */
export type RuntimeMode = 'api' | 'automation' | 'handoff' | 'manual';

export type RuntimeNeed =
  'session' | 'token' | 'fixed-ip' | 'premium' | 'app-review' | 'verified-account';

export type HandoffVia = 'deeplink' | 'share-intent' | 'import-url' | 'qrcode' | 'web-share';

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
  note?: string;
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

const RUNTIME_LABEL: Record<Runtime, string> = {
  web: '浏览器',
  electron: '桌面端',
  server: '服务器',
  node: '服务器',
};

/** `'node'` (deprecated) → `'server'`; other runtimes unchanged. */
export function normalizeRuntime<R extends Runtime>(runtime: R): Exclude<R, 'node'> | 'server' {
  return (runtime === 'node' ? 'server' : runtime) as Exclude<R, 'node'> | 'server';
}

const HANDOFF_LABEL: Record<HandoffVia, string> = {
  deeplink: '跳转 App 完成',
  'share-intent': '打开分享页完成',
  'import-url': '用导入链接发布',
  qrcode: '扫码在手机上完成',
  'web-share': '分享到 App 完成',
};

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
  const copy: RuntimeGuide = {
    kind: 'copy',
    label: '复制后手动发',
    ...(target.homepage ? { href: target.homepage } : {}),
    reason: '复制正文，到平台编辑器粘贴发布',
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
        label: '暂不支持',
        reason: `${target.label} 不接受这种内容（支持：${contentTypes.join(' / ')}）`,
      },
    ]);
  }
  if (env.disabled?.includes(target.key)) {
    return finish([
      {
        kind: 'unavailable',
        code: 'disabled-remotely',
        label: '暂时停用',
        reason: `${target.label} 的自动发布暂时停用（平台改版处理中）`,
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
      label: '先绑定账号',
      href: links.bind(target.key),
      reason: `还没有绑定${target.label}账号`,
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
      label: here.mode === 'automation' ? '本机自动发布' : '本机直接发',
      mode: here.mode,
      schedulable: env.runtime === 'server',
      reason: `${RUNTIME_LABEL[env.runtime]}可以直接发布到${target.label}`,
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
      label: HANDOFF_LABEL[via],
      via,
      ...(s.handoff?.url ? { href: s.handoff.url } : {}),
      reason: s.note ?? `在${target.label}自己的页面里完成发布`,
    };
    break;
  }

  const server = supports.find(
    (s) => s.runtime === 'server' && (s.mode === 'api' || s.mode === 'automation')
  );
  if (server && env.runtime !== 'server' && env.serverRelay) {
    guides.push({
      kind: 'server',
      label: '由服务器代发（支持定时）',
      schedulable: true,
      reason: here
        ? '交给服务器，可以定时发布'
        : `${RUNTIME_LABEL[env.runtime]}不能直接调用${target.label}`,
    });
  }

  // A desktop `handoff` way is the same hand-off as in the browser, not a reason to fetch the desktop app.
  const desktop = supports.find(
    (s) => s.runtime === 'electron' && (s.mode === 'api' || s.mode === 'automation')
  );
  if (desktop && env.runtime !== 'electron') {
    const reason = scheduled
      ? '桌面端上线后补发（桌面端不开就不能准点发布）'
      : `${target.label} 需要桌面端${desktop.mode === 'automation' ? '借登录态发布' : '发布'}`;
    if (env.desktopOnline) {
      guides.push({ kind: 'desktop', label: '交给桌面端', online: true, reason });
    } else {
      if (env.runtime === 'web' && !env.mobile) {
        guides.push({
          kind: 'download-desktop',
          label: '下载桌面端',
          href: links.downloadDesktop,
          reason: `${target.label} 只能在桌面端发布`,
        });
      }
      guides.push({ kind: 'desktop', label: '排队等桌面端上线', online: false, reason });
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
