import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  degradeArticle,
  errorFromStatus,
  fitTags,
  fitTitle,
  parseRetryAfter,
  threadsLength,
  truncate,
  weiboLength,
  xWeightedLength,
  youtubeId,
} from '../src/index';
import { fixtureDoc } from './helpers';

const P = { key: 'devto', label: 'DEV' };

describe('errors', () => {
  it('parses Retry-After seconds, HTTP-dates and reset headers', () => {
    const now = Date.UTC(2026, 9, 19, 0, 0, 0);
    expect(parseRetryAfter(new Headers({ 'Retry-After': '30' }), now)).toBe(30);
    expect(
      parseRetryAfter(new Headers({ 'Retry-After': new Date(now + 90_000).toUTCString() }), now)
    ).toBe(90);
    expect(
      parseRetryAfter(new Headers({ 'X-RateLimit-Reset': String(now / 1000 + 45) }), now)
    ).toBe(45);
    expect(parseRetryAfter(new Headers({ 'RateLimit-Reset': '12' }), now)).toBe(12);
    expect(parseRetryAfter(new Headers(), now)).toBeUndefined();
  });

  it('maps statuses to relogin / retry / help', () => {
    const e401 = errorFromStatus(P, 401, new Headers());
    expect(e401.code).toBe('relogin');
    expect(e401.actions.map((a) => a.kind)).toEqual(['relogin', 'help']);
    const e429 = errorFromStatus(P, 429, new Headers({ 'Retry-After': '7200' }));
    expect(e429.retryAfterSec).toBe(7200);
    expect(e429.message).toContain('约 2 小时后重试');
    const e500 = errorFromStatus(P, 502, new Headers(), 'bad gateway');
    expect(e500.actions.map((a) => a.kind)).toEqual(['help', 'retry']);
    const e404 = errorFromStatus(
      { ...P, links: { help: (k) => `/guides/${k}` } },
      404,
      new Headers()
    );
    expect(e404.actions).toEqual([
      { id: 'help:devto', label: '查看发布指南', kind: 'help', href: '/guides/devto' },
    ]);
  });
});

describe('degrade', () => {
  it('counts every degraded block and keeps the tree convertible', () => {
    const d = degradeArticle(
      fixtureDoc(),
      { target: 'html', title: 'Hello Title', assetBase: 'https://starnote.app/' },
      'Ghost'
    );
    expect(d.counts).toMatchObject({
      callout: 2,
      heading: 1,
      headingLevel: 1,
      divider: 1,
      code: 1,
      table: 1,
      tableMerged: 1,
      math: 1,
      video: 2,
      link: 1,
      image: 1,
      imageResolved: 1,
      titleDropped: 1,
    });
    expect(d.body).not.toMatch(/class="(sn-|divider)/);
    expect(youtubeId('https://youtu.be/abcdefg')).toBe('abcdefg');
    expect(youtubeId('https://www.youtube.com/watch?v=abcdefg&t=1')).toBe('abcdefg');
  });
});

describe('text', () => {
  it('truncates by code points and fits titles / tags', () => {
    expect(truncate('一二三四五', 3)).toBe('一二…');
    expect(fitTitle('abcdef', 4, 'X')).toMatchObject({
      title: 'abc…',
      report: [{ kind: 'title.truncated' }],
    });
    const t = fitTags(
      ['A', 'a', 'B c', '', 'd', 'e'],
      { max: 2, normalize: (s) => s.toLowerCase().replace(/\s/g, '') || null },
      'DEV'
    );
    expect(t.tags).toEqual(['a', 'bc']);
    expect(t.report.map((i) => i.kind)).toEqual(['tags.mapped', 'tags.trimmed']);
  });
  it('weights characters like X, 微博 and Threads', () => {
    expect(xWeightedLength('abc')).toBe(3);
    expect(xWeightedLength('中文')).toBe(4);
    expect(xWeightedLength('see https://example.com/very/long/path')).toBe(4 + 23);
    expect(weiboLength('ab中')).toBe(2);
    expect(weiboLength('中 https://a.com/x')).toBe(1 + 10 + 1);
    expect(threadsLength('hi👍')).toBe(2 + 4);
  });
});

/* The browser entries of the new packages must not reach node:* / electron (SPEC-r8 §13). */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ENTRIES = [
  'packages/adapters/kit/src/index.ts',
  'packages/adapters/devto/src/index.ts',
  'packages/adapters/hashnode/src/index.ts',
  'packages/adapters/ghost/src/index.ts',
  'packages/adapters/wordpress/src/index.ts',
  'packages/adapters/share/src/index.ts',
  // SPEC-r14 A1
  'packages/adapters/convertkit/src/index.ts',
  'packages/adapters/beehiiv/src/index.ts',
  'packages/adapters/buttondown/src/index.ts',
  'packages/adapters/hatena/src/index.ts',
  'packages/adapters/qiita/src/index.ts',
  'packages/adapters/zenn/src/index.ts',
  'packages/adapters/telegraph/src/index.ts',
];
const FORBIDDEN = new Set(['electron', ...builtinModules]);

function walk(entry: string): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  const stack = [resolve(root, entry)];
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(re)) {
      const spec = (m[1] ?? m[2])!;
      if (spec.startsWith('.')) stack.push(resolve(dirname(file), `${spec}.ts`));
      else if (spec.startsWith('node:') || FORBIDDEN.has(spec)) bad.push(`${file}: ${spec}`);
    }
  }
  return bad;
}

describe('browser safety', () => {
  it.each(ENTRIES)('%s imports no Node built-ins or electron', (entry) => {
    expect(walk(entry)).toEqual([]);
  });
});
