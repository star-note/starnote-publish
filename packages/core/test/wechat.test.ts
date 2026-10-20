import { describe, expect, it } from 'vitest';

import { convert } from '../src/convert';
import { convertWechat, WECHAT_DIVIDER_VARIANTS, wechatDivider } from '../src/wechat';

import type { TiptapJSON } from '../src/types';

const text = (t: string, marks?: TiptapJSON['marks']): TiptapJSON => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'paragraph', content });
const doc = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'doc', content });
const h = (level: number, t: string, variant?: string): TiptapJSON => ({
  type: 'heading',
  attrs: { level, ...(variant ? { variant } : {}) },
  content: [text(t)],
});
const quote = (variant: string | null, ...content: TiptapJSON[]): TiptapJSON => ({
  type: 'blockquote',
  attrs: { variant },
  content,
});
const card = (variant: string, label: string | null, ...content: TiptapJSON[]): TiptapJSON => ({
  type: 'card',
  attrs: { variant, label },
  content,
});
const divider = (variant: string, label: string | null = null): TiptapJSON => ({
  type: 'divider',
  attrs: { variant, label },
});

/**
 * What the 公众号 editor keeps, as documented in README「微信公众号 HTML」: the
 * serializer must stay inside these tags, SVG elements and CSS properties.
 */
const ALLOWED_TAGS = new Set([
  'section',
  'p',
  'span',
  'strong',
  'em',
  'sup',
  'a',
  'br',
  'img',
  'ul',
  'ol',
  'li',
  'table',
  'tbody',
  'tr',
  'td',
  'th',
  'blockquote',
  'code',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'svg',
  'g',
  'path',
  'rect',
  'circle',
]);
const ALLOWED_CSS = new Set([
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-bottom',
  'padding-left',
  'display',
  'align-items',
  'flex-shrink',
  'width',
  'min-width',
  'max-width',
  'height',
  'line-height',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'letter-spacing',
  'color',
  'text-align',
  'text-decoration',
  'vertical-align',
  'border',
  'border-left',
  'border-bottom',
  'border-radius',
  'border-collapse',
  'background-color',
  'background-image',
  'background-repeat',
  'background-position',
  'background-size',
  'box-shadow',
  'box-sizing',
  'overflow',
  'overflow-x',
  'white-space',
  'word-break',
  'list-style-type',
]);

function checkWechatSafe(html: string) {
  for (const [, name] of html.matchAll(/<([a-z0-9]+)[\s>/]/gi)) {
    expect(ALLOWED_TAGS, `tag <${name}>`).toContain(name!.toLowerCase());
  }
  expect(html).not.toMatch(
    /\sclass=|\sid=|<style|<script|<defs|<div|<figure|url\(#|(?<![-\w])position:|float:|[;"]\s*transform:/i
  );
  for (const [, style] of html.matchAll(/style="([^"]*)"/g)) {
    for (const decl of style!.split(';')) {
      const prop = decl.split(':')[0]!.trim();
      if (prop) expect(ALLOWED_CSS, `css ${prop}`).toContain(prop);
    }
  }
}

