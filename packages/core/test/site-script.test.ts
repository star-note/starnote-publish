import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlEncode,
  loadSiteScript,
  peekSiteScript,
  signSiteScript,
  SITE_SCRIPT_KEYS,
  SiteScriptError,
  verifySiteScript,
} from '../src/index';

import type { SignedSiteScript, SiteScript } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const devKey = JSON.parse(readFileSync(resolve(here, 'fixtures/site-script-dev-key.json'), 'utf8'));

async function devPrivateKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', devKey.privateJwk, { name: 'Ed25519' }, false, ['sign']);
}

const script = (extra: Partial<SiteScript> = {}): SiteScript => ({
  platform: 'zhihu',
  version: '1.2.0',
  minCore: '0.1.0',
  issuedAt: '2026-10-19T00:00:00.000Z',
  urls: { home: 'https://www.zhihu.com/' },
  selectors: {},
  ...extra,
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof SiteScriptError ? e.code : `other: ${String(e)}`;
  }
}

describe('site script signatures (Ed25519)', () => {
  it('the dev public key in SITE_SCRIPT_KEYS matches the fixture', () => {
    expect(SITE_SCRIPT_KEYS[devKey.kid]).toBe(devKey.publicKey);
  });

  it('base64url round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    for (let n = 0; n <= bytes.length; n++) {
      const part = bytes.subarray(0, n);
      expect([...base64UrlDecode(base64UrlEncode(part))]).toEqual([...part]);
    }
    expect(base64UrlEncode(new TextEncoder().encode('知乎'))).toBe(
      Buffer.from('知乎').toString('base64url')
    );
  });

  it('accepts a correctly signed script', async () => {
    const signed = await signSiteScript(script(), await devPrivateKey(), devKey.kid);
    const verified = await verifySiteScript(signed, { platform: 'zhihu' });
    expect(verified).toEqual(script());
    expect(peekSiteScript(signed).version).toBe('1.2.0');
  });

  it('rejects a tampered payload or signature', async () => {
    const signed = await signSiteScript(script(), await devPrivateKey(), devKey.kid);
    const forged = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(script({ urls: { home: 'https://evil.example/' } })))
    );
    expect(await codeOf(verifySiteScript({ ...signed, payload: forged }))).toBe('bad-signature');
    const sig = base64UrlDecode(signed.sig);
    sig[0] = sig[0]! ^ 1;
    expect(await codeOf(verifySiteScript({ ...signed, sig: base64UrlEncode(sig) }))).toBe(
      'bad-signature'
    );
  });

  it('rejects a script signed by another key, an unknown kid, a bad alg', async () => {
    const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const signed = await signSiteScript(script(), other.privateKey, devKey.kid);
    expect(await codeOf(verifySiteScript(signed))).toBe('bad-signature');
    expect(await codeOf(verifySiteScript({ ...signed, kid: 'nope' }))).toBe('unknown-key');
    // a kid that names an Object.prototype member is unknown too, not a key
    for (const kid of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(await codeOf(verifySiteScript({ ...signed, kid })), kid).toBe('unknown-key');
    expect(
      await codeOf(verifySiteScript({ ...signed, alg: 'RS256' } as unknown as SignedSiteScript))
    ).toBe('bad-format');
    // …and accepts it when that key is trusted
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey));
    expect(
      await codeOf(verifySiteScript(signed, { publicKeys: { [devKey.kid]: base64UrlEncode(raw) } }))
    ).toBe('ok');
  });

  it('rejects an expired script, another platform, a too-new minCore', async () => {
    const key = await devPrivateKey();
    const expired = await signSiteScript(
      script({ expiresAt: '2026-10-01T00:00:00.000Z' }),
      key,
      devKey.kid
    );
    const now = new Date('2026-10-19T00:00:00.000Z');
    expect(await codeOf(verifySiteScript(expired, { now }))).toBe('expired');
    expect(await codeOf(verifySiteScript(expired, { now, allowExpired: true }))).toBe('ok');
    expect(
      await codeOf(verifySiteScript(expired, { now: new Date('2026-09-30T00:00:00.000Z') }))
    ).toBe('ok');
    const signed = await signSiteScript(script(), key, devKey.kid);
    expect(await codeOf(verifySiteScript(signed, { platform: 'juejin' }))).toBe('wrong-platform');
    const future = await signSiteScript(script({ minCore: '9.0.0' }), key, devKey.kid);
    expect(await codeOf(verifySiteScript(future))).toBe('min-core');
  });
});

describe('loadSiteScript', () => {
  const serve = (body: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('prefers a valid, newer remote script', async () => {
    const key = await devPrivateKey();
    const bundled = await signSiteScript(script({ version: '1.0.0' }), key, devKey.kid);
    const remote = await signSiteScript(script({ version: '1.1.0' }), key, devKey.kid);
    const r = await loadSiteScript('zhihu', { bundled, fetch: serve(remote) });
    expect(r).toMatchObject({ source: 'remote', script: { version: '1.1.0' }, warnings: [] });
  });

  it('falls back to the bundled copy when the remote one is tampered, expired, older or missing', async () => {
    const key = await devPrivateKey();
    const bundled = await signSiteScript(script({ version: '1.0.0' }), key, devKey.kid);
    const remote = await signSiteScript(script({ version: '2.0.0' }), key, devKey.kid);
    const tampered = { ...remote, payload: bundled.payload };
    const expired = await signSiteScript(
      script({ version: '2.0.0', expiresAt: '2020-01-01T00:00:00.000Z' }),
      key,
      devKey.kid
    );
    const older = await signSiteScript(script({ version: '0.9.0' }), key, devKey.kid);
    for (const [fetchImpl, word] of [
      [serve(tampered), '签名'],
      [serve(expired), '过期'],
      [serve(older), '旧'],
      [serve({ detail: 'not found' }, 404), '404'],
    ] as const) {
      const r = await loadSiteScript('zhihu', { bundled, fetch: fetchImpl });
      expect(r.source).toBe('bundled');
      expect(r.script.version).toBe('1.0.0');
      expect(r.warnings.join()).toContain(word);
    }
  });

  it('refuses a tampered bundled copy', async () => {
    const bundled = await signSiteScript(script(), await devPrivateKey(), devKey.kid);
    const sig = base64UrlDecode(bundled.sig);
    sig[5] = sig[5]! ^ 0xff;
    await expect(
      loadSiteScript('zhihu', { bundled: { ...bundled, sig: base64UrlEncode(sig) } })
    ).rejects.toThrow(SiteScriptError);
  });
});

describe('bundled site scripts of the session adapters', () => {
  it.each([
    ['zhihu', 'zhihu'],
    ['juejin', 'juejin'],
    ['csdn', 'csdn'],
    ['wechat-mp', 'wechat'],
  ])('%s: signed copy verifies and matches its source', async (dirName, p) => {
    const dir = resolve(here, `../../adapters/${dirName}/src`);
    const signed = JSON.parse(readFileSync(resolve(dir, 'site-script.signed.json'), 'utf8'));
    const source = JSON.parse(readFileSync(resolve(dir, 'site-script.json'), 'utf8'));
    const verified = await verifySiteScript(signed, { platform: p });
    expect(verified).toEqual(source);
    expect(verified.session?.allowedHosts.length).toBeGreaterThan(0);
  });
});
