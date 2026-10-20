import { describe, expect, it } from 'vitest';

import { docChars, extractiveCondense, splitSentences } from '../src';

import type { TiptapJSON } from '../src';

const p = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'paragraph', content });
const t = (text: string, marks?: TiptapJSON['marks']): TiptapJSON => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const h = (level: number, text: string): TiptapJSON => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
});
const img = (src: string): TiptapJSON => ({ type: 'image', attrs: { src } });

const TOPICS = ['向量数据库', '检索增强', '模型推理', '提示工程', '评测体系', '部署成本'];

/** A long article: 6 sections × 4 paragraphs × 3 sentences, each ~30 chars. */
function article(): TiptapJSON {
  const content: TiptapJSON[] = [
    p(t('本文介绍大模型应用落地的六个关键环节，帮助团队少走弯路。我们从向量数据库讲起。')),
  ];
  TOPICS.forEach((topic, s) => {
    content.push(h(2, `${s + 1}. ${topic}`));
    content.push(img(`https://x.test/${s}.png`));
    for (let i = 0; i < 4; i++) {
      content.push(
        p(
          t(`${topic}是大模型应用的第${i + 1}个要点，团队需要提前规划。`),
          t(`很多团队在${topic}上投入不足，导致上线后问题频出`, [{ type: 'bold' }]),
          t(`。随后我们会结合案例说明${topic}的具体做法和注意事项。`)
        )
      );
    }
    content.push(img(`https://x.test/${s}-b.png`));
  });
  return { type: 'doc', content };
}

describe('splitSentences', () => {
  it('splits on Chinese and English punctuation, keeps closing quotes', () => {
    const text = '第一句。“第二句！”Third one. Fourth? 3.5 stays';
    expect(splitSentences(text).map(([a, b]) => text.slice(a, b))).toEqual([
      '第一句。',
      '“第二句！”',
      'Third one.',
      'Fourth?',
      '3.5 stays',
    ]);
  });
});

describe('extractiveCondense', () => {
  const doc = article();
  const total = docChars(doc);

  it('docChars counts text without whitespace', () => {
    expect(docChars({ type: 'doc', content: [p(t('a b 中文'))] })).toBe(4);
    expect(total).toBeGreaterThan(1800);
  });

  it('returns the document unchanged when already short enough', () => {
    const short: TiptapJSON = { type: 'doc', content: [p(t('短文。'))] };
    expect(extractiveCondense(short, 800)).toEqual({ doc: short, chars: 3 });
  });

  for (const target of [800, 1500]) {
    it(`target ${target}: length within ±15%, order and headings kept`, () => {
      const { doc: out, chars } = extractiveCondense(doc, target, { title: '大模型应用落地' });
      expect(chars).toBe(docChars(out));
      expect(chars).toBeGreaterThanOrEqual(target * 0.85);
      expect(chars).toBeLessThanOrEqual(target * 1.15);

      const blocks = out.content!;
      // a heading for every section that keeps a sentence, in the original order
      const headings = blocks.filter((b) => b.type === 'heading').map((b) => b.content![0]!.text!);
      const sectionsWithText = new Set<string>();
      let current = '';
      for (const b of blocks) {
        if (b.type === 'heading') current = b.content![0]!.text!;
        else if (b.type === 'paragraph' && current) sectionsWithText.add(current);
      }
      expect(headings.length).toBeGreaterThan(0);
      expect([...sectionsWithText]).toEqual(headings.filter((x) => sectionsWithText.has(x)));
      expect(headings).toEqual([...headings].sort((a, b) => parseInt(a) - parseInt(b)));
      for (const heading of headings) expect(sectionsWithText.has(heading)).toBe(true);

      // kept text appears in the original order
      const original = JSON.stringify(doc);
      let cursor = 0;
      for (const b of blocks.filter((x) => x.type === 'paragraph')) {
        for (const n of b.content ?? []) {
          if (!n.text?.trim()) continue;
          const at = original.indexOf(n.text, cursor);
          expect(at, n.text).toBeGreaterThanOrEqual(0);
          cursor = at;
        }
      }

      // at most one image per section
      let images = 0;
      for (const b of blocks) {
        if (b.type === 'heading') images = 0;
        if (b.type === 'image') images++;
        expect(images).toBeLessThanOrEqual(1);
      }
    });
  }

  it('keeps inline marks of kept text and the opening paragraph', () => {
    const { doc: out } = extractiveCondense(doc, 1500, { title: '大模型应用落地' });
    const marked = out.content!.flatMap((b) => b.content ?? []).filter((n) => n.marks?.length);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked[0]!.marks).toEqual([{ type: 'bold' }]);
    expect(out.content![0]!.type).toBe('paragraph');
    expect(out.content![0]!.content![0]!.text).toContain('本文介绍');
  });

  it('works on English text too', () => {
    const en: TiptapJSON = {
      type: 'doc',
      content: Array.from({ length: 30 }, (_, i) =>
        p(
          t(
            `Vector search is useful for retrieval number ${i}. It needs careful indexing and tuning. Teams often skip evaluation, which hurts quality later.`
          )
        )
      ),
    };
    const { chars } = extractiveCondense(en, 800);
    expect(chars).toBeGreaterThanOrEqual(800 * 0.85);
    expect(chars).toBeLessThanOrEqual(800 * 1.15);
  });
});
