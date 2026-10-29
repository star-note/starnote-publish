import { convert, degradeTree, rewriteImageSrcs, truncateText } from '@starnote/publish-core';

import { msg } from './i18n';

import type {
  CommonFormShape,
  Doc,
  ReportItem,
  SdkLang,
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
  script: Pick<SiteScript, 'limits'>,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): CsdnRendered {
  const report: ReportItem[] = [];
  const rawTitle = (common.title || doc.title || '').trim();
  const max = script.limits?.titleMax ?? 100;
  const min = script.limits?.titleMin ?? 5;
  const cut = truncateText(rawTitle, max);
  if (cut.truncated)
    report.push({
      kind: 'title.truncated',
      text: msg(lang).titleTruncated(max),
      level: 'notice',
      samples: [rawTitle],
    });
  if ([...cut.value].length < min)
    report.push({
      kind: 'title.short',
      text: msg(lang).titleShort(min),
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
    ...(lang ? { lang } : {}),
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
