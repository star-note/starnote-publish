import { describe, expect, it } from 'vitest';

import type { BlueskySession } from '../src/index';

import {
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch as kitMockFetch,
  runPublish,
} from '../../kit/test/helpers';
import {
  blueskyAdapter,
  completeBlueskyAuthorization,
  createBlueskyAdapter,
  dpopKey,
  dpopProof,
  BlueskyOAuthError,
  blueskyReplyRecord,
  blueskyWriteError,
  graphemes,
  linkFacets,
  postUrl,
  publishBlueskyDirect,
  renderBluesky,
  startBlueskyAuthorization,
  tagFacets,
} from '../src/index';

const NOW = new Date('2026-10-19T00:00:00Z');

/** The kit mock parses string bodies as JSON; OAuth endpoints get forms, so keep those as text. */
function mockFetch(routes: Parameters<typeof kitMockFetch>[0]) {
  const inner = kitMockFetch(routes);
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const isForm = String(new Headers(init.headers).get('Content-Type')).includes(
      'x-www-form-urlencoded'
    );
    if (!isForm) return inner.fetch(input, init);
    return inner.fetch(input, { ...init, body: JSON.stringify(String(init.body)) });
  }) as typeof globalThis.fetch;
  return { fetch, calls: inner.calls };
}

describe('renderBluesky', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL, lang: 'zh-CN' };

  it('text + hashtag facets (UTF-8 offsets) + link card + thumbnail', () => {
    const r = renderBluesky(
      doc,
      blueskyAdapter.schema.parse({}),
      {
        title: '你好 Hello',
        summary: 'One line',
        tags: ['TypeScript', '前端'],
        cover: '/covers/c.png',
      },
      content,
      { assetBase: 'https://starnote.app/', now: () => NOW }
    );
    expect(r.body.record).toMatchObject({
      $type: 'app.bsky.feed.post',
      text: '你好 Hello\n\nOne line\n\n#TypeScript #前端',
      createdAt: NOW.toISOString(),
      langs: ['zh'],
      embed: {
        $type: 'app.bsky.embed.external',
        external: { uri: CANONICAL, title: '你好 Hello' },
      },
    });
    const text = r.body.record.text;
    const bytes = new TextEncoder().encode(text);
    const f = r.body.record.facets!;
    expect(new TextDecoder().decode(bytes.slice(f[0]!.index.byteStart, f[0]!.index.byteEnd))).toBe(
      '#TypeScript'
    );
    expect(new TextDecoder().decode(bytes.slice(f[1]!.index.byteStart, f[1]!.index.byteEnd))).toBe(
      '#前端'
    );
    expect(r.body.thumb_url).toBe('https://starnote.app/covers/c.png');
  });

  it('fits 300 graphemes; without a card the link is in the text with a link facet', () => {
    const r = renderBluesky(
      doc,
      blueskyAdapter.schema.parse({ link_card: false }),
      { title: '👍🏽'.repeat(100), summary: 'x'.repeat(500), tags: ['a1'] },
      content
    );
    expect(graphemes(r.body.record.text).length).toBeLessThanOrEqual(300);
    expect(r.body.record.text.endsWith(CANONICAL)).toBe(true);
    expect(r.body.record.facets!.at(-1)!.features[0]).toEqual({
      $type: 'app.bsky.richtext.facet#link',
      uri: CANONICAL,
    });
    expect(r.body.record.embed).toBeUndefined();
    expect(tagFacets('no tags', ['x'])).toEqual([]);
    expect(postUrl('at://did:plc:abc/app.bsky.feed.post/3k', 'me.bsky.social')).toBe(
      'https://bsky.app/profile/me.bsky.social/post/3k'
    );
  });
});

/* ---------------- atproto OAuth (mocked network, real WebCrypto) ---------------- */

function decodeJwt(jwt: string) {
  const [h, p] = jwt.split('.');
  const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());
  return { header: dec(h!), payload: dec(p!) };
}

async function verifyJwt(jwt: string): Promise<boolean> {
  const [h, p, s] = jwt.split('.');
  const { header } = decodeJwt(jwt);
  const key = await crypto.subtle.importKey(
    'jwk',
    header.jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(s!, 'base64url'),
    new TextEncoder().encode(`${h}.${p}`)
  );
}

