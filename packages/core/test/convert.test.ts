import { describe, expect, it } from 'vitest';

import { convert, escapeHtml, headingId, slugify } from '../src/convert';

import type { TiptapJSON } from '../src/types';

const text = (t: string, marks?: TiptapJSON['marks']): TiptapJSON => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'paragraph', content });
const doc = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'doc', content });
const h = (level: number, t: string): TiptapJSON => ({
  type: 'heading',
  attrs: { level },
  content: [text(t)],
});

describe('convert: blocks', () => {
  it('renders paragraphs and headings with stable ids', () => {
    const out = convert(
      doc(h(1, 'Hello World'), p(text('Body')), h(2, '第二章 概述'), h(3, 'Sub'))
    );
    expect(out.html).toContain('<h1 id="h-0-hello-world">Hello World</h1>');
    expect(out.html).toContain('<h2 id="h-1-第二章-概述">第二章 概述</h2>');
    expect(out.html).toContain('<h3 id="h-2-sub">Sub</h3>');
    expect(out.html).toContain('<p>Body</p>');
    expect(out.markdown).toBe('# Hello World\n\nBody\n\n## 第二章 概述\n\n### Sub');
    expect(out.title).toBe('Hello World');
  });

  it('builds a toc of levels 2–3 by default, configurable', () => {
    const json = doc(h(1, 'T'), h(2, 'A'), h(3, 'B'), h(4, 'C'));
    expect(convert(json).toc).toEqual([
      { id: 'h-1-a', level: 2, text: 'A' },
      { id: 'h-2-b', level: 3, text: 'B' },
    ]);
    expect(convert(json, { tocLevels: [1, 2] }).toc.map((t) => t.id)).toEqual(['h-0-t', 'h-1-a']);
  });

  it('renders bullet, ordered and task lists', () => {
    const out = convert(
      doc(
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('one'))] }] },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [p(text('three'))] }],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(text('done'))] },
            { type: 'taskItem', attrs: { checked: false }, content: [p(text('todo'))] },
          ],
        }
      )
    );
    expect(out.html).toContain('<ul>\n<li>one</li>\n</ul>');
    expect(out.html).toContain('<ol start="3">\n<li>three</li>\n</ol>');
    expect(out.html).toContain('data-type="taskList"');
    expect(out.html).toContain(
      '<li data-type="taskItem" data-checked="true"><input type="checkbox" disabled checked> done</li>'
    );
    expect(out.html).toContain('data-checked="false"><input type="checkbox" disabled> todo</li>');
    expect(out.markdown).toBe('- one\n\n3. three\n\n- [x] done\n- [ ] todo');
  });

  it('renders blockquote, code block with language, rule and hard break', () => {
    const out = convert(
      doc(
        { type: 'blockquote', content: [p(text('quoted'))] },
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [text('const a = "<b>";')],
        },
        { type: 'horizontalRule' },
        p(text('line'), { type: 'hardBreak' }, text('next'))
      )
    );
    expect(out.html).toContain('<blockquote>\n<p>quoted</p>\n</blockquote>');
    expect(out.html).toContain(
      '<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot;;</code></pre>'
    );
    expect(out.html).toContain('<hr>');
    expect(out.html).toContain('<p>line<br>next</p>');
    expect(out.markdown).toContain('> quoted');
    expect(out.markdown).toContain('```ts\nconst a = "<b>";\n```');
    expect(out.markdown).toContain('---');
  });

  it('renders images and collects unique srcs', () => {
    const img = (src: string): TiptapJSON => ({
      type: 'image',
      attrs: { src, alt: 'A "pic"', title: 'T', width: 320 },
    });
    const out = convert(doc(img('/a.png'), img('/b.png'), img('/a.png')));
    expect(out.html).toContain('<img src="/a.png" alt="A &quot;pic&quot;" title="T" width="320">');
    expect(out.images).toEqual(['/a.png', '/b.png']);
    // a resized picture keeps its width as an HTML <img> in Markdown
    expect(out.markdown).toContain('<img src="/a.png" alt="A &quot;pic&quot;" width="320">');
  });

  it('renders tables with header cells and spans', () => {
    const cell = (
      type: 'tableCell' | 'tableHeader',
      t: string,
      attrs?: Record<string, unknown>
    ): TiptapJSON => ({
      type,
      attrs,
      content: [p(text(t))],
    });
    const out = convert(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Qty')] },
          { type: 'tableRow', content: [cell('tableCell', 'Apple', { colspan: 2 })] },
        ],
      })
    );
    expect(out.html).toContain(
      '<table>\n<tbody>\n<tr><th><p>Name</p></th><th><p>Qty</p></th></tr>'
    );
    expect(out.html).toContain('<td colspan="2"><p>Apple</p></td>');
    // GFM cannot merge cells: the table stays HTML inside the Markdown
    expect(out.markdown).toBe(out.portableHtml);
  });

  it('renders children of unknown nodes and never throws', () => {
    const out = convert(
      doc(
        { type: 'callout', attrs: { kind: 'info' }, content: [p(text('inside'))] },
        { type: 'weird' }
      )
    );
    expect(out.html).toBe('<p>inside</p>');
    expect(out.text).toBe('inside');
    expect(() => convert(null as unknown as TiptapJSON)).not.toThrow();
    expect(convert(undefined as unknown as TiptapJSON).html).toBe('');
  });
});