const rich = doc(
  h(1, '标题'),
  p(
    text('正文 '),
    text('加粗', [{ type: 'bold' }]),
    text(' 链接', [{ type: 'link', attrs: { href: 'https://example.com' } }])
  ),
  h(2, '第一节', 'pill'),
  h(2, '第二节', 'pill'),
  h(3, '小节', 'bar'),
  h(2, '下划线', 'underline'),
  h(2, '装饰', 'ornament'),
  h(2, '第一步', 'step'),
  h(2, '第二步', 'step'),
  h(2, '标签', 'tag'),
  quote('card', p(text('引文卡片'))),
  quote('center', p(text('金句'))),
  quote('line', p(text('竖线'))),
  quote('paper', p(text('便笺'))),
  quote(null, p(text('默认引用'))),
  ...['soft', 'outline', 'shadow', 'accent', 'ticket', 'tip', 'warn', 'ask', 'answer', 'end'].map(
    (v) => card(v, v === 'tip' ? '重点' : null, p(text(`卡片 ${v}`)))
  ),
  card('dark', '新品', h(2, '深色卡片'), p(text('白字'))),
  card('outline', '时间地点', p(text('10 月 20 日'))),
  card(
    'stat',
    '数据',
    p({ type: 'text', text: '68%', marks: [{ type: 'bold' }] }, text(' 手机阅读占比')),
    p(text('手机阅读占比达到 68%。'))
  ),
  ...WECHAT_DIVIDER_VARIANTS.map((v) => divider(v, v === 'text' ? '第二部分' : null)),
  { type: 'horizontalRule' },
  { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('一'))] }] },
  {
    type: 'orderedList',
    attrs: { start: 3 },
    content: [{ type: 'listItem', content: [p(text('三'))] }],
  },
  {
    type: 'taskList',
    content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('完成'))] }],
  },
  {
    type: 'codeBlock',
    attrs: { language: 'ts' },
    content: [text('const a = 1;\n  return a < 2;')],
  },
  { type: 'imageBlock', attrs: { src: '/api/v1/assets/abc', caption: '图注', align: 'center' } },
  {
    type: 'table',
    content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(text('列'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(text('值'))] }] },
    ],
  },
  p()
);

describe('convertWechat', () => {
  it('only emits tags, SVG elements and CSS properties the 公众号 editor keeps', () => {
    const { html } = convertWechat(rich, { assetBase: 'https://starnote.app' });
    checkWechatSafe(html);
    expect(html.startsWith('<section style="')).toBe(true);
  });

  it('numbers pill and step headings in document order', () => {
    const { html } = convertWechat(rich);
    expect(html.indexOf('>01</span><span>第一节')).toBeGreaterThan(0);
    expect(html.indexOf('>02</span><span>第二节')).toBeGreaterThan(0);
    expect(html).toContain('STEP 01');
    expect(html).toContain('STEP 02');
  });

  it('turns badges, quote marks and dark cards into real inline-styled nodes', () => {
    const { html } = convertWechat(rich);
    expect(html).toContain('>重点</section>');
    expect(html).toContain('>时间地点</section>');
    expect(html).toContain('“</p>');
    // Headings inside a dark card are white.
    expect(html).toMatch(/<h2 style="[^"]*color: #ffffff[^"]*">深色卡片<\/h2>/);
  });

  it('resolves relative images against assetBase and lists them', () => {
    const { html, images } = convertWechat(rich, { assetBase: 'https://starnote.app/' });
    expect(images).toEqual(['https://starnote.app/api/v1/assets/abc']);
    expect(html).toContain('src="https://starnote.app/api/v1/assets/abc"');
    expect(html).toContain('>图注</p>');
  });

  it('collects external links as numbered references; keeps mp.weixin links', () => {
    const json = doc(
      p(text('外链', [{ type: 'link', attrs: { href: 'https://example.com/a' } }])),
      p(text('站内', [{ type: 'link', attrs: { href: 'https://mp.weixin.qq.com/s/xyz' } }]))
    );
    const { html, links } = convertWechat(json);
    expect(links).toEqual([{ text: '外链', href: 'https://example.com/a' }]);
    expect(html).toContain('[1]</sup>');
    expect(html).toContain('[1] 外链: https://example.com/a');
    expect(html).toContain('<a href="https://mp.weixin.qq.com/s/xyz"');
    expect(html).not.toContain('href="https://example.com/a"');
  });

  it('keeps code whitespace with &nbsp; and <br>', () => {
    const { html } = convertWechat(rich);
    expect(html).toContain('const a = 1;<br>&nbsp;&nbsp;return a &lt; 2;');
  });

  it('draws every divider look as inline SVG without ids or gradients', () => {
    for (const v of WECHAT_DIVIDER_VARIANTS) {
      const out = wechatDivider(v, v === 'text' ? '文字' : undefined);
      checkWechatSafe(out);
      if (v !== 'text' && v !== 'number' && v !== 'end') expect(out, v).toContain('<svg');
    }
    expect(wechatDivider('text', '第二部分')).toContain('第二部分');
    expect(wechatDivider('end', undefined)).toContain('END');
    // Unknown looks fall back to a plain rule rather than disappearing.
    expect(wechatDivider('nope', undefined)).toBe(wechatDivider('line', undefined));
  });

  it('can use pre-rendered divider images instead', () => {
    const { html } = convertWechat(doc(divider('wave')), {
      dividerMode: 'img',
      assetBase: 'https://starnote.app',
    });
    expect(html).toContain('<img src="https://starnote.app/materials/dividers/wave.png"');
    expect(html).not.toContain('<svg');
  });

  it('applies a custom accent colour', () => {
    const { html } = convertWechat(doc(h(2, 'A', 'bar')), { accent: '#1677ff' });
    expect(html).toContain('border-left: 4px solid #1677ff');
  });

  it('escapes text and rejects unsafe colours', () => {
    const json = doc(
      p(text('<b>x</b>', [{ type: 'textStyle', attrs: { color: 'red;background:url(x)' } }]))
    );
    const { html } = convertWechat(json);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('url(x)');
  });
});

