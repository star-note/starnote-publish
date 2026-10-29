/**
 * Logged-in platform sessions on the desktop (SPEC-r8 决定记录 2026-10-19): platforms without an open API
 * (知乎、掘金、CSDN…) are bound by logging in on the platform's own page in a visible desktop window, one
 * session partition per account (`persist:pub-<platform>-<accountId>`). Cookies never leave that partition.
 *
 * This file only declares the contract. The implementation — the login window, the success check, the
 * in-page `sessionFetch` — lives in `starnote-desktop/src/main/platform-login/`.
 */
import { coreMessages } from './i18n/messages';

import type { SdkLang } from './i18n/lang';

/** Login succeeded as soon as ANY rule matches. */
export interface LoginSuccessRule {
  /** A cookie with a non-empty value appears (`domain` is a suffix match, default: any). */
  cookies?: Array<{ name: string; domain?: string }>;
  /** The window navigated to a URL matching this regular expression (source text). */
  urlMatch?: string;
  /**
   * SPEC-r13 §4b 通用模式: nothing above is known yet (no account has looked at the platform). The user logs in in the
   * window and confirms when closing it; no session check runs, the account shows as 「未验证」.
   */
  manual?: true;
}

/** A read-only endpoint that tells whether the session is still valid and who is logged in. */
export interface SessionCheckSpec {
  url: string;
  csrf?: { cookie: string; header: string };
  /** Valid only when the value at `path` equals `equals` (in addition to HTTP 2xx). */
  ok?: { path: string; equals: string | number | boolean };
  /**
   * `json` (default): `uid` / `nickname` / `avatar` are JSON paths. `text`: they are regular expressions (source,
   * first group) run on the HTML — for consoles that only expose the account in the page (公众号后台).
   */
  format?: 'json' | 'text';
  /** JSON paths (or regexes with `format: 'text'`) in the response. */
  uid: string;
  nickname: string;
  avatar?: string;
  /** HTTP statuses that mean「not logged in」. Default `[401, 403]`. */
  reloginStatus?: number[];
  /** Error codes (at `codePath`) that mean「not logged in」. */
  reloginCodes?: Array<string | number>;
  codePath?: string;
}

/** Everything the desktop needs to bind one platform. Carried by the signed site script (`session`). */
export interface DesktopSessionSpec {
  /** The platform's real login page. */
  loginUrl: string;
  /** Hosts the login / editor window may navigate to (suffix match, https only). */
  allowedHosts: string[];
  success: LoginSuccessRule;
  /** Required unless `success.manual` (通用模式). */
  check?: SessionCheckSpec;
  /**
   * A lightweight same-origin page that `sessionFetch` loads in a hidden window and fetches from (so the
   * request carries the site's own Origin and cookies, like the platform's editor does).
   */
  fetchPage: string;
}

export const SESSION_PARTITION_PREFIX = 'persist:pub-';
export const SESSION_PLATFORM_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const SESSION_ACCOUNT_RE = /^[a-z0-9]{1,16}$/;

/** `persist:pub-<platform>-<accountId>` */
export function sessionPartition(platform: string, accountId: string): string {
  if (!SESSION_PLATFORM_RE.test(platform)) throw new Error(`非法的平台 key：${platform}`);
  if (!SESSION_ACCOUNT_RE.test(accountId)) throw new Error(`非法的账号 id：${accountId}`);
  return `${SESSION_PARTITION_PREFIX}${platform}-${accountId}`;
}

/** A file part of a multipart body: bytes, or a URL the desktop downloads itself (no CORS, size-limited). */
export type SessionFile =
  | { kind: 'bytes'; name: string; type: string; base64: string }
  | { kind: 'url'; url: string; name?: string };

export interface SessionFetchInit {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** JSON body (sets `content-type: application/json`). */
  json?: unknown;
  /** urlencoded body. */
  urlencoded?: Record<string, string>;
  /** multipart body. */
  form?: Record<string, string | SessionFile>;
  /** Copies a cookie of the session into a header (CSRF). */
  csrf?: { cookie: string; header: string };
  /**
   * Appends query parameters read from the session's cookies (e.g. 掘金 `uuid` from the TEA cookie): the value is
   * URI-decoded and, with `jsonPath`, read from the cookie's JSON. Missing cookies add nothing.
   */
  cookieQuery?: Array<{ param: string; cookie: string; jsonPath?: string }>;
  /** Default 30 s. */
  timeoutMs?: number;
}

export interface SessionResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  text: string;
}

/**
 * Electron only: a request made inside the platform's own page of this partition (same-origin, the
 * session's cookies, no cookie ever crosses into our code). `partition` must be a `persist:pub-*` one.
 */
export type SessionFetch = (
  partition: string,
  url: string,
  init?: SessionFetchInit
) => Promise<SessionResponse>;

/** Layer 2: a declarative, read-only value from the page (run in an isolated world by the desktop). */
export type PageReadSpec =
  | { selector: string; prop: 'text' | 'value'; jsonPath?: string }
  | { selector: string; prop: 'attr'; attr: string }
  | { meta: string };

/**
 * The subset of the desktop `PublishPage` (SPEC-r2-electron §6.4) the session adapters use, in the three layers
 * of SPEC-r8「风控与真人化」: (1) prefer the platform's own endpoints via `sessionFetch`; (2) when page context is
 * needed, only `read` values in an isolated world; (3) for editor layout or signed APIs, open the editor and
 * `pasteHtml` / `insertText` (clipboard + `webContents.paste()`), leaving「发布」to the user. There is no
 * `evaluate` / `click` on account pages.
 */