describe('convert: marks and escaping', () => {
  it('wraps every supported mark', () => {
    const out = convert(
      doc(
        p(
          text('b', [{ type: 'bold' }]),
          text('i', [{ type: 'italic' }]),
          text('u', [{ type: 'underline' }]),
          text('s', [{ type: 'strike' }]),
          text('c', [{ type: 'code' }]),
          text('h', [{ type: 'highlight', attrs: { color: '#ff0' } }]),
          text('l', [{ type: 'link', attrs: { href: 'https://x.y/?a=1&b=2', target: '_blank' } }]),
          text('bi', [{ type: 'bold' }, { type: 'italic' }])
        )
      )
    );
    expect(out.html).toBe(
      '<p><strong>b</strong><em>i</em><u>u</u><s>s</s><code>c</code>' +
        '<mark style="background-color: #ff0">h</mark>' +
        '<a href="https://x.y/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">l</a>' +
        '<strong><em>bi</em></strong></p>'
    );
    expect(out.markdown).toBe('**b***i*<u>u</u>~~s~~`c`==h==[l](https://x.y/?a=1&b=2)***bi***');
  });

  it('escapes text and attributes', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;'
    );
    const out = convert(doc(p(text('<script>alert(1)</script>'))));
    expect(out.html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(out.text).toBe('<script>alert(1)</script>');
  });

  it('escapes heading text inside ids via slugify', () => {
    expect(slugify('Hello, World! <x>')).toBe('hello-world-x');
    expect(slugify('   ')).toBe('section');
    expect(slugify('a'.repeat(60)).length).toBe(40);
  });
});

describe('convert: text, title and summary', () => {
  it('produces plain text with block breaks', () => {
    const out = convert(doc(h(1, 'Title'), p(text('One')), p(text('Two'))));
    expect(out.text).toBe('Title\nOne\nTwo');
  });

  it('summary is the first 120 chars with whitespace collapsed', () => {
    const long = 'x'.repeat(200);
    const out = convert(doc(p(text('  a   b\n c ')), p(text(long))));
    expect(out.summary.startsWith('a b c ')).toBe(true);
    expect(out.summary.length).toBe(120);
    expect(convert(doc(p(text('short'))), { summaryLength: 3 }).summary).toBe('sho');
  });

  it('title is empty without an h1', () => {
    const out = convert(doc(h(2, 'Only h2')));
    expect(out.title).toBe('');
    expect(out.json).toEqual(doc(h(2, 'Only h2')));
  });
});

describe('convert: SparkWrite block images', () => {
  it('renders imageBlock/imageGif as figures, lists them in images and emits markdown', () => {
    const doc: TiptapJSON = {
      type: 'doc',
      content: [
        { type: 'imageBlock', attrs: { src: '/api/v1/assets/abc', alt: 'shot', width: 640 } },
        { type: 'imageGif', attrs: { src: 'https://g.example/x.gif', caption: 'a gif' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    };
    const out = convert(doc);
    expect(out.images).toEqual(['/api/v1/assets/abc', 'https://g.example/x.gif']);
    expect(out.html).toContain(
      '<figure><img src="/api/v1/assets/abc" alt="shot" width="640"></figure>'
    );
    expect(out.html).toContain('<figcaption>a gif</figcaption>');
    expect(out.markdown).toContain('<img src="/api/v1/assets/abc" alt="shot" width="640">');
    expect(out.markdown).toContain('![a gif](https://g.example/x.gif)\n\n*a gif*');
    expect(out.text).toBe('after');
  });
});

describe('convert: editor parity hooks', () => {
  it('uses renderHtml for html and keeps the portable HTML apart', () => {
    const json = doc(h(2, 'Intro'), p(text('x')));
    const out = convert(json, { renderHtml: () => '<div class="from-sdk"></div>' });
    expect(out.html).toBe('<div class="from-sdk"></div>');
    expect(out.portableHtml).toContain('<h2 id="h-0-intro">Intro</h2>');
    expect(out.toc).toEqual([{ id: headingId('Intro', 0), level: 2, text: 'Intro' }]);
  });

  it('writes GFM alignment, math, callouts and details to Markdown', () => {
    const cell = (type: string, t: string, attrs?: Record<string, unknown>): TiptapJSON => ({
      type,
      attrs,
      content: [p(text(t))],
    });
    const out = convert(
      doc(
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [cell('tableHeader', 'A'), cell('tableHeader', 'B', { align: 'center' })],
            },
            { type: 'tableRow', content: [cell('tableCell', '1'), cell('tableCell', '2')] },
          ],
        },
        p(text('E '), { type: 'katex', attrs: { text: 'x^2' } }),
        { type: 'callout', attrs: { type: 'tip', title: 'Note', body: 'Body' } },
        {
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [text('More')] },
            { type: 'detailsContent', content: [p(text('Hidden'))] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'python' }, content: [text('print(1)')] }
      )
    );
    expect(out.markdown).toContain('| A | B |\n| --- | :---: |');
    expect(out.markdown).toContain('E $x^2$');
    expect(out.markdown).toContain('> **Note**\n>\n> Body');
    expect(out.markdown).toContain('<details>\n<summary>More</summary>\n\nHidden\n\n</details>');
    expect(out.markdown).toContain('```python\nprint(1)\n```');
  });
});
