import { convert, degradeTree, rewriteImageSrcs, truncateText } from '@starnote/publish-core';

import type {
  CommonFormShape,
  Doc,
  ReportItem,
  SiteScript,
  TiptapJSON,
} from '@starnote/publish-core';

export interface CsdnRendered {
  title: string;
  json: TiptapJSON;
  markdown: string;
  images: string[];
  report: ReportItem[];
}

const CSDN_HOSTS = /(^|\.)(csdnimg\.cn|csdn\.net|myhuaweicloud\.com)$/i;

export function isCsdnImage(src: string): boolean {
  try {
    return CSDN_HOSTS.test(new URL(src).hostname);
  } catch {
    return false;
  }
}

/** Pure CSDN rendering: Markdown (CSDN's editor is Markdown), same degradation as 掘金. */
export function renderCsdn(
  doc: Doc,
  common: CommonFormShape,
  script: Pick<SiteScript, 'limits'>
): CsdnRendered {
  const report: ReportItem[] = [];
  const rawTitle = (common.title || doc.title || '').trim();
  const max = script.limits?.titleMax ?? 100;
  const min = script.limits?.titleMin ?? 5;
  const cut = truncateText(rawTitle, max);
  if (cut.truncated)
    report.push({
      kind: 'title.truncated',
      text: `标题超过 ${max} 字，已截短`,
      level: 'notice',
      samples: [rawTitle],
    });
  if ([...cut.value].length < min)
    report.push({
      kind: 'title.short',
      text: `CSDN 要求标题至少 ${min} 个字，请在编辑器里补全`,
      level: 'warn',
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
  const converted = convert(degraded.json);
  return {
    title: cut.value,
    json: degraded.json,
    markdown: converted.markdown,
    images: converted.images.filter((src) => !isCsdnImage(src)),
    report,
  };
}

export function withImages(rendered: CsdnRendered, map: ReadonlyMap<string, string>): string {
  return map.size ? convert(rewriteImageSrcs(rendered.json, map)).markdown : rendered.markdown;
}
