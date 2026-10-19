/**
 * Calls a platform's own web endpoints through the desktop session (`ctx.sessionFetch`), driven entirely by
 * the site script: URL, method, field names, constant fields, success check and result paths are data; the
 * adapter only says「call `createDraft` with this title and body」. Errors are classified into the three
 * actions the publish UI offers: not logged in → relogin, rate limited → retry, anything else → help; a captcha /
 * risk-control page is a `challenge` that the run hands to the user (`openSessionRun`), never solved by us.
 */
import { readPath } from './desktop-session';
import { fillTemplate } from './site-script';

import type {
  SessionFetch,
  SessionFetchInit,
  SessionFile,
  SessionResponse,
} from './desktop-session';
import type { SiteEndpoint, SiteErrorRule, SiteScript } from './site-script';
import type { PublishEventAction } from './types';

export type PlatformErrorKind = 'relogin' | 'retry' | 'help' | 'challenge';

const CODE: Record<PlatformErrorKind, string> = {
  relogin: 'relogin',
  retry: 'rate_limited',
  help: 'platform_error',
  challenge: 'challenge',
};

function retryLabel(sec?: number): string {
  if (!sec) return '稍后重试';
  if (sec >= 3600) return `${Math.ceil(sec / 3600)} 小时后重试`;
  if (sec >= 60) return `${Math.ceil(sec / 60)} 分钟后重试`;
  return `${sec} 秒后重试`;
}

/** Thrown by session adapters; `createPublisher` forwards `code` and `actions` on the `failed` event. */
export class PlatformSessionError extends Error {
  readonly code: string;
  readonly actions: PublishEventAction[];
  readonly status?: number;
  readonly platformCode?: string | number;
  /** `retry`: when to try again (post gate / Retry-After); the publisher labels the action with it. */
  readonly retryAfterSec?: number;
  /** `challenge`: the page where the user completes the verification. */
  readonly challengeUrl?: string;
  constructor(
    readonly kind: PlatformErrorKind,
    message: string,
    opts: {
      helpUrl?: string;
      status?: number;
      platformCode?: string | number;
      retryAfterSec?: number;
      challengeUrl?: string;
    } = {}
  ) {
    super(message);
    this.name = 'PlatformSessionError';
    this.code = CODE[kind];
    this.status = opts.status;
    this.platformCode = opts.platformCode;
    if (opts.retryAfterSec) this.retryAfterSec = opts.retryAfterSec;
    if (opts.challengeUrl) this.challengeUrl = opts.challengeUrl;
    this.actions =
      kind === 'relogin'
        ? [{ id: 'relogin', label: '重新登录', kind: 'relogin' }]
        : kind === 'retry'
          ? [{ id: 'retry', label: retryLabel(opts.retryAfterSec), kind: 'retry' }]
          : [
              {
                id: 'help',
                label: '查看帮助',
                kind: 'help',
                ...(opts.helpUrl ? { href: opts.helpUrl } : {}),
              },
              { id: 'retry', label: '重试', kind: 'retry' },
            ];
  }
}

function matchesRule(rule: SiteErrorRule | undefined, status: number, json: unknown): boolean {
  if (!rule) return false;
  if (rule.status?.includes(status)) return true;
  if (rule.codePath && rule.codes?.length) {
    const code = readPath(json, rule.codePath);
    if (code !== undefined && rule.codes.some((c) => String(c) === String(code))) return true;
  }
  return false;
}

function safeTest(source: string | undefined, text: string): boolean {
  if (!source) return false;
  try {
    return new RegExp(source).test(text);
  } catch {
    return false;
  }
}

