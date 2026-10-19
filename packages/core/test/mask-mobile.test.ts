import { describe, expect, it } from 'vitest';

import {
  convert,
  convertFor,
  convertWechat,
  mobileHtml,
  mobileOptionsFor,
  PLATFORMS,
  platformMeta,
} from '../src/index';

import type { TiptapJSON } from '../src/index';

const ONLY = { words: [], extraWords: ['敏感词', '违禁品'] };

const p = (text: string): TiptapJSON => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (text: string, header = false): TiptapJSON => ({
  type: header ? 'tableHeader' : 'tableCell',
  content: [p(text)],
});
const table = (cols: number, rows = 2): TiptapJSON => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: Array.from({ length: cols }, (_, i) => cell(`列${i + 1}`, true)) },
    ...Array.from({ length: rows }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, (_, i) => cell(`值${r}-${i}`)),
    })),
  ],
});
const doc = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'doc', content });

describe('convert: mask (敏感词自动打码)', () => {
  const json = doc(
    p('这里有敏感词，还有违禁品。'),
    { type: 'codeBlock', content: [{ type: 'text', text: 'const 敏感词 = 1' }] },
    { type: 'imageBlock', attrs: { src: '/a.png', caption: '违禁品图' } }
  );

  it('is on by default and replaces hits with ** in every output', () => {
    const d = convert(json, { mask: ONLY });
    expect(d.html).toContain('这里有**，还有**。');
    // Markdown escapes the asterisks so they are not read as emphasis (also after a second conversion)
    expect(d.markdown).toContain('这里有\\*\\*，还有\\*\\*。');
    expect(convert(d.json, { mask: ONLY }).markdown).toContain('这里有\\*\\*');
    expect(d.text).toContain('这里有**');
    expect(d.html).toContain('**图');
    // code is code
    expect(d.html).toContain('const 敏感词 = 1');
    expect(d.masked?.count).toBe(3);
    expect(d.report?.find((r) => r.kind === 'mask.applied')?.text).toContain('已自动打码 3 处');
    // the published copy never carries the preview mark
    expect(d.html).not.toContain('sn-masked');
  });

  it('marks hits in the preview HTML only', () => {
    const d = convert(json, { mask: { ...ONLY, preview: true } });
    expect(d.html).toContain('<mark class="sn-masked" title="已自动打码">**</mark>');
    expect(d.markdown).not.toContain('mark');
    expect(d.markdown).toContain('这里有\\*\\*');
  });

  it('hands renderHtml a tree without the mask marks', () => {
    const seen: string[] = [];
    convert(json, {
      mask: ONLY,
      renderHtml: (root) => {
        seen.push(JSON.stringify(root));
        return '';
      },
    });
    expect(seen[0]).not.toContain('snMasked');
    expect(seen[0]).toContain('这里有**');
  });

  it('can be turned off and does not touch clean text', () => {
    expect(convert(json, { mask: false }).html).toContain('这里有敏感词');
    expect(convert(json, { mask: false }).masked).toBeUndefined();
    const clean = convert(doc(p('一段正常的文字')));
    expect(clean.masked?.count).toBe(0);
    expect(clean.report).toBeUndefined();
  });

  it('masks the 公众号 converter too', () => {
    const w = convertWechat(json, { mask: ONLY, mobile: false });
    expect(w.html).toContain('这里有**');
    expect(w.masked?.count).toBe(3);
  });
});

describe('registry: mobileFirst', () => {
  it('is a boolean on every platform, true for the phone-first ones', () => {
    for (const x of PLATFORMS) expect(typeof x.mobileFirst).toBe('boolean');
    for (const k of ['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'baijiahao', 'weibo', 'bilibili', 'douyin'])
      expect(platformMeta(k)?.mobileFirst).toBe(true);
    for (const k of ['chenji', 'github-pages', 'devto', 'juejin']) expect(platformMeta(k)?.mobileFirst).toBe(false);
    expect(mobileOptionsFor('wechat')).toEqual({ scrollTables: false, imageWidth: 'fill' });
    expect(mobileOptionsFor('zhihu')).toEqual({ scrollTables: true, imageWidth: 'fit' });
    expect(mobileOptionsFor('devto')).toBe(false);
  });
});

describe('mobile-first output', () => {
  const img: TiptapJSON = { type: 'imageBlock', attrs: { src: '/a.png', width: 640, height: 480 } };

  it('fits images to the screen (max-width) and drops fixed sizes', () => {
    const d = convertFor('zhihu', doc(img));
    // a picture narrower than the column keeps its own size: max-width, never a forced 100% width
    expect(d.html).toMatch(/<img[^>]*style="max-width:100%;height:auto"/);
    expect(d.html).not.toContain('style="width:100%');
    expect(d.html).not.toMatch(/\swidth="640"/);
    expect(d.html).not.toMatch(/\sheight="480"/);
    expect(d.report?.find((r) => r.kind === 'mobile.images')?.text).toContain('窄图保持原尺寸');
  });

  it('stretches images only where the platform editor does (公众号: imageWidth fill)', () => {
    expect(mobileOptionsFor('wechat')).toMatchObject({ imageWidth: 'fill' });
    expect(mobileOptionsFor('zhihu')).toMatchObject({ imageWidth: 'fit' });
    expect(mobileOptionsFor('xiaohongshu')).toMatchObject({ imageWidth: 'fit' });
    expect(convertFor('wechat', doc(img)).html).toMatch(/<img[^>]*style="width:100%;height:auto"/);
    expect(mobileHtml('<img src="/a.png" style="width:320px">', { imageWidth: 'fill' }).html).toBe(
      '<img src="/a.png" style="width:100%;height:auto">'
    );
    expect(mobileHtml('<img src="/a.png" style="width:320px">').html).toBe(
      '<img src="/a.png" style="max-width:100%;height:auto">'
    );
    // idempotent on its own output
    const once = mobileHtml('<img src="/a.png" width="640">').html;
    expect(mobileHtml(once).html).toBe(once);
  });

  it('wraps tables in a horizontal scroller where the platform keeps it', () => {
    const d = convertFor('zhihu', doc(table(6)));
    expect(d.html).toContain('<div class="sn-table-scroll" style="overflow-x:auto;');
    expect(d.report?.find((r) => r.kind === 'mobile.table-scroll')?.count).toBe(1);
  });

  it('turns wide tables into one card per row where scrolling is stripped (公众号)', () => {
    const d = convertFor('wechat', doc(table(5), table(3)));
    expect(d.html.match(/class="sn-table-card"/g)?.length).toBe(2);
    expect(d.html).toContain('<strong>列1</strong>：值0-0');
    // a narrow table stays a table
    expect(d.html.match(/<table/g)?.length).toBe(1);
    expect(d.report?.find((r) => r.kind === 'mobile.table-cards')?.text).toContain('超过 4 列');
  });

  it('applies to the 公众号 converter by default', () => {
    const w = convertWechat(doc(img, table(6)), { mask: false });
    expect(w.html).toContain('width:100%;height:auto');
    expect(w.html).toContain('sn-table-card');
    expect(w.html).not.toContain('<table');
    expect(w.report?.map((r) => r.kind)).toEqual(['mobile.images', 'mobile.table-cards']);
  });

  it('leaves non mobile-first platforms alone and is idempotent', () => {
    const d = convertFor('devto', doc(img, table(6)));
    expect(d.html).toContain('width="640"');
    expect(d.html).not.toContain('sn-table-scroll');
    const once = mobileHtml(convert(doc(img, table(6))).html);
    expect(mobileHtml(once.html).html).toBe(once.html);
  });
});