describe('convert: styled blocks (blog HTML)', () => {
  it('writes the same classes as the editor', () => {
    const out = convert(
      doc(
        h(2, '一', 'pill'),
        quote('card', p(text('q'))),
        card('tip', '重点', p(text('c'))),
        divider('wave'),
        divider('text', '第二部分'),
        h(2, '坏', 'bad variant"><script>')
      )
    );
    expect(out.html).toContain('<h2 id="h-0-一" class="sn-h sn-h--pill">一</h2>');
    expect(out.html).toContain('<blockquote class="sn-quote sn-quote--card">');
    expect(out.html).toContain('<div class="sn-box sn-box--tip" data-label="重点">');
    expect(out.html).toContain(
      '<div class="divider divider--wave" data-variant="wave" role="separator"><hr></div>'
    );
    expect(out.html).toContain('<hr><span class="divider__label">第二部分</span><hr>');
    expect(out.html).toContain('<h2 id="h-1-坏">坏</h2>');
    expect(out.markdown).toContain('---');
    expect(out.text).toContain('c');
  });
});

describe('convertWechat: code like the editor', () => {
  const code: TiptapJSON = {
    type: 'doc',
    content: [
      {
        type: 'codeBlock',
        attrs: { language: 'js' },
        content: [{ type: 'text', text: 'const a = 1;\n  return a; // done' }],
      },
    ],
  };

  it('colours every token inline and keeps lines, indentation and the language label', () => {
    const { html } = convertWechat(code, {
      highlight: () => ({
        label: 'JavaScript',
        tokens: [
          { type: 'kwd', text: 'const' },
          { text: ' a = 1;\n  ' },
          { type: 'kwd', text: 'return' },
          { text: ' a; ' },
          { type: 'cmnt', text: '// done' },
        ],
      }),
    });
    checkWechatSafe(html);
    expect(html).toContain('<span style="color: #cf222e">const</span>');
    expect(html).toContain('<br>&nbsp;&nbsp;<span style="color: #cf222e">return</span>');
    expect(html).toContain('color: #6e7781; font-style: italic');
    expect(html).toContain('JavaScript');
    expect(html).toContain('white-space: pre');
    expect(html).toContain('overflow-x: auto');
  });

  it('falls back to one colour without a highlighter', () => {
    const { html } = convertWechat(code);
    checkWechatSafe(html);
    expect(html).toContain('const a = 1;<br>&nbsp;&nbsp;return a; // done');
  });

  it('lays out a 数据卡 (stat) as big figures over the source sentence', () => {
    const { html } = convertWechat(rich);
    expect(html).toContain('>68%</span>');
    expect(html).toContain('手机阅读占比达到 68%。');
    expect(html).toMatch(/font-size: 26px; font-weight: 700[^"]*">68%/);
  });
});
