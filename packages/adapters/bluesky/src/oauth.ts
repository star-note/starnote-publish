/**
 * atproto OAuth for the **web** page (✅ atproto.com/specs/oauth): public client (no secret), PKCE S256, PAR and
 * DPoP (ES256) — all required. The client id is the URL of the metadata document 辰记's API serves
 * (`/api/v1/platform-oauth/bluesky/client-metadata.json`); the redirect goes to 辰记's public callback, which bounces
 * `w.` states back to the web app (the desktop app runs the same flow in its main process).
 *
 * Everything lives in page memory: the DPoP key is a **non-extractable** WebCrypto key, tokens are plain fields of
 * the `BlueskySession` object; nothing is written to storage and nothing is sent to 辰记's server. Public-client
 * sessions last at most two weeks ✅; access tokens ≤ 30 minutes, refreshed here (refresh tokens are single-use ✅).
 *
 *   resolve handle → DID → DID document (#atproto_pds) → PDS /.well-known/oauth-protected-resource
 *   → authorization server /.well-known/oauth-authorization-server → PAR (DPoP, nonce retry)
 *   → open authorization_endpoint?client_id&request_uri → callback (state, iss) → token (DPoP)
 *   → check `sub` (the DID) and that its PDS names the same authorization server → XRPC with DPoP + ath.
 */
import { base64url, oauthState, pkcePair, randomToken } from '@starnote/publish-kit';

import { BLUESKY_LIMITS, postUrl } from './limits';

import { msg } from './i18n';

import type { ReportItem, SdkLang } from '@starnote/publish-core';
import type { BlueskyPostRecord, BlueskyRelayBody } from './bluesky';

export const BLUESKY_SCOPE = 'atproto transition:generic';
/** Default entryway when the user gives no handle (✅ bsky.social hosts the Bluesky PDS entryway). */
export const BLUESKY_ENTRYWAY = 'https://bsky.social';
/** Public AppView used to resolve handles from a browser (CORS-enabled). */
export const BLUESKY_APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

export class BlueskyOAuthError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = 'BlueskyOAuthError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

interface Deps {
  fetch: typeof fetch;
  now?: () => number;
  /** SPEC-r14 B5: language of the error messages and the report. Default `zh-CN`. */
  lang?: SdkLang;
}

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle)
    throw new BlueskyOAuthError('当前环境没有 WebCrypto，无法授权 Bluesky', 'unsupported');
  return c.subtle;
}

const te = new TextEncoder();
const b64json = (v: unknown) => base64url(te.encode(JSON.stringify(v)));

async function getJson(deps: Deps, url: string): Promise<any> {
  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
  } catch (e) {
    throw new BlueskyOAuthError(
      msg(deps.lang).oauth.unreachable(new URL(url).host, (e as Error).message),
      'network'
    );
  }
  if (!res.ok)
    throw new BlueskyOAuthError(
      msg(deps.lang).oauth.http(new URL(url).host, res.status),
      'resolve',
      res.status
    );
  return res.json();
}

function httpsOrigin(raw: unknown, what: string, lang?: SdkLang): string {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new BlueskyOAuthError(msg(lang).oauth.badUrl(what), 'resolve');
  }
  if (u.protocol !== 'https:')
    throw new BlueskyOAuthError(msg(lang).oauth.notHttps(what), 'resolve');
  return u.origin;
}

/* ---------------- identity ---------------- */

