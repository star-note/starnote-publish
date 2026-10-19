/**
 * Signed site scripts (SPEC-r8 §12.6): the fragile parts of a logged-in platform — URLs, field names, JSON
 * paths, selectors, login-success rules, the read-only check endpoint — are plain JSON signed with Ed25519.
 * Adapters ship a bundled copy and may load a newer one from `GET {apiBase}/publish/site-scripts/{platform}`;
 * nothing in a script is ever evaluated as code.
 *
 * Browser-safe: WebCrypto only (Ed25519 is in Chromium 113+ / Electron 25+ / Node 22).
 */
import type { DesktopSessionSpec } from './desktop-session';
import type { LearnedRule } from './learned';

/** Version of `@starnote/publish-core` that `minCore` is compared with. */
export const CORE_VERSION = '0.1.0';

/** Public keys that may sign site scripts, by `kid` (base64url of the raw 32-byte Ed25519 key). */
export const SITE_SCRIPT_KEYS: Readonly<Record<string, string>> = {
  /**
   * Development key: signs the bundled defaults and the tests; its private half is in
   * `packages/core/test/fixtures/site-script-dev-key.json`. Replace with the production key (kept offline)
   * before scripts are served remotely.
   */
  'dev-2026-10': 'JwLsn8OOo-4pSfGQh79tkaulQkbxmgNT3bnOrym7py0',
};

export type SiteHttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One platform endpoint, as data. `{name}` placeholders in `url` are filled URL-encoded, `{+name}` raw (a whole
 * URL from an earlier response); header values take `{name}` raw.
 */
export interface SiteEndpoint {
  method: SiteHttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Copy this cookie's value into this header (CSRF tokens such as 知乎 `_xsrf` → `x-xsrftoken`). */
  csrf?: { cookie: string; header: string };
  /** Query parameters taken from session cookies (see `SessionFetchInit.cookieQuery`). */
  cookieQuery?: Array<{ param: string; cookie: string; jsonPath?: string }>;
  /** `json` (default), `form` (urlencoded) or `multipart` (file upload). */
  bodyType?: 'json' | 'form' | 'multipart';
  /** Logical field → the platform's field name (`title` → `title`, `markdown` → `mark_content`…). */
  fields?: Record<string, string>;
  /** Constant body fields sent as-is. */
  static?: Record<string, unknown>;
  /** Logical result → JSON path in the response (`id` → `data.id`). */
  result?: Record<string, string>;
  /**
   * `text`: the answer is HTML / text, not JSON (公众号后台首页). Only `resultRegex` / `resultHeaders` apply and no
   * JSON is required. Default `json`.
   */
  format?: 'json' | 'text';
  /** Logical result → a regular expression (source) run on the response text; the first group is the value. */
  resultRegex?: Record<string, string>;
  /** Logical result → a response header, optionally split (`x-ware-csrf-token` split `,` index 1). */
  resultHeaders?: Record<string, { header: string; split?: string; index?: number }>;
  /** The call succeeded only when the value at `path` equals `equals` (e.g. `err_no` = 0). */
  ok?: { path: string; equals: string | number | boolean };
  /**
   * The endpoint needs a request signature computed by the platform's own front-end (x-zse-96, x-ca-signature…).
   * We never compute those: adapters treat a signed endpoint as unavailable and hand off to the editor instead.
   */
  signed?: boolean;
  note?: string;
}

/** How to recognise errors in any response of the platform. */
export interface SiteErrorRule {
  status?: number[];
  /** `challenge` only: the response text or final URL matches (captcha / risk-control page). */
  textMatch?: string;
  urlMatch?: string;
  /** `challenge` only: the page to show the user (default: the response URL, else `urls.verify` / `urls.home`). */
  pageUrl?: string;
  /** Error codes at `codePath` (e.g. `err_no`, `error.code`). */
  codes?: Array<string | number>;
  codePath?: string;
}

