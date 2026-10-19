import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ARTICLE_THEME_IDS,
  ARTICLE_THEMES,
  convertWechat,
  getArticleTheme,
  isArticleThemeId,
  recommendThemes,
  themeClassName,
} from '../src';

import type { TiptapJSON } from '../src';

const SCSS = fileURLToPath(
  new URL('../../../../ai-sparkwrite-editor/src/styles/themes.scss', import.meta.url)
);

/** `$sn-themes: (id: (key: value, …), …)` → plain objects (values as written). */
function scssTokens(source: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const map = source.slice(source.indexOf('$sn-themes:'));
  for (const m of map.matchAll(/^\s{2}([a-z]+):\s*\(([^()]*)\)/gm)) {
    const tokens: Record<string, string> = {};
    for (const line of m[2]!.split('\n')) {
      const kv = line.trim().match(/^([A-Za-z0-9]+):\s*(.+?),?$/);
      if (kv) tokens[kv[1]!] = kv[2]!;
    }
    out[m[1]!] = tokens;
  }
  return out;
}

describe.skipIf(!existsSync(SCSS))('themes.scss ↔ themes.ts', () => {
  const scss = scssTokens(readFileSync(SCSS, 'utf8'));

  it('defines the same themes', () => {
    expect(Object.keys(scss).sort()).toEqual([...ARTICLE_THEME_IDS].sort());
  });

  for (const id of ARTICLE_THEME_IDS) {
    it(`${id}: tokens match`, () => {
      const t = ARTICLE_THEMES[id];
      const s = scss[id]!;
      expect(s.accent?.toLowerCase()).toBe(t.accent);
      expect(s.accent2?.toLowerCase()).toBe(t.accent2);
      expect(s.ink?.toLowerCase()).toBe(t.ink);
      expect(s.heading?.toLowerCase()).toBe(t.heading);
      expect(s.muted?.toLowerCase()).toBe(t.muted);
      expect(Number(s.fontSize)).toBe(t.fontSize);
      expect(Number(s.lineHeight)).toBe(t.lineHeight);
      expect(Number(s.paragraphGap)).toBe(t.paragraphGap);
      expect(Number(s.letterSpacing)).toBe(t.letterSpacing);
      expect(s.justify === 'true').toBe(t.justify);
      expect(s.h2).toBe(t.h2);
      expect(s.h3).toBe(t.h3);
      expect(s.quote).toBe(t.quote);
      expect(s.hr).toBe(t.hr);
      expect(Number(s.cardRadius)).toBe(t.cardRadius);
      expect(Number(s.captionSize)).toBe(t.caption.size);
      expect(s.captionColor?.toLowerCase()).toBe(t.caption.color);
      expect(s.captionAlign).toBe(t.caption.align);
      expect(s.captionItalic === 'true').toBe(Boolean(t.caption.italic));
    });
  }
});

describe('themes.ts', () => {
  it('ids, lookup and class names', () => {
    expect(ARTICLE_THEME_IDS).toEqual(['business', 'tech', 'warm', 'magazine', 'fresh']);
    expect(getArticleTheme('tech')?.name).toBe('科技蓝');
    expect(getArticleTheme('nope')).toBeNull();
    expect(getArticleTheme(null)).toBeNull();
    expect(isArticleThemeId('warm')).toBe(true);
    expect(isArticleThemeId('Warm')).toBe(false);
    expect(themeClassName('tech')).toBe('sn-theme sn-theme--tech');
    expect(themeClassName(null)).toBe('');
    expect(themeClassName('x')).toBe('');
  });

  it('every theme is complete and distinct', () => {
    const looks = new Set(
      ARTICLE_THEME_IDS.map((id) => {
        const t = ARTICLE_THEMES[id];
        expect([15, 16]).toContain(t.fontSize);
        expect(t.lineHeight).toBeGreaterThanOrEqual(1.7);
        expect(t.lineHeight).toBeLessThanOrEqual(1.95);
        return `${t.h2}/${t.quote}/${t.hr}`;
      })
    );
    expect(looks.size).toBe(5);
  });

  it('recommends by taxonomy slug, name or string; falls back to all', () => {
    expect(recommendThemes({ slug: 'frontend' })[0]).toBe('tech');
    expect(recommendThemes({ slug: 'science' })[0]).toBe('tech');
    expect(recommendThemes({ slug: 'finance' })[0]).toBe('business');
    expect(recommendThemes({ slug: 'workplace' })[0]).toBe('business');
    expect(recommendThemes({ slug: 'poetry' })[0]).toBe('warm');
    expect(recommendThemes({ slug: 'journal' })[0]).toBe('warm');
    expect(recommendThemes({ slug: 'fashion' })[0]).toBe('magazine');
    expect(recommendThemes({ slug: 'travel' })[0]).toBe('magazine');
    expect(recommendThemes({ slug: 'food' })[0]).toBe('fresh');
    expect(recommendThemes({ slug: 'family' })[0]).toBe('fresh');
    expect(recommendThemes({ name: '数码评测' })[0]).toBe('tech');
    expect(recommendThemes('读书')[0]).toBe('warm');
    expect(recommendThemes('education')[0]).toBe('fresh');
    expect(recommendThemes({ slug: 'misc', name: '其他' })).toEqual([...ARTICLE_THEME_IDS]);
    expect(recommendThemes()).toEqual([...ARTICLE_THEME_IDS]);
    for (const id of ARTICLE_THEME_IDS) {
      expect(new Set(recommendThemes(id === 'tech' ? 'ai' : id)).size).toBe(5);
    }
  });
});