export async function resolveHandle(deps: Deps, handle: string): Promise<string> {
  const data = await getJson(
    deps,
    `${BLUESKY_APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  );
  const did = String(data?.did ?? '');
  if (!/^did:(plc|web):[A-Za-z0-9._:%-]+$/.test(did))
    throw new BlueskyOAuthError(msg(deps.lang).oauth.handleNotFound(handle), 'resolve');
  return did;
}

/** The PDS from the DID document (`#atproto_pds`). */
export async function resolvePds(deps: Deps, did: string): Promise<string> {
  if (!/^did:(plc|web):[A-Za-z0-9._:%-]{1,2048}$/.test(did))
    throw new BlueskyOAuthError(msg(deps.lang).oauth.badDid(did), 'resolve');
  const url = did.startsWith('did:plc:')
    ? `${PLC_DIRECTORY}/${did}`
    : did.startsWith('did:web:')
      ? `https://${decodeURIComponent(did.slice('did:web:'.length)).split(':')[0]}/.well-known/did.json`
      : '';
  if (!url) throw new BlueskyOAuthError(msg(deps.lang).oauth.badDid(did), 'resolve');
  const doc = await getJson(deps, url);
  const svc = (Array.isArray(doc?.service) ? doc.service : []).find(
    (s: any) => s?.id === '#atproto_pds' || s?.id === `${did}#atproto_pds`
  );
  if (!svc?.serviceEndpoint) throw new BlueskyOAuthError(msg(deps.lang).oauth.noPds, 'resolve');
  return httpsOrigin(svc.serviceEndpoint, 'PDS', deps.lang);
}

export interface AuthServer {
  issuer: string;
  par: string;
  authorize: string;
  token: string;
}

export async function authServerOf(deps: Deps, pdsOrEntryway: string): Promise<AuthServer> {
  const t = msg(deps.lang).oauth;
  const origin = httpsOrigin(pdsOrEntryway, 'PDS', deps.lang);
  const pr = await getJson(deps, `${origin}/.well-known/oauth-protected-resource`);
  const as = httpsOrigin(pr?.authorization_servers?.[0], t.authServer, deps.lang);
  const meta = await getJson(deps, `${as}/.well-known/oauth-authorization-server`);
  if (meta?.issuer !== as) throw new BlueskyOAuthError(t.issuerMismatch, 'resolve');
  const need = [
    'pushed_authorization_request_endpoint',
    'authorization_endpoint',
    'token_endpoint',
  ];
  for (const k of need)
    if (typeof meta?.[k] !== 'string') throw new BlueskyOAuthError(t.serverMissing(k), 'resolve');
  return {
    issuer: as,
    par: meta.pushed_authorization_request_endpoint,
    authorize: meta.authorization_endpoint,
    token: meta.token_endpoint,
  };
}

/* ---------------- DPoP ---------------- */

export interface DpopKey {
  pair: CryptoKeyPair;
  jwk: { kty: string; crv: string; x: string; y: string };
}

/** A fresh P-256 key; the private half cannot be exported. */
export async function dpopKey(): Promise<DpopKey> {
  const pair = (await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = (await subtle().exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { pair, jwk: { kty: 'EC', crv: 'P-256', x: pub.x!, y: pub.y! } };
}

export async function dpopProof(
  key: DpopKey,
  htm: string,
  htu: string,
  opts: { nonce?: string; accessToken?: string; now?: number } = {}
): Promise<string> {
  const u = new URL(htu);
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.jwk };
  const payload: Record<string, unknown> = {
    jti: randomToken(16),
    htm,
    htu: `${u.origin}${u.pathname}`,
    iat: Math.floor((opts.now ?? Date.now()) / 1000),
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  if (opts.accessToken) {
    const h = await subtle().digest('SHA-256', te.encode(opts.accessToken));
    payload.ath = base64url(new Uint8Array(h));
  }
  const input = `${b64json(header)}.${b64json(payload)}`;
  const sig = await subtle().sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.pair.privateKey,
    te.encode(input)
  );
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

/** POST a form to the authorization server with DPoP, retrying once with the server's nonce. */
async function asPost(
  deps: Deps,
  key: DpopKey,
  nonces: Map<string, string>,
  url: string,
  form: Record<string, string>
): Promise<any> {
  const origin = new URL(url).origin;
  for (let attempt = 0; attempt < 2; attempt++) {
    const nonce = nonces.get(origin);
    const proof = await dpopProof(key, 'POST', url, {
      ...(nonce ? { nonce } : {}),
      now: deps.now?.(),
    });
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          DPoP: proof,
        },
        body: new URLSearchParams(form).toString(),
        credentials: 'omit',
      });
    } catch (e) {
      throw new BlueskyOAuthError(
        msg(deps.lang).oauth.asUnreachable((e as Error).message),
        'network'
      );
    }
    const fresh = res.headers.get('DPoP-Nonce');
    if (fresh) nonces.set(origin, fresh);
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (data?.error === 'use_dpop_nonce' && fresh && attempt === 0) continue;
    const code =
      data?.error === 'invalid_grant' ? 'relogin' : String(data?.error ?? `http_${res.status}`);
    throw new BlueskyOAuthError(
      msg(deps.lang).oauth.authFailed(String(data?.error_description ?? data?.error ?? res.status)),
      code,
      res.status
    );
  }
  throw new BlueskyOAuthError(msg(deps.lang).oauth.authFailed('DPoP nonce'), 'dpop');
}