function matchesChallenge(
  rule: SiteErrorRule,
  res: { status: number; text: string; url?: string },
  json: unknown
): boolean {
  if (matchesRule(rule, res.status, json)) return true;
  if (safeTest(rule.urlMatch, res.url ?? '')) return true;
  return safeTest(rule.textMatch, res.text.slice(0, 20_000));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pure: classifies one response (`null` = fine). Exposed for tests and for the check endpoint. */
export function classifyResponse(
  script: Pick<SiteScript, 'errors'>,
  endpoint: Pick<SiteEndpoint, 'ok' | 'format'>,
  res: Pick<SessionResponse, 'status' | 'text'> & { url?: string; headers?: Record<string, string> }
): {
  kind: PlatformErrorKind;
  detail: string;
  code?: string | number;
  gate?: boolean;
  retryAfterSec?: number;
} | null {
  const json = parseJson(res.text);
  // The desktop's post gate (minimum interval / daily cap): not the platform's answer, never sent to it.
  const gate = readPath(json, 'starnote_gate') as
    { reason?: string; retryAfterSec?: number; text?: string } | undefined;
  if (res.status === 429 && gate && typeof gate === 'object')
    return {
      kind: 'retry',
      detail: gate.text ?? '发得太频繁',
      gate: true,
      ...(gate.retryAfterSec ? { retryAfterSec: gate.retryAfterSec } : {}),
    };
  const challenge = script.errors?.challenge;
  if (challenge && matchesChallenge(challenge, res, json))
    return { kind: 'challenge', detail: '平台要求验证' };
  const codePath = script.errors?.relogin?.codePath ?? script.errors?.rateLimit?.codePath;
  const code = codePath ? (readPath(json, codePath) as string | number | undefined) : undefined;
  if (matchesRule(script.errors?.relogin, res.status, json))
    return {
      kind: 'relogin',
      detail: `HTTP ${res.status}`,
      ...(code !== undefined ? { code } : {}),
    };
  if (matchesRule(script.errors?.rateLimit, res.status, json))
    return { kind: 'retry', detail: `HTTP ${res.status}`, ...(code !== undefined ? { code } : {}) };
  if (res.status < 200 || res.status >= 300)
    return { kind: 'help', detail: `HTTP ${res.status}`, ...(code !== undefined ? { code } : {}) };
  if (endpoint.format === 'text') return null;
  if (json === undefined) {
    // Empty answers (HEAD, 204, PATCH without body) are fine unless a value was required.
    if (!res.text.trim() && !endpoint.ok) return null;
    return { kind: 'help', detail: '返回不是 JSON' };
  }
  if (endpoint.ok && readPath(json, endpoint.ok.path) !== endpoint.ok.equals) {
    const message =
      readPath(json, 'err_msg') ??
      readPath(json, 'base_resp.err_msg') ??
      readPath(json, 'errmsg') ??
      readPath(json, 'message') ??
      readPath(json, 'msg');
    return {
      kind: 'help',
      detail: typeof message === 'string' && message ? message : `${endpoint.ok.path} 不是预期值`,
      ...(code !== undefined ? { code } : {}),
    };
  }
  return null;
}

export interface SessionCallArgs {
  /** `{name}` placeholders in the URL. */
  vars?: Record<string, string | number>;
  /** Logical fields, renamed by `endpoint.fields`. */
  data?: Record<string, unknown>;
  /** File fields for multipart endpoints (logical name → file). */
  files?: Record<string, SessionFile>;
}

export interface SessionCallResult {
  json: unknown;
  /** `endpoint.result` paths resolved. */
  result: Record<string, unknown>;
}

export interface SessionClient {
  readonly partition: string;
  /** True when the script declares this endpoint and it needs no signature. */
  has(name: string): boolean;
  call(name: string, args?: SessionCallArgs): Promise<SessionCallResult>;
}

export interface SessionClientOptions {
  script: SiteScript;
  partition: string;
  sessionFetch: SessionFetch;
  /** 「知乎」, for messages. */
  label: string;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = target;
  for (const key of keys.slice(0, -1)) {
    const next = cur[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

/**
 * `static` (deep-copied) + the logical data renamed by `fields`; a target may be a dotted path
 * (`draftId` → `data.draft.id`). Without `fields`, logical names are used as-is.
 */
function buildBody(
  endpoint: Pick<SiteEndpoint, 'fields' | 'static'>,
  data: Record<string, unknown>
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(endpoint.static ?? {})) as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (endpoint.fields) {
      const target = endpoint.fields[k];
      if (target) setPath(out, target, v);
    } else out[k] = v;
  }
  return out;
}

/** Builds the `SessionFetchInit` for one endpoint (pure; exported for tests). */
export function buildSessionRequest(
  endpoint: SiteEndpoint,
  args: SessionCallArgs = {}
): { url: string; init: SessionFetchInit } {
  const vars = args.vars ?? {};
  const url = fillTemplate(endpoint.url, vars);
  const init: SessionFetchInit = { method: endpoint.method };
  if (endpoint.headers)
    init.headers = Object.fromEntries(
      Object.entries(endpoint.headers).map(([k, v]) => [k, fillTemplate(v, vars, { raw: true })])
    );
  if (endpoint.csrf) init.csrf = endpoint.csrf;
  if (endpoint.cookieQuery?.length) init.cookieQuery = endpoint.cookieQuery;
  if (endpoint.method === 'GET' || endpoint.method === 'HEAD' || endpoint.method === 'DELETE')
    return { url, init };
  const body = buildBody(endpoint, args.data ?? {});
  const type = endpoint.bodyType ?? 'json';
  if (type === 'multipart') {
    const form: Record<string, string | SessionFile> = {};
    for (const [k, v] of Object.entries(body))
      form[k] = typeof v === 'string' ? v : JSON.stringify(v);
    for (const [k, file] of Object.entries(args.files ?? {}))
      form[endpoint.fields?.[k] ?? k] = file;
    init.form = form;
  } else if (type === 'form') {
    init.urlencoded = Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
    );
  } else {
    init.json = body;
  }
  return { url, init };
}

export function createSessionClient(opts: SessionClientOptions): SessionClient {
  const { script, partition, sessionFetch, label } = opts;
  const helpUrl = script.urls.help ?? script.urls.home;
  const endpoint = (name: string): SiteEndpoint | undefined => script.endpoints?.[name];
  return {
    partition,
    has(name) {
      const e = endpoint(name);
      return !!e && !e.signed;
    },
    async call(name, args = {}) {
      const e = endpoint(name);
      if (!e)
        throw new PlatformSessionError('help', `${label}站点脚本里没有接口 ${name}`, { helpUrl });
      if (e.signed)
        throw new PlatformSessionError(
          'help',
          `${label}的接口 ${name} 需要平台签名，不能直接调用`,
          {
            helpUrl,
          }
        );
      const { url, init } = buildSessionRequest(e, args);
      let res: SessionResponse;
      try {
        res = await sessionFetch(partition, url, init);
      } catch (cause) {
        throw new PlatformSessionError(
          'help',
          `${label}请求失败：${cause instanceof Error ? cause.message : String(cause)}`,
          { helpUrl }
        );
      }
      const problem = classifyResponse(script, e, res);
      if (problem) {
        const text =
          problem.kind === 'relogin'
            ? `${label}登录已失效，需要重新登录`
            : problem.kind === 'challenge'
              ? `${label}要求完成验证`
              : problem.kind === 'retry'
                ? problem.gate
                  ? `${problem.detail}，为了像平时一样的发文节奏，这篇先不发`
                  : `${label}提示操作太频繁，请稍后再试`
                : `${label}返回错误：${problem.detail}`;
        const retryAfter =
          problem.retryAfterSec ?? (Number(res.headers['retry-after']) || undefined);
        const challengeUrl =
          problem.kind === 'challenge'
            ? (script.errors?.challenge?.pageUrl ??
              (res.url && !/\/api\/|\/cgi-bin\/|api\./.test(res.url) ? res.url : undefined) ??
              script.urls.verify ??
              script.urls.home)
            : undefined;
        throw new PlatformSessionError(problem.kind, text, {
          helpUrl,
          status: res.status,
          ...(problem.code !== undefined ? { platformCode: problem.code } : {}),
          ...(retryAfter ? { retryAfterSec: retryAfter } : {}),
          ...(challengeUrl ? { challengeUrl } : {}),
        });
      }
      const json = parseJson(res.text);
      const result: Record<string, unknown> = {};
      for (const [k, path] of Object.entries(e.result ?? {})) result[k] = readPath(json, path);
      for (const [k, source] of Object.entries(e.resultRegex ?? {})) {
        let m: RegExpExecArray | null = null;
        try {
          m = new RegExp(source).exec(res.text);
        } catch {
          m = null;
        }
        result[k] = m ? (m.slice(1).find((g) => g !== undefined) ?? m[0]) : undefined;
      }
      for (const [k, h] of Object.entries(e.resultHeaders ?? {})) {
        const raw = res.headers[h.header.toLowerCase()] ?? res.headers[h.header];
        result[k] =
          raw === undefined ? undefined : h.split ? raw.split(h.split)[h.index ?? 0] : raw;
      }
      return { json, result };
    },
  };
}
