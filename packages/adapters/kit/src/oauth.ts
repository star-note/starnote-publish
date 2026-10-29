/**
 * Official-API platforms bound with the user's own authorization (Blogger, WordPress.com, Tumblr, Reddit, Mastodon;
 * Bluesky has its own atproto client in `@starnote/publish-bluesky`). Browser-safe helpers for the **web** flow:
 *
 * - the page makes `state` (`w.` + random) and a PKCE pair, asks 辰记's API for the authorize URL
 *   (`POST /me/platform-oauth/{platform}/authorize`), opens it (a popup is best: the page keeps its memory);
 * - the platform redirects to 辰记's public callback, which bounces `w.` states to `{APP_URL}/oauth/callback/{platform}`;
 *   that page hands `code` / `state` back to the opener (`postMessage`, type `OAUTH_CALLBACK_MESSAGE`);
 * - the page trades the code at `POST /me/platform-oauth/{platform}/token` (the server adds the client secret and
 *   **stores nothing** unless `cloud: true`), and keeps the token in a `MemoryCredentialStore` — page memory only,
 *   never localStorage / sessionStorage / IndexedDB, gone with the page;
 * - publishing posts the SDK-rendered body to 辰记 with `credential` (the relay forwards it once and forgets it).
 *
 * The desktop app runs the same flow in its main process (`d.` states, deep link back) and keeps the token there.
 */
import { kitMessages } from './i18n';

import type { PublishContext, SdkLang } from '@starnote/publish-core';

export type OAuthPlatform =
  | 'blogger'
  | 'wordpress-com'
  | 'tumblr'
  | 'reddit'
  | 'mastodon'
  // SPEC-r11 §10: 辰记's API `platform_oauth.py` Spec gains these five
  | 'linkedin'
  | 'threads'
  | 'facebook'
  | 'instagram'
  | 'pinterest';

export const OAUTH_PLATFORMS: readonly OAuthPlatform[] = [
  'blogger',
  'wordpress-com',
  'tumblr',
  'reddit',
  'mastodon',
  'linkedin',
  'threads',
  'facebook',
  'instagram',
  'pinterest',
];

/** `postMessage` type the web callback page sends to its opener. */
export const OAUTH_CALLBACK_MESSAGE = 'starnote:platform-oauth';

/** What the relay needs to call the platform once (sent as `credential`, never stored by the server). */
export interface PlatformCredential {
  access_token: string;
  /** Mastodon: the instance host. */
  instance?: string;
}

export interface TokenSet {
  access_token: string;
  token_type?: string;
  /** ISO 8601, or null when the token does not expire. */
  expires_at?: string | null;
  refresh_token?: string;
  scope?: string;
}

export interface OAuthTarget {
  id: string;
  title: string;
  url?: string;
}

export interface OAuthAccount {
  external_uid: string;
  display_name: string;
  avatar_url?: string;
  url?: string;
  /** Blogs / sites / Pages / boards to publish to (Blogger, WordPress.com, Tumblr, Facebook, Pinterest); empty elsewhere. */
  targets: OAuthTarget[];
  meta?: Record<string, unknown>;
}

export interface TokenResult {
  platform: OAuthPlatform;
  token: TokenSet;
  account: OAuthAccount;
  cloud: boolean;
}

/* ---------------- randomness & PKCE (WebCrypto: browsers and Node ≥ 20) ---------------- */

function cryptoApi(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues || !c.subtle) throw new Error(kitMessages().oauth.noCrypto);
  return c;
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  cryptoApi().getRandomValues(b);
  return base64url(b);
}

/** `w.` (web) or `d.` (desktop) + 32 random bytes; 辰记's callback routes by the prefix. */
export function oauthState(client: 'web' | 'desktop' = 'web'): string {
  return `${client === 'web' ? 'w' : 'd'}.${randomToken(24)}`;
}

export const STATE_RE = /^[dw]\.[A-Za-z0-9_-]{16,128}$/;

/** RFC 7636 S256 pair. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const digest = await cryptoApi().subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/* ---------------- calls to 辰记's API ---------------- */

export interface OAuthApi {
  /** API root, e.g. `/api/v1`. */
  apiBase: string;
  /** Fetch carrying the 辰记 login. */
  fetch: typeof fetch;
  /** SPEC-r14 B5: language of the SDK's own error messages. Default `zh-CN`. */
  lang?: SdkLang;
}

export class OAuthApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'OAuthApiError';
    this.code = code;
    this.status = status;
  }
}