describe('DPoP proofs', () => {
  it('are ES256 JWTs over htm / htu (no query) / ath / nonce', async () => {
    const key = await dpopKey();
    expect(key.pair.privateKey.extractable).toBe(false);
    const jwt = await dpopProof(key, 'POST', 'https://pds.example/xrpc/x?y=1', {
      nonce: 'n1',
      accessToken: 'tok',
    });
    const { header, payload } = decodeJwt(jwt);
    expect(header).toMatchObject({
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: { kty: 'EC', crv: 'P-256' },
    });
    expect(header.jwk.d).toBeUndefined();
    expect(payload).toMatchObject({ htm: 'POST', htu: 'https://pds.example/xrpc/x', nonce: 'n1' });
    expect(payload.ath).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifyJwt(jwt)).toBe(true);
  });
});

describe('atproto OAuth flow + direct publish', () => {
  const PDS = 'https://pds.example';
  const AS = 'https://auth.example';
  const DID = 'did:plc:abc123';
  const config = {
    clientId: 'https://api.starnote.app/api/v1/platform-oauth/bluesky/client-metadata.json',
    redirectUri: 'https://api.starnote.app/api/v1/platform-oauth/bluesky/callback',
  };

  function network() {
    let parNonceAsked = false;
    let pdsNonceAsked = false;
    const { fetch, calls } = mockFetch({
      'GET /xrpc/com.atproto.identity.resolveHandle': () => json({ did: DID }),
      [`GET /${DID}`]: () =>
        json({
          id: DID,
          service: [
            { id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS },
          ],
        }),
      'GET /.well-known/oauth-protected-resource': () => json({ authorization_servers: [AS] }),
      'GET /.well-known/oauth-authorization-server': () =>
        json({
          issuer: AS,
          pushed_authorization_request_endpoint: `${AS}/oauth/par`,
          authorization_endpoint: `${AS}/oauth/authorize`,
          token_endpoint: `${AS}/oauth/token`,
        }),
      'POST /oauth/par': () => {
        if (!parNonceAsked) {
          parNonceAsked = true;
          return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'DPoP-Nonce': 'as-n1' },
          });
        }
        return json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:req-1', expires_in: 60 },
          201
        );
      },
      'POST /oauth/token': () =>
        json({
          access_token: 'at-1',
          token_type: 'DPoP',
          expires_in: 1800,
          refresh_token: 'rt-1',
          sub: DID,
          scope: 'atproto transition:generic',
        }),
      'GET /covers/c.png': () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }),
      'POST /xrpc/com.atproto.repo.uploadBlob': () =>
        json({ blob: { $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/png', size: 3 } }),
      'POST /xrpc/com.atproto.repo.createRecord': () => {
        if (!pdsNonceAsked) {
          pdsNonceAsked = true;
          return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
            status: 401,
            headers: { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"', 'DPoP-Nonce': 'pds-n1' },
          });
        }
        return json({ uri: `at://${DID}/app.bsky.feed.post/3kxyz`, cid: 'bafyrec' });
      },
    });
    return { fetch, calls };
  }

  it('resolves, does PAR with a nonce retry, trades the code and posts with DPoP', async () => {
    const { fetch, calls } = network();
    const pending = await startBlueskyAuthorization({ fetch }, config, {
      handle: 'me.bsky.social',
    });
    expect(pending.state.startsWith('w.')).toBe(true);
    const url = new URL(pending.authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${AS}/oauth/authorize`);
    expect(url.searchParams.get('request_uri')).toBe('urn:ietf:params:oauth:request_uri:req-1');
    const pars = calls.filter((c) => c.url === `${AS}/oauth/par`);
    expect(pars).toHaveLength(2);
    expect(decodeJwt(pars[1]!.headers.get('DPoP')!).payload.nonce).toBe('as-n1');
    const parBody = new URLSearchParams(pars[1]!.body as string);
    expect(parBody.get('code_challenge_method')).toBe('S256');
    expect(parBody.get('client_id')).toBe(config.clientId);
    expect(parBody.get('login_hint')).toBe('me.bsky.social');

    await expect(
      completeBlueskyAuthorization({ fetch }, pending, {
        code: 'c',
        state: pending.state,
        iss: 'https://evil.example',
      })
    ).rejects.toMatchObject({ code: 'issuer_mismatch' });
    await expect(
      completeBlueskyAuthorization({ fetch }, pending, {
        code: 'c',
        state: 'w.other-state-000000',
        iss: AS,
      })
    ).rejects.toMatchObject({ code: 'state_mismatch' });

    const session = await completeBlueskyAuthorization({ fetch }, pending, {
      code: 'code-1',
      state: pending.state,
      iss: AS,
    });
    expect(session).toMatchObject({
      did: DID,
      pds: PDS,
      accessToken: 'at-1',
      refreshToken: 'rt-1',
    });
    const tokenCall = calls.find((c) => c.url === `${AS}/oauth/token`)!;
    expect(new URLSearchParams(tokenCall.body as string).get('code_verifier')).toBe(
      pending.verifier
    );
    expect(await verifyJwt(tokenCall.headers.get('DPoP')!)).toBe(true);

    const adapter = createBlueskyAdapter({
      session: () => session,
      assetBase: 'https://starnote.app/',
    });
    const { result } = await runPublish(
      adapter,
      { common: { title: 'Hello', cover: '/covers/c.png' } },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({
      ok: true,
      url: 'https://bsky.app/profile/me.bsky.social/post/3kxyz',
      externalId: '3kxyz',
    });
    const creates = calls.filter((c) => c.url === `${PDS}/xrpc/com.atproto.repo.createRecord`);
    expect(creates).toHaveLength(2);
    const last = creates[1]!;
    expect(last.headers.get('Authorization')).toBe('DPoP at-1');
    expect(decodeJwt(last.headers.get('DPoP')!).payload).toMatchObject({
      nonce: 'pds-n1',
      htm: 'POST',
    });
    expect(last.body.record.embed.external.thumb).toMatchObject({ ref: { $link: 'bafy' } });
    expect(last.body.repo).toBe(DID);
    // nothing went to 辰记's API
    expect(calls.some((c) => c.url.includes('/api/v1/'))).toBe(false);
  });

  it('web without a page session asks to authorize; the thumbnail failure only drops the image', async () => {
    const { terminal } = await runPublish(
      blueskyAdapter,
      {},
      { runtime: 'web', fetch: mockFetch({}).fetch }
    );
    expect(terminal[0]).toMatchObject({ type: 'failed', code: 'bind' });

    const { fetch } = network();
    const pending = await startBlueskyAuthorization({ fetch }, config);
    const session = await completeBlueskyAuthorization({ fetch }, pending, {
      code: 'c',
      state: pending.state,
      iss: AS,
    });
    const res = await publishBlueskyDirect(
      session,
      {
        record: {
          $type: 'app.bsky.feed.post',
          text: 'hi',
          createdAt: '',
          embed: {
            $type: 'app.bsky.embed.external',
            external: { uri: CANONICAL, title: 't', description: '' },
          },
        },
        thumb_url: 'http://insecure.example/a.png',
      },
      { fetch }
    );
    expect(res.report.map((i) => i.kind)).toEqual(['image.failed']);
    expect(res.rkey).toBe('3kxyz');
  });

  it('the desktop relays the rendered record (its main process holds the token and key)', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/bluesky': () =>
        json({
          code: 0,
          data: { url: 'https://bsky.app/profile/x/post/1', external_id: '1' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(blueskyAdapter, {}, { runtime: 'electron', fetch });
    expect(result.ok).toBe(true);
    expect(calls[0]!.body.body.record.$type).toBe('app.bsky.feed.post');
    expect(blueskyAdapter.runtime).toEqual(['electron', 'web']);
  });
  it('SPEC-r12 web: the link comment is a reply to the post with a link facet', async () => {
    const { fetch, calls } = network();
    const pending = await startBlueskyAuthorization({ fetch }, config);
    const session = await completeBlueskyAuthorization({ fetch }, pending, {
      code: 'c',
      state: pending.state,
      iss: AS,
    });
    const S = 'https://starnote.app/s/AbCd1234';
    const adapter = createBlueskyAdapter({ session: () => session });
    const { result } = await runPublish(
      adapter,
      { form: { linkPlacement: 'first_comment' }, trackingUrl: S },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({
      ok: true,
      followUp: { state: 'succeeded', externalId: '3kxyz' },
    });
    const creates = calls.filter((c) => c.url === `${PDS}/xrpc/com.atproto.repo.createRecord`);
    const post = creates.at(-2)!.body.record;
    const reply = creates.at(-1)!.body.record;
    expect(post.embed).toBeUndefined();
    expect(post.text).not.toContain('http');
    const ref = { uri: `at://${DID}/app.bsky.feed.post/3kxyz`, cid: 'bafyrec' };
    expect(reply.reply).toEqual({ root: ref, parent: ref });
    expect(reply.text).toBe(`原文：${S}`);
    expect(reply.facets).toEqual([
      {
        index: { byteStart: 9, byteEnd: 9 + S.length },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: S }],
      },
    ]);
  });

  it('SPEC-r12 desktop: the comment goes to the local relay with the meta it returned', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/bluesky/comment': () =>
        json({ code: 0, data: { platform: 'bluesky', external_id: 'r2', url: '' } }),
      'POST /api/v1/notes/note-1/publish/bluesky': () =>
        json({
          code: 0,
          data: {
            url: 'https://bsky.app/profile/x/post/1',
            external_id: '1',
            meta: { uri: 'at://d/app.bsky.feed.post/1', cid: 'c1' },
          },
        }),
    });
    const { result } = await runPublish(
      blueskyAdapter,
      { form: { linkPlacement: 'first_comment' } },
      { runtime: 'electron', fetch }
    );
    expect(result.followUp).toEqual({
      kind: 'link_comment',
      state: 'succeeded',
      text: `原文：${CANONICAL}`,
      externalId: 'r2',
    });
    expect(calls[1]!.body.parent).toEqual({
      external_id: '1',
      meta: { uri: 'at://d/app.bsky.feed.post/1', cid: 'c1' },
    });
  });
});