/* ---------------- session ---------------- */

/** Page-memory session. Never serialize it: the key is non-extractable and the tokens must not reach storage. */
export interface BlueskySession {
  did: string;
  handle?: string;
  pds: string;
  server: AuthServer;
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt: number;
  key: DpopKey;
  /** DPoP nonces per origin (authorization server and PDS keep their own). */
  nonces: Map<string, string>;
}

export interface BlueskyClientConfig {
  /** `client_id`: the metadata URL from 辰记's `GET /platform-oauth/providers`. */
  clientId: string;
  redirectUri: string;
}

export interface PendingBlueskyAuth {
  authorizeUrl: string;
  state: string;
  verifier: string;
  server: AuthServer;
  key: DpopKey;
  nonces: Map<string, string>;
  expectedDid?: string;
  handle?: string;
  config: BlueskyClientConfig;
}

/** Step 1: resolve, PAR, and the URL to open (a popup keeps this page's memory). */
export async function startBlueskyAuthorization(
  deps: Deps,
  config: BlueskyClientConfig,
  opts: { handle?: string; client?: 'web' | 'desktop' } = {}
): Promise<PendingBlueskyAuth> {
  let expectedDid: string | undefined;
  let entry = BLUESKY_ENTRYWAY;
  if (opts.handle) {
    expectedDid = await resolveHandle(deps, opts.handle);
    entry = await resolvePds(deps, expectedDid);
  }
  const server = await authServerOf(deps, entry);
  const key = await dpopKey();
  const nonces = new Map<string, string>();
  const state = oauthState(opts.client ?? 'web');
  const { verifier, challenge } = await pkcePair();
  const par = await asPost(deps, key, nonces, server.par, {
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: BLUESKY_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(opts.handle ? { login_hint: opts.handle } : {}),
  });
  if (typeof par?.request_uri !== 'string')
    throw new BlueskyOAuthError(msg(deps.lang).oauth.noRequestUri, 'par');
  const url = new URL(server.authorize);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('request_uri', par.request_uri);
  return {
    authorizeUrl: url.toString(),
    state,
    verifier,
    server,
    key,
    nonces,
    ...(expectedDid ? { expectedDid } : {}),
    ...(opts.handle ? { handle: opts.handle } : {}),
    config,
  };
}

function sessionFromToken(
  pending: Pick<PendingBlueskyAuth, 'server' | 'key' | 'nonces' | 'config' | 'handle'>,
  tok: any,
  did: string,
  pds: string,
  now: number,
  lang?: SdkLang
): BlueskySession {
  if (typeof tok?.access_token !== 'string' || String(tok?.token_type).toLowerCase() !== 'dpop')
    throw new BlueskyOAuthError(msg(lang).oauth.notDpop, 'token');
  return {
    did,
    ...(pending.handle ? { handle: pending.handle } : {}),
    pds,
    server: pending.server,
    clientId: pending.config.clientId,
    accessToken: tok.access_token,
    ...(typeof tok.refresh_token === 'string' ? { refreshToken: tok.refresh_token } : {}),
    expiresAt: now + Math.max(60, Number(tok.expires_in) || 300) * 1000,
    key: pending.key,
    nonces: pending.nonces,
  };
}

