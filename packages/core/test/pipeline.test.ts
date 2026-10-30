import { describe, expect, it } from 'vitest';

import {
  applyRasters,
  contentProfileOf,
  convert,
  extractRasters,
  imagesReport,
  planImage,
  RASTER_SCHEME,
  renderForPlatform,
  watermarkPolicy,
} from '../src/index';

import type { TiptapJSON } from '../src/index';

const t = (text: string, marks?: TiptapJSON['marks']): TiptapJSON =>
  marks ? { type: 'text', text, marks } : { type: 'text', text };
const p = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'paragraph', content });
const cell = (text: string, attrs: Record<string, unknown> = {}): TiptapJSON => ({
  type: 'tableCell',
  attrs,
  content: [p(t(text))],
});

const note: TiptapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('标题')] },
    p(t('公式 '), { type: 'katex', attrs: { text: 'a^2+b^2' } }),
    p(t('看这里', [{ type: 'link', attrs: { href: 'https://starnote.app' } }])),
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('合并', { colspan: 2 })] },
        { type: 'tableRow', content: [cell('a'), cell('b')] },
      ],
    },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;')] },
    { type: 'image', attrs: { src: 'https://cdn.example/a.png', alt: '图' } },
  ],
};
const doc = { ...convert(note), title: '标题' };

describe('content profiles', () => {
  it('knows the split targets and falls back for unknown platforms', () => {
    expect(contentProfileOf('juejin').format).toBe('markdown');
    expect(contentProfileOf('wechat').format).toBe('wechat-html');
    expect(contentProfileOf('xiaohongshu-article').code).toBe('raster');
    expect(contentProfileOf('nope').format).toBe('html');
  });
});

describe('extractRasters', () => {
  it('rasterizes what the profile cannot show and keeps the rest', () => {
    const out = extractRasters(note, contentProfileOf('xiaohongshu-article'));
    expect(out.jobs.map((j) => j.kind)).toEqual(['math', 'table', 'code']);
    expect(out.jobs[0]).toMatchObject({ kind: 'math', tex: 'a^2+b^2', display: false });
    expect(out.jobs[1]).toMatchObject({ kind: 'table' });
    expect((out.jobs[1] as { html: string }).html).toContain('colspan="2"');
    expect(out.jobs[2]).toMatchObject({ kind: 'code', code: 'const a = 1;', language: 'ts' });
    expect(out.linksTextified).toBe(1);
    expect(JSON.stringify(out.json)).not.toContain('"link"');
  });
  it('rasterizes only merged tables under merged-raster', () => {
    const out = extractRasters(note, contentProfileOf('sohu'));
    expect(out.jobs.map((j) => j.kind)).toEqual(['math', 'table']);
    expect(out.linksTextified).toBe(0);
  });
  it('puts the drawn rasters back', () => {
    const out = extractRasters(note, contentProfileOf('sohu'));
    const back = applyRasters(out.json, new Map([['r1', 'https://img/r1.png']]));
    const html = convert(back).portableHtml;
    expect(html).toContain('https://img/r1.png');
    expect(html).toContain(`${RASTER_SCHEME}r2`);
  });
});

describe('renderForPlatform', () => {
  it('Markdown platforms keep formulas, tables and code', () => {
    const r = renderForPlatform('juejin', doc);
    expect(r.format).toBe('markdown');
    expect(r.rasters).toEqual([]);
    expect(r.body).toContain('const a = 1;');
    expect(r.body).not.toMatch(/^# 标题/m);
    expect(r.images).toEqual(['https://cdn.example/a.png']);
  });
  it('HTML platforms get placeholders, a report of what was done, and a finish step', () => {
    const r = renderForPlatform('xiaohongshu-article', doc);
    expect(r.format).toBe('html');
    expect(r.rasters).toHaveLength(3);
    expect(r.images).toEqual(['https://cdn.example/a.png']);
    const kinds = r.report.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['block.rasterized', 'link.textified', 'watermark.no-qrcode'])
    );
    const raster = r.report.find((i) => i.kind === 'block.rasterized')!;
    expect(raster.text).toContain('1 个公式');
    const html = r.finish({
      rasters: new Map([
        ['r1', 'https://x/1.png'],
        ['r2', 'https://x/2.png'],
        ['r3', 'https://x/3.png'],
      ]),
      images: new Map([['https://cdn.example/a.png', 'https://xhs/a.png']]),
    });
    expect(html).not.toContain(RASTER_SCHEME);
    expect(html).toContain('https://xhs/a.png');
  });
  it('知乎 uses the platform formula image when the adapter gives one', () => {
    const r = renderForPlatform('zhihu', doc, {
      mathImageUrl: (tex) => `https://www.zhihu.com/equation?tex=${tex}`,
    });
    expect(r.rasters).toEqual([]);
    expect(r.body).toContain('equation?tex=a^2+b^2');
  });
  it('公众号 goes through its own serializer', () => {
    const r = renderForPlatform('wechat', doc);
    expect(r.format).toBe('wechat-html');
    expect(r.body).toContain('<section');
  });
});

describe('planImage', () => {
  it('fits the long edge and re-encodes what is too heavy or not accepted', () => {
    expect(
      planImage('zhihu', { width: 4000, height: 3000, bytes: 6_000_000, format: 'jpeg' })
    ).toEqual({
      maxBytes: 2 * 1024 * 1024,
      resize: { width: 1920, height: 1440 },
      format: 'jpeg',
      quality: 0.85,
    });
    expect(
      planImage('wechat', { width: 800, height: 600, bytes: 200_000, format: 'webp' })
    ).toMatchObject({
      format: 'jpeg',
    });
    expect(planImage('zhihu', { width: 800, height: 600, bytes: 200_000, format: 'png' })).toEqual({
      maxBytes: 2 * 1024 * 1024,
    });
  });
  it('keeps gifs where the platform takes them', () => {
    expect(
      planImage('wechat', { width: 400, height: 300, bytes: 900_000, format: 'gif' }).format
    ).toBeUndefined();
  });
});

describe('watermark and image report', () => {
  it('drops the QR code where 导流二维码 are forbidden', () => {
    expect(watermarkPolicy('zhihu').qrcode).toBe(false);
    expect(watermarkPolicy('wechat').qrcode).toBe(true);
  });
  it('tells the user how much the images shrank', () => {
    const [item] = imagesReport([{ beforeBytes: 3 * 1024 * 1024, afterBytes: 1024 * 1024 }]);
    expect(item!.kind).toBe('image.optimized');
    expect(item!.text).toContain('2.0 MB');
    expect(imagesReport([])).toEqual([]);
  });
});