async function call<T>(api: OAuthApi, path: string, body: unknown): Promise<T> {
  const res = await api.fetch(`${api.apiBase.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  type Envelope = { code?: number; message?: string; data?: any };
  let env: Envelope | null;
  try {
    env = (await res.json()) as Envelope;
  } catch {
    env = null;
  }
  if (res.ok && env?.code === 0) return env.data as T;
  throw new OAuthApiError(
    env?.message || kitMessages(api.lang).oauth.httpFailed(res.status),
    env?.data?.error_code || `http_${res.status}`,
    res.status
  );
}

export interface WebAuthorization {
  platform: OAuthPlatform;
  authorizeUrl: string;
  state: string;
  /** Keep in page memory until the callback; sent once with the code. */
  verifier: string;
  instance?: string;
}

/**
 * Step 1 (web): the URL to open. `offline` asks for a refresh token (only useful with 「云端代发」; a token kept in
 * page memory dies with the page anyway).
 */
export async function startWebAuthorization(
  api: OAuthApi,
  platform: OAuthPlatform,
  opts: { instance?: string; offline?: boolean } = {}
): Promise<WebAuthorization> {
  const state = oauthState('web');
  const { verifier, challenge } = await pkcePair();
  const data = await call<{ authorize_url: string }>(
    api,
    `/me/platform-oauth/${platform}/authorize`,
    {
      client: 'web',
      state,
      code_challenge: challenge,
      offline: !!opts.offline,
      ...(opts.instance ? { instance: opts.instance } : {}),
    }
  );
  return {
    platform,
    authorizeUrl: data.authorize_url,
    state,
    verifier,
    ...(opts.instance ? { instance: opts.instance } : {}),
  };
}

export interface OAuthCallback {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/** Reads the callback page's query (`?code=&state=` or `?error=`). */
export function parseOAuthCallback(search: string): OAuthCallback {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const pick = (k: string) => q.get(k) ?? undefined;
  const out: OAuthCallback = {};
  const code = pick('code');
  const state = pick('state');
  const error = pick('error');
  const desc = pick('error_description');
  if (code) out.code = code;
  if (state) out.state = state;
  if (error) out.error = error;
  if (desc) out.errorDescription = desc;
  return out;
}

/**
 * Step 2 (web): trade the code. Checks `state` first. `cloud: true` (the user confirmed 「云端代发」) also stores
 * an encrypted copy on the server; otherwise the server keeps nothing.
 */
export async function completeWebAuthorization(
  api: OAuthApi,
  pending: WebAuthorization,
  callback: OAuthCallback,
  opts: { cloud?: boolean; targetId?: string } = {}
): Promise<TokenResult> {
  if (callback.error)
    throw new OAuthApiError(callback.errorDescription || callback.error, 'denied', 400);
  if (!callback.code || callback.state !== pending.state)
    throw new OAuthApiError(kitMessages(api.lang).oauth.stateMismatch, 'state_mismatch', 400);
  return call<TokenResult>(api, `/me/platform-oauth/${pending.platform}/token`, {
    code: callback.code,
    code_verifier: pending.verifier,
    ...(pending.instance ? { instance: pending.instance } : {}),
    cloud: !!opts.cloud,
    ...(opts.targetId ? { target_id: opts.targetId } : {}),
  });
}

/** A new access token for a refresh token the caller holds (Blogger, Tumblr, Reddit); nothing is stored. */
export async function refreshPlatformToken(
  api: OAuthApi,
  platform: OAuthPlatform,
  refreshToken: string
): Promise<TokenSet> {
  const data = await call<{ token: TokenSet }>(api, `/me/platform-oauth/${platform}/refresh`, {
    refresh_token: refreshToken,
  });
  return data.token;
}

/* ---------------- page-memory credentials ---------------- */

interface Held {
  credential: PlatformCredential;
  expiresAt?: number;
  account?: OAuthAccount;
  targetId?: string;
}

/**
 * Tokens held by the current page only (a plain `Map`, never persisted). `get` drops expired entries; `clear` on
 * sign-out. Pass `credentialFor` to the adapters.
 */
export class MemoryCredentialStore {
  private readonly items = new Map<string, Held>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  set(
    platform: string,
    token: TokenSet,
    extra: { instance?: string; account?: OAuthAccount; targetId?: string } = {}
  ): void {
    const expiresAt = token.expires_at ? Date.parse(token.expires_at) : undefined;
    this.items.set(platform, {
      credential: {
        access_token: token.access_token,
        ...(extra.instance ? { instance: extra.instance } : {}),
      },
      ...(expiresAt && !Number.isNaN(expiresAt) ? { expiresAt } : {}),
      ...(extra.account ? { account: extra.account } : {}),
      ...(extra.targetId ? { targetId: extra.targetId } : {}),
    });
  }

  get(platform: string): PlatformCredential | undefined {
    const h = this.items.get(platform);
    if (!h) return undefined;
    // 30 s of slack: a token about to expire would fail half-way.
    if (h.expiresAt !== undefined && h.expiresAt - 30_000 <= this.now()) {
      this.items.delete(platform);
      return undefined;
    }
    return h.credential;
  }

  account(platform: string): OAuthAccount | undefined {
    return this.get(platform) ? this.items.get(platform)?.account : undefined;
  }

  targetId(platform: string): string | undefined {
    return this.get(platform) ? this.items.get(platform)?.targetId : undefined;
  }

  has(platform: string): boolean {
    return this.get(platform) !== undefined;
  }

  delete(platform: string): void {
    this.items.delete(platform);
  }

  clear(): void {
    this.items.clear();
  }

  /** For adapter options: `credential: store.credentialFor`. */
  readonly credentialFor = (platform: string): PlatformCredential | undefined => this.get(platform);
}

/** Adapter option: where the page-memory credential comes from (web); absent on the desktop / with 云端代发. */
export type CredentialSource = (
  platform: string,
  ctx: Pick<PublishContext, 'runtime'>
) => PlatformCredential | undefined | Promise<PlatformCredential | undefined>;

/** The credential to send with the relay call: only in the browser, only when the page holds one. */
export async function credentialOf(
  source: CredentialSource | undefined,
  platform: string,
  ctx: Pick<PublishContext, 'runtime'>
): Promise<PlatformCredential | undefined> {
  if (!source || ctx.runtime !== 'web') return undefined;
  return (await source(platform, ctx)) ?? undefined;
}