export interface SessionPage {
  goto(url: string, opts?: { timeoutMs?: number }): Promise<void>;
  url(): Promise<string>;
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>;
  show(): Promise<void>;
  close(): Promise<void>;
  read?(spec: PageReadSpec): Promise<unknown>;
  insertText?(selector: string, text: string): Promise<void>;
  pasteHtml?(selector: string, content: { html?: string; text: string }): Promise<void>;
}

export function isSessionPage(page: unknown): page is SessionPage {
  const p = page as Partial<SessionPage> | null;
  return (
    !!p &&
    typeof p.goto === 'function' &&
    typeof p.show === 'function' &&
    typeof p.waitForSelector === 'function'
  );
}

/** `a.b.0.c` → value; `undefined` when any step is missing. */
export function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export type SessionCheckState = 'ok' | 'needs-relogin' | 'error';

export interface SessionCheckResult {
  state: SessionCheckState;
  uid?: string;
  nickname?: string;
  avatar?: string;
  detail?: string;
}

/** Pure: turns the check endpoint's answer into ok / needs-relogin / error (shared with the desktop). */
export function interpretSessionCheck(
  spec: SessionCheckSpec,
  res: { status: number; text: string },
  /** SPEC-r14 B5: language of `detail`. Default `zh-CN`. */
  lang?: SdkLang
): SessionCheckResult {
  const m = coreMessages(lang).session;
  const relogin = spec.reloginStatus ?? [401, 403];
  if (relogin.includes(res.status)) return { state: 'needs-relogin', detail: `HTTP ${res.status}` };
  if (spec.format === 'text') return interpretTextCheck(spec, res, lang);
  let json: unknown;
  try {
    json = JSON.parse(res.text);
  } catch {
    return {
      state: res.status >= 300 && res.status < 400 ? 'needs-relogin' : 'error',
      detail: m.httpNotJson(res.status),
    };
  }
  if (spec.codePath && spec.reloginCodes?.length) {
    const code = readPath(json, spec.codePath);
    if (spec.reloginCodes.some((c) => String(c) === String(code)))
      return { state: 'needs-relogin', detail: m.errorCode(String(code)) };
  }
  if (res.status < 200 || res.status >= 300)
    return { state: 'error', detail: `HTTP ${res.status}` };
  if (spec.ok && readPath(json, spec.ok.path) !== spec.ok.equals) {
    return {
      state: 'needs-relogin',
      detail: `${spec.ok.path} = ${JSON.stringify(readPath(json, spec.ok.path))}`,
    };
  }
  const uid = readPath(json, spec.uid);
  if (uid === undefined || uid === null || uid === '')
    return { state: 'needs-relogin', detail: m.noUserId };
  const nickname = readPath(json, spec.nickname);
  const avatar = spec.avatar ? readPath(json, spec.avatar) : undefined;
  return {
    state: 'ok',
    uid: String(uid),
    ...(typeof nickname === 'string' && nickname ? { nickname } : {}),
    ...(typeof avatar === 'string' && avatar ? { avatar } : {}),
  };
}

function firstGroup(source: string | undefined, text: string): string | undefined {
  if (!source) return undefined;
  try {
    const m = new RegExp(source).exec(text);
    return m ? (m.slice(1).find((g) => g !== undefined) ?? m[0]) : undefined;
  } catch {
    return undefined;
  }
}

/** `format: 'text'`: the account is read from the page with regexes; no uid means「not logged in」. */
function interpretTextCheck(
  spec: SessionCheckSpec,
  res: { status: number; text: string },
  lang?: SdkLang
): SessionCheckResult {
  if (res.status >= 500 || res.status === 0)
    return { state: 'error', detail: `HTTP ${res.status}` };
  const uid = firstGroup(spec.uid, res.text);
  if (!uid) return { state: 'needs-relogin', detail: coreMessages(lang).session.noLoginInfo };
  const nickname = firstGroup(spec.nickname, res.text);
  const avatar = firstGroup(spec.avatar, res.text);
  return {
    state: 'ok',
    uid,
    ...(nickname ? { nickname } : {}),
    ...(avatar && /^https:\/\//.test(avatar) ? { avatar } : {}),
  };
}

/**
 * One platform editor for the 发布台: the desktop opens `editorUrl` in the account's partition, fills the title
 * (`insertText`) and pastes the body (clipboard + `paste()`) using the selectors of its own signed site script,
 * and watches for the platform's success URL. Nothing here is code; the desktop validates every field.
 */
export interface HandoffRequest {
  /** Host-side id of this platform task (the desk reports status with it). */
  taskId: string;
  platform: string;
  accountId: string;
  /** The editor to open (must be on the platform's allowlist). */
  editorUrl: string;
  /** Absent: open the page as is (e.g. a 公众号 图文 already saved by API). */
  prefill?: { title?: string; html?: string; text?: string };
  /** For the tile header: from the SDK's platform registry / logos. */
  label?: string;
}

export interface HandoffTicket {
  /** `queued`: waiting for a free cell on the desk. */
  state: 'shown' | 'queued';
}

/** What the desk reports back for one task. */
export interface HandoffStatus {
  taskId: string;
  platform: string;
  state: 'waiting' | 'published' | 'attention' | 'cancelled';
  url?: string;
  detail?: string;
}
