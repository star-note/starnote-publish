#!/usr/bin/env node
/* global console, process, Buffer */
/**
 * Signs the bundled site scripts: packages/adapters/<platform>/src/site-script.json →
 * src/site-script.signed.json ({kid, alg: 'Ed25519', payload: base64url(JSON), sig}), and the 通用模式 scripts of
 * platforms without an adapter yet (SPEC-r13 §4b): packages/adapters/desk-generic/src/sites/<platform>.json → <platform>.signed.json.
 *
 *   node scripts/sign-site-scripts.mjs                 # dev key (packages/core/test/fixtures/site-script-dev-key.json)
 *   node scripts/sign-site-scripts.mjs --key <file>    # production key, offline only (same JSON shape)
 *   node scripts/sign-site-scripts.mjs --check         # fail when a signed copy is stale
 *
 * The format matches `signSiteScript` / `verifySiteScript` in @starnote/publish-core and
 * starnote-desktop/src/main/platform-login/logic.ts#verifySignedScript.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const keyFile = args.includes('--key')
  ? resolve(args[args.indexOf('--key') + 1])
  : join(root, 'packages/core/test/fixtures/site-script-dev-key.json');
const check = args.includes('--check');

const keyJson = JSON.parse(readFileSync(keyFile, 'utf8'));
const privateKey = createPrivateKey({ key: keyJson.privateJwk, format: 'jwk' });
const publicKey = createPublicKey({
  key: { kty: 'OKP', crv: 'Ed25519', x: keyJson.publicKey },
  format: 'jwk',
});

let stale = 0;
const adaptersDir = join(root, 'packages/adapters');
const genericDir = join(root, 'packages/adapters/desk-generic/src/sites');
const targets = [
  ...readdirSync(adaptersDir).map((name) => ({
    name,
    src: join(adaptersDir, name, 'src/site-script.json'),
    out: join(adaptersDir, name, 'src/site-script.signed.json'),
  })),
  ...(existsSync(genericDir) ? readdirSync(genericDir) : [])
    .filter((f) => f.endsWith('.json') && !f.endsWith('.signed.json'))
    .map((f) => ({
      name: `generic/${f.slice(0, -5)}`,
      src: join(genericDir, f),
      out: join(genericDir, `${f.slice(0, -5)}.signed.json`),
    })),
];
for (const { name, src, out } of targets) {
  if (!existsSync(src)) continue;
  const script = JSON.parse(readFileSync(src, 'utf8'));
  const payload = Buffer.from(JSON.stringify(script), 'utf8').toString('base64url');
  if (check) {
    const cur = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
    const ok =
      cur &&
      cur.payload === payload &&
      cur.kid === keyJson.kid &&
      verify(null, Buffer.from(cur.payload, 'utf8'), publicKey, Buffer.from(cur.sig, 'base64url'));
    if (!ok) {
      stale++;
      console.error(`stale: ${name}`);
    }
    continue;
  }
  const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
  writeFileSync(
    out,
    JSON.stringify({ kid: keyJson.kid, alg: 'Ed25519', payload, sig }, null, 2) + '\n'
  );
  console.log(`signed ${name} v${script.version} (${keyJson.kid})`);
}
if (stale) process.exit(1);