/** Step 2: check the callback (`state`, `iss`), trade the code, check who signed in. */
export async function completeBlueskyAuthorization(
  deps: Deps,
  pending: PendingBlueskyAuth,
  callback: {
    code?: string;
    state?: string;
    iss?: string;
    error?: string;
    error_description?: string;
  }
): Promise<BlueskySession> {
  const t = msg(deps.lang).oauth;
  if (callback.error)
    throw new BlueskyOAuthError(callback.error_description || callback.error, 'denied');
  if (!callback.code || callback.state !== pending.state)
    throw new BlueskyOAuthError(t.stateMismatch, 'state_mismatch');
  if (callback.iss !== pending.server.issuer)
    throw new BlueskyOAuthError(t.issMismatch, 'issuer_mismatch');
  const tok = await asPost(deps, pending.key, pending.nonces, pending.server.token, {
    grant_type: 'authorization_code',
    code: callback.code,
    redirect_uri: pending.config.redirectUri,
    code_verifier: pending.verifier,
    client_id: pending.config.clientId,
  });
  const did = String(tok?.sub ?? '');
  if (!/^did:(plc|web):/.test(did)) throw new BlueskyOAuthError(t.noDid, 'token');
  if (pending.expectedDid && did !== pending.expectedDid)
    throw new BlueskyOAuthError(t.accountMismatch, 'account_mismatch');
  const pds = await resolvePds(deps, did);
  // the account's PDS must trust the issuer that signed us in
  const server = await authServerOf(deps, pds);
  if (server.issuer !== pending.server.issuer)
    throw new BlueskyOAuthError(t.pdsRejects, 'issuer_mismatch');
  return sessionFromToken(pending, tok, did, pds, deps.now?.() ?? Date.now(), deps.lang);
}

/** New tokens (refresh tokens are single-use: the session gets the new one). */
export async function refreshBlueskySession(
  deps: Deps,
  s: BlueskySession
): Promise<BlueskySession> {
  const t = msg(deps.lang).oauth;
  if (!s.refreshToken) throw new BlueskyOAuthError(t.expired, 'relogin');
  const tok = await asPost(deps, s.key, s.nonces, s.server.token, {
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
    client_id: s.clientId,
  });
  if (tok?.sub && tok.sub !== s.did)
    throw new BlueskyOAuthError(t.refreshMismatch, 'account_mismatch');
  const next = sessionFromToken(
    {
      server: s.server,
      key: s.key,
      nonces: s.nonces,
      config: { clientId: s.clientId, redirectUri: '' },
      ...(s.handle ? { handle: s.handle } : {}),
    },
    tok,
    s.did,
    s.pds,
    deps.now?.() ?? Date.now(),
    deps.lang
  );
  Object.assign(s, next);
  return s;
}

/* ---------------- XRPC on the PDS ---------------- */

