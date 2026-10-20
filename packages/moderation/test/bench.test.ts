/**
 * Simple benchmark: default lexicon (a few thousand words), 10 000-character article, < 50 ms.
 * Also runnable alone: `pnpm vitest run packages/moderation/test/bench.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { builtinWords, createMasker, maskHtml, maskText } from '../src/index';

const BASE =
  '辰记是一款面向写作者的编辑器，支持多平台发布、目录生成与排版预览。我们希望正文在发布前自动处理不合适的词语，' +
  '同时保证 HTML 结构、代码块和链接不被破坏。Performance matters: the masker runs on every preview refresh. ';

function article(chars: number): string {
  const words = builtinWords('violence').slice(0, 50);
  let s = '';
  let k = 0;
  while (s.length < chars) {
    s += BASE;
    if (k % 3 === 0) s += words[k % words.length] + '，';
    k++;
  }
  return s.slice(0, chars);
}

const time = (fn: () => void, runs = 5) => {
  fn(); // warm-up (JIT, masker cache)
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    fn();
    t.push(performance.now() - a);
  }
  return t.sort((x, y) => x - y)[Math.floor(runs / 2)]!;
};

describe('benchmark', () => {
  const text = article(10_000);
  const html = text
    .match(/.{1,200}/gs)!
    .map((p) => `<p>${p}</p>`)
    .join('');

  it('builds the default dictionary', () => {
    const a = performance.now();
    const m = createMasker();
    const ms = performance.now() - a;
    console.log(`[bench] build ${m.size} words: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });

  it('maskText on 10 000 chars < 50 ms', () => {
    let hits = 0;
    const ms = time(() => (hits = maskText(text).hits.length));
    console.log(`[bench] maskText 10k chars: ${ms.toFixed(2)} ms, ${hits} hits`);
    expect(hits).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });

  it('maskHtml on 10 000 chars < 50 ms', () => {
    const ms = time(() => maskHtml(html, { preview: true }));
    console.log(`[bench] maskHtml 10k chars (preview): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