export interface SiteScript {
  platform: string;
  /** semver of the script itself. */
  version: string;
  /** Lowest `@starnote/publish-core` version that understands it. */
  minCore: string;
  issuedAt: string;
  expiresAt?: string;
  urls: Record<string, string>;
  selectors: Record<string, string>;
  endpoints?: Record<string, SiteEndpoint>;
  waits?: Record<string, { selector?: string; urlMatch?: string; timeoutMs: number }>;
  /** Platform limits that may change (titleMax, summaryMin, tagsMax …). */
  limits?: Record<string, number>;
  /**
   * Rules learned from real rejections and approved by an admin (SPEC-r9-compliance-learning): the increment the
   * backend exports; clients pass them to `checkCompliance(platform, doc, extraRules)`. Data only, like the rest.
   */
  learnedRules?: LearnedRule[];
  /**
   * 发布台：the user published when the editor page navigates to a URL matching `urlMatch` (observed passively;
   * the first capture group is the article id). `articleUrl` (`{id}`) builds the link; default: the URL itself.
   */
  published?: { urlMatch: string; articleUrl?: string };
  /** Desktop login window and session check (SPEC-r8 决定记录 2026-10-19). */
  session?: DesktopSessionSpec;
  /** Error classification: not logged in → relogin, rate limited → retry. */
  errors?: { relogin?: SiteErrorRule; rateLimit?: SiteErrorRule; challenge?: SiteErrorRule };
  /**
   * 节奏（SPEC-r8「风控与真人化」）：同一账号串行、步骤间随机间隔、最小发文间隔、每日上限、退避。
   * 由桌面端主进程在 `sessionFetch` 里执行（所有请求的唯一出口）。
   */
  pacing?: {
    minDelayMs?: number;
    maxDelayMs?: number;
    minPostIntervalMin?: number;
    dailyMax?: number;
    /** 算「发一篇」的请求：`METHOD 正则`。 */
    postRequests?: string[];
    backoff?: { baseMs: number; maxMs: number; retries: number };
  };
  /** `disabled`: remote kill switch, every client falls back to copy-paste. */
  flags?: { disabled?: boolean; [k: string]: boolean | number | string | undefined };
  /** Things nobody could verify yet (shown in logs, not to users). */
  unverified?: string[];
}

export interface SignedSiteScript {
  /** Key id, so keys can rotate. */
  kid: string;
  alg: 'Ed25519';
  /** base64url(JSON of the SiteScript), exactly the bytes that were signed. */
  payload: string;
  /** base64url Ed25519 signature over the UTF-8 bytes of `payload`. */
  sig: string;
}

export type SiteScriptErrorCode =
  | 'bad-format'
  | 'unknown-key'
  | 'bad-signature'
  | 'expired'
  | 'wrong-platform'
  | 'min-core'
  | 'no-crypto';

export class SiteScriptError extends Error {
  constructor(
    readonly code: SiteScriptErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SiteScriptError';
  }
}

/* ---------------------------------------------------------------- base64url */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64[n & 63]!;
  }
  return out;
}

export function base64UrlDecode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (/[^A-Za-z0-9_-]/.test(clean) || clean.length % 4 === 1) {
    throw new SiteScriptError('bad-format', '不是合法的 base64url');
  }
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/* ---------------------------------------------------------------- semver */

/** -1 / 0 / 1 comparing `a.b.c` versions (pre-release tags ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a
    .split('-')[0]!
    .split('.')
    .map((n) => Number(n) || 0);
  const pb = b
    .split('-')[0]!
    .split('.')
    .map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/* ---------------------------------------------------------------- crypto */

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new SiteScriptError('no-crypto', '当前环境没有 WebCrypto，无法校验站点脚本');
  return s;
}

