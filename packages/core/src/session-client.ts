/**
 * Calls a platform's own web endpoints through the desktop session (`ctx.sessionFetch`), driven entirely by
 * the site script: URL, method, field names, constant fields, success check and result paths are data; the
 * adapter only says「call `createDraft` with this title and body」. Errors are classified into the three
 * actions the publish UI offers: not logged in → relogin, rate limited → retry, anything else → help; a captcha /
 * risk-control page is a `challenge` that the run hands to the user (`openSessionRun`), never solved by us.
 */
import { readPath } from './desktop-session';
import { coreMessages } from './i18n/messages';
import { fillTemplate } from './site-script';

import type {
  SessionFetch,
  SessionFetchInit,
  SessionFile,
  SessionResponse,
} from './desktop-session';
import type { SiteEndpoint, SiteErrorRule, SiteScript } from './site-script';
import type { SdkLang } from './i18n/lang';
import type { PublishEventAction } from './types';

export type PlatformErrorKind = 'relogin' | 'retry' | 'help' | 'challenge';

const CODE: Record<PlatformErrorKind, string> = {
  relogin: 'relogin',
  retry: 'rate_limited',
  help: 'platform_error',
  challenge: 'challenge',
};

function retryLabel(sec?: number, lang?: string): string {
  const m = coreMessages(lang);
  if (!sec) return m.common.retryLater;
  if (sec >= 3600) return m.common.retryAfter(m.wait.hours(Math.ceil(sec / 3600)));
  if (sec >= 60) return m.common.retryAfter(m.wait.minutes(Math.ceil(sec / 60)));
  return m.common.retryAfter(m.wait.seconds(sec));
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
      /** SPEC-r14 B5: language of the action labels. Default `zh-CN`. */
      lang?: SdkLang;
    } = {}
  ) {
    super(message);
    const m = coreMessages(opts.lang).common;
    this.name = 'PlatformSessionError';
    this.code = CODE[kind];
    this.status = opts.status;
    this.platformCode = opts.platformCode;
    if (opts.retryAfterSec) this.retryAfterSec = opts.retryAfterSec;
    if (opts.challengeUrl) this.challengeUrl = opts.challengeUrl;
    this.actions =
      kind === 'relogin'
        ? [{ id: 'relogin', label: m.relogin, kind: 'relogin' }]
        : kind === 'retry'
          ? [{ id: 'retry', label: retryLabel(opts.retryAfterSec, opts.lang), kind: 'retry' }]
          : [
              {
                id: 'help',
                label: m.viewHelp,
                kind: 'help',
                ...(opts.helpUrl ? { href: opts.helpUrl } : {}),
              },
              { id: 'retry', label: m.retry, kind: 'retry' },
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
  res: Pick<SessionResponse, 'status' | 'text'> & {
    url?: string;
    headers?: Record<string, string>;
  },
  /** SPEC-r14 B5: language of `detail`. Default `zh-CN`. */
  lang?: SdkLang
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
      detail: gate.text ?? coreMessages(lang).session.tooFrequent,
      gate: true,
      ...(gate.retryAfterSec ? { retryAfterSec: gate.retryAfterSec } : {}),
    };
  const challenge = script.errors?.challenge;
  if (challenge && matchesChallenge(challenge, res, json))
    return { kind: 'challenge', detail: coreMessages(lang).session.verifyRequired };
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
    return { kind: 'help', detail: coreMessages(lang).session.notJson };
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
      detail:
        typeof message === 'string' && message
          ? message
          : coreMessages(lang).session.unexpected(endpoint.ok.path),
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
  /** 「知乎」, for messages (in `lang`, see `localizedLabel`). */
  label: string;
  /** SPEC-r14 B5: language of the error messages and their actions. Default `zh-CN`. */
  lang?: SdkLang;
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
  const { script, partition, sessionFetch, label, lang } = opts;
  const m = coreMessages(lang).session;
  const L = lang ? { lang } : {};
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
      if (!e) throw new PlatformSessionError('help', m.noEndpoint(label, name), { helpUrl, ...L });
      if (e.signed)
        throw new PlatformSessionError('help', m.signedEndpoint(label, name), {
          helpUrl,
          ...L,
        });
      const { url, init } = buildSessionRequest(e, args);
      let res: SessionResponse;
      try {
        res = await sessionFetch(partition, url, init);
      } catch (cause) {
        throw new PlatformSessionError(
          'help',
          m.requestFailed(label, cause instanceof Error ? cause.message : String(cause)),
          { helpUrl, ...L }
        );
      }
      const problem = classifyResponse(script, e, res, lang);
      if (problem) {
        const text =
          problem.kind === 'relogin'
            ? m.loginExpired(label)
            : problem.kind === 'challenge'
              ? m.challenge(label)
              : problem.kind === 'retry'
                ? problem.gate
                  ? m.gated(problem.detail)
                  : m.rateLimited(label)
                : m.platformError(label, problem.detail);
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
          ...L,
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
