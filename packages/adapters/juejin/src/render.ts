import { convert, degradeTree, rewriteImageSrcs, truncateText } from '@starnote/publish-core';

import type {
  CommonFormShape,
  Doc,
  ReportItem,
  SiteScript,
  TiptapJSON,
} from '@starnote/publish-core';

export interface JuejinRendered {
  title: string;
  brief: string;
  json: TiptapJSON;
  markdown: string;
  /** Images that should go to 掘金's image host. */
  images: string[];
  report: ReportItem[];
}

const JUEJIN_HOSTS = /(^|\.)(juejin\.cn|byteimg\.com|bytednsdoc\.com)$/i;

export function isJuejinImage(src: string): boolean {
  try {
    return JUEJIN_HOSTS.test(new URL(src).hostname);
  } catch {
    return false;
  }
}

/**
 * 掘金摘要 50–100 字（硬限制）：优先用填写的摘要，太短时用正文补齐，太长时截断。
 */
export function juejinBrief(
  preferred: string,
  text: string,
  min = 50,
  max = 100
): { value: string; report: ReportItem[] } {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  let value = clean(preferred);
  const report: ReportItem[] = [];
  if ([...value].length < min) {
    const body = clean(text);
    const extra = body.startsWith(value) ? body.slice(value.length) : value ? ` ${body}` : body;
    value = clean(value + extra);
    if ([...value].length >= min)
      report.push({
        kind: 'summary.generated',
        text: `掘金要求摘要至少 ${min} 字，已用正文补齐`,
        level: 'notice',
      });
    else
      report.push({
        kind: 'summary.short',
        text: `正文不足 ${min} 字，掘金可能拒绝发布`,
        level: 'warn',
      });
  }
  const cut = truncateText(value, max);
  if (cut.truncated)
    report.push({ kind: 'summary.truncated', text: `摘要超过 ${max} 字，已截短`, level: 'info' });
  return { value: cut.value, report };
}

/** Pure 掘金 rendering: Markdown with h2 / h3, callouts → `> **提示**`, `$…$` math, GFM task lists. */
export function renderJuejin(
  doc: Doc,
  common: CommonFormShape,
  script: Pick<SiteScript, 'limits'>,
  brief?: string
): JuejinRendered {
  const report: ReportItem[] = [];
  const rawTitle = (common.title || doc.title || '').trim();
  const titleMax = script.limits?.titleMax ?? 100;
  const cut = truncateText(rawTitle, titleMax);
  if (cut.truncated)
    report.push({
      kind: 'title.truncated',
      text: `标题超过 ${titleMax} 字，已截短`,
      level: 'notice',
      samples: [rawTitle],
    });
  const degraded = degradeTree(doc.json, {
    headings: { min: 2, max: 3 },
    dropTitleHeading: doc.title,
    callouts: { style: 'markdown' },
    math: { mode: 'source' },
    taskList: 'keep',
    flattenDetails: true,
    videoLabel: '视频',
  });
  report.push(...degraded.report);
  const b = juejinBrief(
    brief || common.summary || doc.summary,
    doc.text,
    script.limits?.summaryMin ?? 50,
    script.limits?.summaryMax ?? 100
  );
  report.push(...b.report);
  const converted = convert(degraded.json);
  return {
    title: cut.value,
    brief: b.value,
    json: degraded.json,
    markdown: converted.markdown,
    images: converted.images.filter((src) => !isJuejinImage(src)),
    report,
  };
}

export function withImages(rendered: JuejinRendered, map: ReadonlyMap<string, string>): string {
  return map.size ? convert(rewriteImageSrcs(rendered.json, map)).markdown : rendered.markdown;
}
