/**
 * The browser entries of every package (`.` and `./web`) must not reach `node:*`, Node built-ins or
 * `electron` through their relative imports (SPEC-r8 §13, the CI guard `check-browser-safe`).
 */
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const BROWSER_ENTRIES = [
  'packages/core/src/index.ts',
  'packages/moderation/src/index.ts',
  'packages/adapters/chenji/src/index.ts',
  'packages/adapters/github-pages/src/index.ts',
  'packages/adapters/github-pages/src/web.ts',
  'packages/adapters/github-pages/src/electron.ts',
  'packages/adapters/zhihu/src/index.ts',
  'packages/adapters/zhihu/src/electron.ts',
  'packages/adapters/juejin/src/index.ts',
  'packages/adapters/juejin/src/electron.ts',
  'packages/adapters/csdn/src/index.ts',
  'packages/adapters/csdn/src/electron.ts',
  'packages/adapters/wechat-mp/src/index.ts',
  'packages/adapters/wechat-mp/src/electron.ts',
  'packages/adapters/kit/src/index.ts',
  'packages/adapters/share/src/index.ts',
  'packages/adapters/blogger/src/index.ts',
  'packages/adapters/wordpress-com/src/index.ts',
  'packages/adapters/tumblr/src/index.ts',
  'packages/adapters/reddit/src/index.ts',
  'packages/adapters/mastodon/src/index.ts',
  'packages/adapters/bluesky/src/index.ts',
  'packages/adapters/instagram/src/index.ts',
  // SPEC-r11 §10
  'packages/adapters/telegram/src/index.ts',
  'packages/adapters/discord/src/index.ts',
  'packages/adapters/slack/src/index.ts',
  'packages/adapters/linkedin/src/index.ts',
  'packages/adapters/threads/src/index.ts',
  'packages/adapters/facebook/src/index.ts',
  'packages/adapters/pinterest/src/index.ts',
];

const FORBIDDEN = new Set(['electron', ...builtinModules]);

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3])!);
  return out;
}

function walk(entry: string): { file: string; spec: string }[] {
  const seen = new Set<string>();
  const external: { file: string; spec: string }[] = [];
  const stack = [resolve(root, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.') && spec.endsWith('.json')) continue; // data, not code
      if (spec.startsWith('.'))
        stack.push(resolve(dirname(file), spec.endsWith('.ts') ? spec : `${spec}.ts`));
      else external.push({ file, spec });
    }
  }
  return external;
}

describe('browser-safe entries', () => {
  it.each(BROWSER_ENTRIES)('%s imports no Node or Electron modules', (entry) => {
    const bad = walk(entry).filter(
      ({ spec }) =>
        spec.startsWith('node:') || FORBIDDEN.has(spec) || FORBIDDEN.has(spec.split('/')[0]!)
    );
    expect(bad).toEqual([]);
  });

  // @starnote/moderation (masking, zero runtime dependencies) is the one sibling core itself imports; adapters also
  // use @starnote/publish-kit and (for the not-bound hand-off, SPEC-r11 §10) @starnote/publish-share, both checked above
  it('only allows zod, the core package, kit, share and moderation as bare imports', () => {
    const bare = new Set(BROWSER_ENTRIES.flatMap((e) => walk(e).map((x) => x.spec)));
    expect([...bare].sort()).toEqual([
      '@starnote/moderation',
      '@starnote/publish-core',
      '@starnote/publish-kit',
      '@starnote/publish-share',
      'zod',
    ]);
  });
});
