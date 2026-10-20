import { describe, expect, it } from 'vitest';

import {
  completeWebAuthorization,
  credentialOf,
  MemoryCredentialStore,
  parseOAuthCallback,
  pkcePair,
  refreshPlatformToken,
  startWebAuthorization,
  STATE_RE,
} from '../src/index';
import { json, mockFetch } from './helpers';

describe('web OAuth helpers', () => {
  it('PKCE S256 pair and w. state', async () => {
    const { verifier, challenge } = await pkcePair();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(Buffer.from(digest).toString('base64url'));
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('asks 辰记 for the authorize URL, checks state, trades the code (no cloud by default)', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/me/platform-oauth/blogger/authorize': () =>
        json({
          code: 0,
          data: {
            authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
            redirect_uri: 'r',
          },
        }),
      'POST /api/v1/me/platform-oauth/blogger/token': () =>
        json({
          code: 0,
          data: {
            platform: 'blogger',
            token: { access_token: 'ya29', expires_at: '2099-01-01T00:00:00Z' },
            account: {
              external_uid: '1',
              display_name: 'Me',
              targets: [{ id: '9', title: 'Blog' }],
            },
            cloud: false,
          },
        }),
      'POST /api/v1/me/platform-oauth/blogger/refresh': () =>
        json({ code: 0, data: { token: { access_token: 'ya29-new' } } }),
    });
    const api = { apiBase: '/api/v1', fetch };
    const pending = await startWebAuthorization(api, 'blogger');
    expect(pending.state).toMatch(STATE_RE);
    expect(pending.state.startsWith('w.')).toBe(true);
    expect(calls[0]!.body).toMatchObject({ client: 'web', state: pending.state, offline: false });
    expect(calls[0]!.body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(
      completeWebAuthorization(
        api,
        pending,
        parseOAuthCallback('?code=c&state=w.wrong-state-000000')
      )
    ).rejects.toMatchObject({ code: 'state_mismatch' });
    await expect(
      completeWebAuthorization(api, pending, parseOAuthCallback('?error=access_denied'))
    ).rejects.toMatchObject({ code: 'denied' });

    const res = await completeWebAuthorization(
      api,
      pending,
      parseOAuthCallback(`?code=abc&state=${pending.state}`)
    );
    expect(res.token.access_token).toBe('ya29');
    const sent = calls.at(-1)!.body;
    expect(sent).toEqual({ code: 'abc', code_verifier: pending.verifier, cloud: false });

    expect((await refreshPlatformToken(api, 'blogger', 'rt')).access_token).toBe('ya29-new');
  });

  it('maps API errors', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/me/platform-oauth/tumblr/authorize': () =>
        json({ code: 50000, message: '未配置', data: { error_code: 'oauth_not_configured' } }, 503),
    });
    await expect(
      startWebAuthorization({ apiBase: '/api/v1', fetch }, 'tumblr')
    ).rejects.toMatchObject({
      code: 'oauth_not_configured',
      status: 503,
    });
  });

  it('keeps tokens in memory only, drops expired ones, sends them only from the browser', async () => {
    let now = 1_000_000;
    const store = new MemoryCredentialStore(() => now);
    store.set('mastodon', { access_token: 'm', expires_at: null }, { instance: 'mastodon.social' });
    store.set('blogger', { access_token: 'b', expires_at: new Date(now + 60_000).toISOString() });
    expect(store.get('mastodon')).toEqual({ access_token: 'm', instance: 'mastodon.social' });
    expect(store.has('blogger')).toBe(true);
    now += 45_000; // within the 30 s slack
    expect(store.get('blogger')).toBeUndefined();
    expect(await credentialOf(store.credentialFor, 'mastodon', { runtime: 'web' })).toEqual({
      access_token: 'm',
      instance: 'mastodon.social',
    });
    expect(
      await credentialOf(store.credentialFor, 'mastodon', { runtime: 'electron' })
    ).toBeUndefined();
    store.clear();
    expect(store.has('mastodon')).toBe(false);
  });
});