async function importPublicKey(key: string | CryptoKey): Promise<CryptoKey> {
  if (typeof key !== 'string') return key;
  return subtle().importKey(
    'raw',
    base64UrlDecode(key) as BufferSource,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
}

export interface VerifyOptions {
  /** Default `SITE_SCRIPT_KEYS`. */
  publicKeys?: Readonly<Record<string, string | CryptoKey>>;
  /** Reject a script for another platform. */
  platform?: string;
  /** Default `new Date()`. */
  now?: Date;
  /** Default `CORE_VERSION`. */
  coreVersion?: string;
  /** Accept an expired script (only for the bundled copy, which ships with the code). */
  allowExpired?: boolean;
}

/** Verifies the signature, platform, expiry and `minCore`; returns the script or throws `SiteScriptError`. */
export async function verifySiteScript(
  signed: SignedSiteScript,
  opts: VerifyOptions = {}
): Promise<SiteScript> {
  if (
    !signed ||
    typeof signed !== 'object' ||
    typeof signed.payload !== 'string' ||
    typeof signed.sig !== 'string' ||
    typeof signed.kid !== 'string'
  ) {
    throw new SiteScriptError('bad-format', '站点脚本格式不对');
  }
  if (signed.alg !== 'Ed25519')
    throw new SiteScriptError('bad-format', `不支持的算法 ${signed.alg}`);
  const keys = opts.publicKeys ?? SITE_SCRIPT_KEYS;
  // Own keys only: a `kid` such as `constructor` must not reach `Object.prototype`.
  const raw = Object.hasOwn(keys, signed.kid) ? keys[signed.kid] : undefined;
  if (!raw) throw new SiteScriptError('unknown-key', `未知的签名密钥 ${signed.kid}`);
  const key = await importPublicKey(raw);
  const ok = await subtle().verify(
    { name: 'Ed25519' },
    key,
    base64UrlDecode(signed.sig) as BufferSource,
    utf8(signed.payload) as BufferSource
  );
  if (!ok) throw new SiteScriptError('bad-signature', '站点脚本签名校验失败');

  let script: SiteScript;
  try {
    script = JSON.parse(new TextDecoder().decode(base64UrlDecode(signed.payload))) as SiteScript;
  } catch {
    throw new SiteScriptError('bad-format', '站点脚本内容不是 JSON');
  }
  if (!script || typeof script.platform !== 'string' || typeof script.version !== 'string') {
    throw new SiteScriptError('bad-format', '站点脚本缺少 platform / version');
  }
  if (opts.platform && script.platform !== opts.platform) {
    throw new SiteScriptError(
      'wrong-platform',
      `站点脚本属于 ${script.platform}，不是 ${opts.platform}`
    );
  }
  const now = (opts.now ?? new Date()).getTime();
  if (!opts.allowExpired && script.expiresAt && Date.parse(script.expiresAt) <= now) {
    throw new SiteScriptError('expired', `站点脚本已于 ${script.expiresAt} 过期`);
  }
  if (script.minCore && compareVersions(opts.coreVersion ?? CORE_VERSION, script.minCore) < 0) {
    throw new SiteScriptError('min-core', `站点脚本需要 publish-core ≥ ${script.minCore}`);
  }
  return script;
}

/** Signs a script (offline tooling and tests; the production private key never ships). */
export async function signSiteScript(
  script: SiteScript,
  privateKey: CryptoKey,
  kid: string
): Promise<SignedSiteScript> {
  const payload = base64UrlEncode(utf8(JSON.stringify(script)));
  const sig = new Uint8Array(
    await subtle().sign({ name: 'Ed25519' }, privateKey, utf8(payload) as BufferSource)
  );
  return { kid, alg: 'Ed25519', payload, sig: base64UrlEncode(sig) };
}

/** Decodes a payload without verifying it (display / diff only — never use the result to act). */
export function peekSiteScript(signed: SignedSiteScript): SiteScript {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(signed.payload))) as SiteScript;
}

export interface LoadSiteScriptOptions extends Omit<VerifyOptions, 'platform' | 'allowExpired'> {
  /** The copy shipped with the adapter. */
  bundled: SignedSiteScript;
  /** Fetch for our own API; absent → bundled only. */
  fetch?: typeof fetch;
  /** API root, e.g. `/api/v1`. */
  apiBase?: string;
  /** Default true when `fetch` is given. */
  remote?: boolean;
}

export interface LoadedSiteScript {
  script: SiteScript;
  source: 'remote' | 'bundled';
  /** Why the remote copy was not used (to `emit` as a warn log). */
  warnings: string[];
}

/**
 * The remote script when it verifies and is not older than the bundled one, else the bundled copy.
 * Remote failures never fail a publish; they come back as `warnings`.
 */
export async function loadSiteScript(
  platform: string,
  opts: LoadSiteScriptOptions
): Promise<LoadedSiteScript> {
  const warnings: string[] = [];
  const bundled = await verifySiteScript(opts.bundled, { ...opts, platform, allowExpired: true });
  if (bundled.expiresAt && Date.parse(bundled.expiresAt) <= (opts.now ?? new Date()).getTime()) {
    warnings.push(`随包站点脚本已过期（${bundled.expiresAt}），仍按它执行`);
  }
  if (opts.fetch && opts.remote !== false) {
    const base = (opts.apiBase ?? '/api/v1').replace(/\/$/, '');
    try {
      const res = await opts.fetch(`${base}/publish/site-scripts/${encodeURIComponent(platform)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const remote = await verifySiteScript((await res.json()) as SignedSiteScript, {
        ...opts,
        platform,
      });
      if (compareVersions(remote.version, bundled.version) >= 0) {
        return { script: remote, source: 'remote', warnings };
      }
      warnings.push(`远程站点脚本 ${remote.version} 比随包的 ${bundled.version} 旧，已忽略`);
    } catch (e) {
      warnings.push(
        `远程站点脚本不可用，改用随包副本：${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return { script: bundled, source: 'bundled', warnings };
}

/**
 * Fills `{name}` placeholders URL-encoded and `{+name}` raw; unknown names are left as-is.
 * `raw: true` fills every placeholder raw (header values).
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string | number>,
  opts: { raw?: boolean } = {}
): string {
  return template.replace(/\{(\+?)(\w+)\}/g, (m, plus: string, name: string) =>
    name in vars
      ? plus || opts.raw
        ? String(vars[name])
        : encodeURIComponent(String(vars[name]))
      : m
  );
}