export async function xrpc(
  deps: Deps & { signal?: AbortSignal },
  s: BlueskySession,
  method: 'GET' | 'POST',
  nsid: string,
  body?: { json?: unknown; bytes?: Uint8Array; mime?: string }
): Promise<any> {
  const t = msg(deps.lang).oauth;
  const now = () => deps.now?.() ?? Date.now();
  if (s.expiresAt - 30_000 <= now()) await refreshBlueskySession(deps, s);
  const url = `${s.pds}/xrpc/${nsid}`;
  const origin = s.pds;
  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = s.nonces.get(origin);
    const proof = await dpopProof(s.key, method, url, {
      accessToken: s.accessToken,
      ...(nonce ? { nonce } : {}),
      now: now(),
    });
    const headers: Record<string, string> = {
      Authorization: `DPoP ${s.accessToken}`,
      DPoP: proof,
      Accept: 'application/json',
    };
    let payload: BodyInit | undefined;
    if (body?.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body?.bytes) {
      headers['Content-Type'] = body.mime ?? 'application/octet-stream';
      payload = body.bytes as unknown as BodyInit;
    }
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method,
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
        credentials: 'omit',
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
    } catch (e) {
      throw new BlueskyOAuthError(t.pdsUnreachable((e as Error).message), 'network');
    }
    const fresh = res.headers.get('DPoP-Nonce');
    if (fresh) s.nonces.set(origin, fresh);
    if (res.ok) return res.json().catch(() => ({}));
    const www = res.headers.get('WWW-Authenticate') ?? '';
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && /use_dpop_nonce/.test(www + JSON.stringify(data)) && fresh) continue;
    if (
      res.status === 401 &&
      /invalid_token|ExpiredToken/i.test(www + JSON.stringify(data)) &&
      attempt === 0
    ) {
      await refreshBlueskySession(deps, s);
      continue;
    }
    if (res.status === 401) throw new BlueskyOAuthError(t.revoked, 'relogin', 401);
    if (res.status === 429) throw new BlueskyOAuthError(t.rateLimited, 'rate_limited', 429);
    throw new BlueskyOAuthError(
      t.refused(String(data?.message ?? data?.error ?? res.status)),
      res.status === 413 ? 'too_large' : 'invalid',
      res.status
    );
  }
  throw new BlueskyOAuthError(t.dpopFailed, 'dpop');
}

export interface DirectResult {
  url: string;
  uri: string;
  /** The record's content hash: with `uri`, what a reply needs (`reply.root` / `reply.parent`). */
  cid: string;
  rkey: string;
  report: ReportItem[];
}

/**
 * Web: post the rendered record straight to the PDS with the page-memory session. The card thumbnail is fetched
 * (same-origin 辰记 asset or another https URL) and uploaded first; a failure only drops the thumbnail.
 */
export async function publishBlueskyDirect(
  s: BlueskySession,
  body: BlueskyRelayBody,
  deps: Deps & { signal?: AbortSignal }
): Promise<DirectResult> {
  const report: ReportItem[] = [];
  const t = msg(deps.lang).oauth;
  const record = { ...body.record, createdAt: new Date(deps.now?.() ?? Date.now()).toISOString() };
  if (body.thumb_url && record.embed) {
    try {
      if (!/^https:\/\//i.test(body.thumb_url) && !body.thumb_url.startsWith('/'))
        throw new Error(t.httpsOnly);
      const res = await deps.fetch(body.thumb_url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim();
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(mime)) throw new Error(t.notImage);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > BLUESKY_LIMITS.thumbBytes) throw new Error(t.over1mb);
      const up = await xrpc(deps, s, 'POST', 'com.atproto.repo.uploadBlob', { bytes, mime });
      record.embed = { ...record.embed, external: { ...record.embed.external, thumb: up.blob } };
      report.push({ kind: 'image.rehosted', text: t.thumbUploaded, count: 1 });
    } catch (e) {
      report.push({
        kind: 'image.failed',
        level: 'warn',
        text: t.thumbFailed((e as Error).message),
      });
    }
  }
  const out = await createPostDirect(s, record, deps);
  return { ...out, report };
}

/** Web: create one `app.bsky.feed.post` record as given (the link comment's reply, SPEC-r12 §2.2). */
export async function createPostDirect(
  s: BlueskySession,
  record: BlueskyPostRecord,
  deps: Deps & { signal?: AbortSignal }
): Promise<Omit<DirectResult, 'report'>> {
  const out = await xrpc(deps, s, 'POST', 'com.atproto.repo.createRecord', {
    json: { repo: s.did, collection: 'app.bsky.feed.post', record },
  });
  const uri = String(out?.uri ?? '');
  const rkey = uri.split('/').pop() ?? '';
  return { uri, cid: String(out?.cid ?? ''), rkey, url: postUrl(uri, s.handle) };
}