const p = (text: string, attrs?: Record<string, unknown>): TiptapJSON => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text }],
});
const doc = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'doc', content });
const h = (level: number, text: string, variant?: string): TiptapJSON => ({
  type: 'heading',
  attrs: { level, ...(variant ? { variant } : {}) },
  content: [{ type: 'text', text }],
});
const html = (json: TiptapJSON, opts: Parameters<typeof convertWechat>[1] = {}) =>
  convertWechat(json, { mobile: false, mask: false, ...opts }).html;

describe('convertWechat theme', () => {
  it('no theme / null theme leaves the output unchanged', () => {
    const d = doc(h(2, '标题'), p('正文'), { type: 'horizontalRule' });
    expect(html(d, { theme: null })).toBe(html(d));
    expect(html(d, { theme: 'nope' as never })).toBe(html(d));
  });

  it('palette, body size, line height, letter spacing and justify', () => {
    const out = html(doc(p('一段正文'), p('居中', { textAlign: 'center' })), { theme: 'warm' });
    expect(out).toMatch(
      /^<section style="font-size: 16px; line-height: 1.9; color: #4a4038; letter-spacing: 1px;[^"]*text-align: justify"/
    );
    expect(out).toContain('<p style="margin: 0 0 24px; line-height: 1.9">一段正文</p>');
    expect(out).toContain(
      '<p style="margin: 0 0 24px; line-height: 1.9; text-align: center">居中</p>'
    );
  });

  it('accent comes from the theme unless given; explicit fontSize wins', () => {
    const out = html(doc(h(2, 'A')), { theme: 'tech' });
    expect(out).toContain('background-color: #1e6fff');
    const own = html(doc(h(2, 'A')), { theme: 'tech', accent: '#ff0000', fontSize: 17 });
    expect(own).toContain('background-color: #ff0000');
    expect(own).not.toContain('#1e6fff');
    expect(own).toMatch(/^<section style="font-size: 17px/);
  });

  it('accepts a theme object', () => {
    const custom = { ...ARTICLE_THEMES.business, accent: '#123456' };
    expect(html(doc(h(2, 'A')), { theme: custom })).toContain('border-left: 4px solid #123456');
  });

  it('h2 / h3 without a variant get the theme look; an explicit variant wins', () => {
    const business = html(doc(h(2, '竖条'), h(3, '小节')), { theme: 'business' });
    expect(business).toContain(
      'padding: 2px 0 2px 12px; border-left: 4px solid #1f4e8c">竖条</h2>'
    );
    expect(business).toContain('color: #1f4e8c; letter-spacing: 0.5px">小节</h3>');
    const tech = html(doc(h(2, '色块')), { theme: 'tech' });
    expect(tech).toMatch(
      /<h2 [^>]*><span style="display: inline-block; padding: 4px 14px;[^"]*">色块<\/span><\/h2>/
    );
    const warm = html(doc(h(2, '居中')), { theme: 'warm' });
    expect(warm).toContain('text-align: center">居中</h2><svg');
    const magazine = html(doc(h(2, '下划线')), { theme: 'magazine' });
    expect(magazine).toContain('background-size: 48px 3px, 100% 1px');
    const fresh = html(doc(h(2, '柔和'), h(3, '点')), { theme: 'fresh' });
    expect(fresh).toContain('background-color: rgba(42, 157, 111, 0.1)');
    expect(fresh).toContain('<circle cx="4" cy="4" r="4" fill="#2a9d6f"/></svg>点</h3>');

    const variant = html(doc(h(2, '胶囊', 'pill')), { theme: 'business' });
    const plainVariant = html(doc(h(2, '胶囊', 'pill')), { accent: '#1f4e8c' });
    expect(variant).toContain('>01</span>');
    expect(variant).not.toContain('border-left: 4px solid');
    // the variant's own look (in the theme's palette), not the theme's h2 bar
    expect(variant).toContain('border-bottom: 1px solid rgba(31, 78, 140, 0.16)');
    expect(plainVariant).toContain('border-bottom: 1px solid rgba(31, 78, 140, 0.16)');
  });

  it('quotes without a variant follow the theme; variants keep their look', () => {
    const q = (variant?: string): TiptapJSON => ({
      type: 'blockquote',
      ...(variant ? { attrs: { variant } } : {}),
      content: [p('引文')],
    });
    expect(html(doc(q()), { theme: 'tech' })).toContain(
      '<section style="margin: 20px 0; padding: 14px 18px; border-radius: 10px; background-color: rgba(30, 111, 255, 0.06)">'
    );
    expect(html(doc(q()), { theme: 'magazine' })).toContain('border-top: 1px solid #111111');
    expect(html(doc(q()), { theme: 'warm' })).toContain('text-align: center; font-size: 17px');
    expect(html(doc(q()), { theme: 'business' })).not.toContain('<blockquote');
    expect(html(doc(q('paper')), { theme: 'tech' })).toContain('1px dashed');
  });

  it('plain dividers follow the theme; ornamental dividers do not', () => {
    const hr = html(doc({ type: 'horizontalRule' }), { theme: 'business' });
    expect(hr).toContain('<rect x="136" y="0" width="48" height="2" rx="1" fill="#1f4e8c"/>');
    const line = html(doc({ type: 'divider', attrs: { variant: 'line' } }), { theme: 'business' });
    expect(line).toBe(hr);
    const dots = html(doc({ type: 'horizontalRule' }), { theme: 'warm' });
    expect(dots.match(/<circle /g)).toHaveLength(3);
    const dashed = html(doc({ type: 'horizontalRule' }), { theme: 'fresh' });
    expect(dashed.match(/<rect /g)).toHaveLength(32);
    const wave = html(doc({ type: 'divider', attrs: { variant: 'wave' } }), { theme: 'fresh' });
    expect(wave).toBe(
      html(doc({ type: 'divider', attrs: { variant: 'wave' } }), {
        accent: '#2a9d6f',
        accent2: '#5cbf95',
        theme: 'fresh',
      })
    );
    expect(wave).toContain('<path d="M0 4C4');
  });

  it('captions and card corners', () => {
    const img = html(
      doc({ type: 'image', attrs: { src: 'https://x.test/a.png', caption: '图注' } }),
      {
        theme: 'warm',
      }
    );
    expect(img).toContain(
      '<p style="margin: 0 0 16px; text-align: center; font-size: 13px; line-height: 1.6; color: #a29486; font-style: italic">图注</p>'
    );
    const left = html(
      doc({ type: 'image', attrs: { src: 'https://x.test/a.png', caption: '图注' } }),
      {
        theme: 'magazine',
      }
    );
    expect(left).toContain('text-align: left; font-size: 12px');
    const card = (variant: string): TiptapJSON => ({
      type: 'card',
      attrs: { variant },
      content: [p('卡')],
    });
    expect(html(doc(card('soft')), { theme: 'magazine' })).toContain('border-radius: 0px');
    expect(html(doc(card('soft')), { theme: 'fresh' })).toContain('border-radius: 14px');
    expect(html(doc(card('tip')), { theme: 'fresh' })).toContain(
      'border-radius: 4px 12px 12px 4px'
    );
  });
});