describe('SPEC-r12 Bluesky helpers', () => {
  it('reply records: link facets, 300 graphemes', () => {
    const parent = { uri: 'at://did:plc:a/app.bsky.feed.post/1', cid: 'c' };
    const r = blueskyReplyRecord('Read more: https://a.dev/x.', parent, { now: () => NOW });
    expect(r.facets?.[0]?.features[0]).toEqual({
      $type: 'app.bsky.richtext.facet#link',
      uri: 'https://a.dev/x',
    });
    expect(r.reply).toEqual({ root: parent, parent });
    expect(graphemes(blueskyReplyRecord('长'.repeat(400), parent).text)).toHaveLength(300);
    expect(linkFacets('无链接')).toEqual([]);
  });

  it('parses pasted links to the rkey and reads their stats via the handle', async () => {
    expect(
      blueskyAdapter.parsePostUrl!('https://bsky.app/profile/me.bsky.social/post/3kxyz')
    ).toEqual({
      externalId: '3kxyz',
      url: 'https://bsky.app/profile/me.bsky.social/post/3kxyz',
    });
    const { fetch, calls } = kitMockFetch({
      'GET /xrpc/com.atproto.identity.resolveHandle': () => json({ did: 'did:plc:me' }),
      'GET /xrpc/app.bsky.feed.getPosts': () =>
        json({ posts: [{ likeCount: 4, replyCount: 1, repostCount: 2 }] }),
    });
    const s = await blueskyAdapter.fetchStats!(
      'https://bsky.app/profile/me.bsky.social/post/3kxyz',
      {
        fetch,
        signal: new AbortController().signal,
        runtime: 'web',
      }
    );
    expect(s).toMatchObject({ likes: 4, comments: 1, shares: 2 });
    expect(decodeURIComponent(calls[1]!.url)).toContain('at://did:plc:me/app.bsky.feed.post/3kxyz');
  });
});

