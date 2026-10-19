import { describe, expect, it } from 'vitest';

import { convert, degradeTree, rewriteImageSrcs, truncateText } from '../src/index';

import type { TiptapJSON } from '../src/index';

const t = (text: string): TiptapJSON => ({ type: 'text', text });
const doc: TiptapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('标题')] },
    { type: 'heading', attrs: { level: 2, variant: 'pill' }, content: [t('一')] },
    { type: 'heading', attrs: { level: 4 }, content: [t('四')] },
    {
      type: 'card',
      attrs: { variant: 'tip' },
      content: [{ type: 'paragraph', content: [t('小心')] }],
    },
    { type: 'divider', attrs: { variant: 'wave' } },
    { type: 'paragraph', content: [{ type: 'katex', attrs: { text: 'a^2' } }] },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [t('完成')] }],
        },
      ],
    },
    { type: 'iframe', attrs: { src: 'https://www.youtube.com/embed/x' } },
    { type: 'imageBlock', attrs: { src: 'https://cdn/a.png', caption: '图' } },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 2 },
              content: [{ type: 'paragraph', content: [t('x')] }],
            },
          ],
        },
      ],
    },
  ],
};

describe('degradeTree', () => {
  it('degrades our blocks for an HTML platform and reports it', () => {
    const r = degradeTree(doc, {
      headings: { min: 2, max: 3 },
      dropTitleHeading: '标题',
      callouts: { style: 'html' },
      math: { mode: 'image', url: (tex) => `https://eq/?tex=${encodeURIComponent(tex)}` },
      taskList: 'symbols',
      videoLabel: '视频',
    });
    const html = convert(r.json).portableHtml;
    expect(html).not.toContain('>标题<');
    expect(html).toContain('<h2 id="h-0-一">一</h2>');
    expect(html).toContain('<h3');
    expect(html).toContain('<blockquote>\n<p><strong>提示：</strong></p>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<img src="https://eq/?tex=a%5E2" alt="a^2">');
    expect(html).toContain('☑ 完成');
    expect(html).toContain('视频：<a href="https://www.youtube.com/embed/x">');
    expect(r.counts).toEqual({
      headings: 2,
      callouts: 1,
      dividers: 1,
      math: 1,
      tasks: 1,
      details: 0,
      videos: 1,
      mergedTables: 1,
    });
    expect(r.report.map((i) => i.kind)).toEqual([
      'block.degraded',
      'math.rasterized',
      'video.linkified',
      'table.merged-kept',
    ]);
  });

  it('keeps math and task lists as Markdown for Markdown platforms', () => {
    const r = degradeTree(doc, {
      headings: { min: 2, max: 3 },
      callouts: { style: 'markdown' },
      math: { mode: 'source' },
    });
    const md = convert(r.json).markdown;
    expect(md).toContain('## 标题');
    expect(md).toContain('> **提示**\n>\n> 小心');
    expect(md).toContain('$a^2$');
    expect(md).toContain('- [x] 完成');
    expect(r.report.find((i) => i.kind === 'math.as-source')).toBeTruthy();
  });

  it('rewrites image sources and truncates text', () => {
    const md = convert(
      rewriteImageSrcs(doc, new Map([['https://cdn/a.png', 'https://pic.zhimg.com/a.png']]))
    ).markdown;
    expect(md).toContain('https://pic.zhimg.com/a.png');
    expect(truncateText('一二三四五', 3)).toEqual({ value: '一二…', truncated: true });
    expect(truncateText('一二', 3)).toEqual({ value: '一二', truncated: false });
  });
});