describe('SPEC-r12 Bluesky direct write errors (review)', () => {
  it('maps PDS failures by what may have happened to the write', () => {
    const kind = (e: BlueskyOAuthError) =>
      (blueskyWriteError(e) as { errorKind?: string }).errorKind;
    expect(kind(new BlueskyOAuthError('x', 'network'))).toBe('unknown');
    expect(kind(new BlueskyOAuthError('x', 'invalid', 502))).toBe('unknown');
    expect(kind(new BlueskyOAuthError('x', 'invalid'))).toBe('unknown');
    expect(kind(new BlueskyOAuthError('x', 'rate_limited', 429))).toBe('retry');
    expect(kind(new BlueskyOAuthError('x', 'relogin', 401))).toBe('disconnect');
    expect(kind(new BlueskyOAuthError('x', 'invalid', 400))).toBe('bad_body');
    const other = new Error('o');
    expect(blueskyWriteError(other)).toBe(other);
  });

  it('a 5xx on the web reply is unknown, so 「补发」 is not offered blindly', async () => {
    const session = {
      did: 'did:plc:me',
      pds: 'https://pds.example',
      accessToken: 'at',
      expiresAt: Date.now() + 3_600_000,
      key: await dpopKey(),
      nonces: new Map(),
    } as unknown as BlueskySession;
    const { fetch } = kitMockFetch({
      'POST /xrpc/com.atproto.repo.createRecord': () => json({ error: 'boom' }, 502),
    });
    const adapter = createBlueskyAdapter({ session: () => session });
    const err = await adapter.followUp!(
      { externalId: '1', url: '', meta: { uri: 'at://did:plc:me/app.bsky.feed.post/1', cid: 'c' } },
      { kind: 'link_comment', text: 'Read more: https://a.dev' },
      {
        fetch,
        signal: new AbortController().signal,
        runtime: 'web',
        noteId: 'n',
        apiBase: '/api/v1',
        emit: () => {},
        needInput: async () => '',
      }
    ).catch((e) => e);
    expect(err.errorKind).toBe('unknown');
  });
});
