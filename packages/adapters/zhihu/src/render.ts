import {
  convert,
  degradeTree,
  fillTemplate,
  rewriteImageSrcs,
  truncateText,
} from '@starnote/publish-core';

import { msg } from './i18n';

import type {
  CommonFormShape,
  Doc,
  ReportItem,
  SdkLang,
  SiteScript,
  TiptapJSON,
} from '@starnote/publish-core';

export interface ZhihuRendered {
  title: string;
  /** Degraded tree (images can still be rewritten before `toZhihuHtml`). */
  json: TiptapJSON;
  html: string;
  /** Image `src`s that must be uploaded to 知乎 (formula images and zhimg already excluded). */
  images: string[];
  report: ReportItem[];
}

const ZHIHU_HOSTS = /(^|\.)(zhimg\.com|zhihu\.com)$/i;

export function isZhihuImage(src: string): boolean {
  try {
    return ZHIHU_HOSTS.test(new URL(src).hostname);
  } catch {
    return false;
  }
}

/** 知乎 HTML: `<pre lang="x"><code>`, formula images carry `eeimg`, heading ids dropped. */
export function toZhihuHtml(json: TiptapJSON, script: Pick<SiteScript, 'urls'>): string {
  let html = convert(json).portableHtml;
  html = html.replace(/<pre><code class="language-([\w#+.-]+)">/g, '<pre lang="$1"><code>');
  html = html.replace(/<(h[1-6]) id="[^"]*"/g, '<$1');
  const eq = (script.urls.equation ?? '').split('{')[0];
  if (eq) {
    const escaped = eq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;');
    html = html.replace(new RegExp(`<img src="(${escaped})`, 'g'), '<img eeimg="1" src="$1');
  }
  return html;
}

/**
 * Pure 知乎 rendering (SPEC-r8 §3.0 / official guide §5): headings → h2 / h3, callouts → quote with 「提示：」,
 * dividers → `<hr>`, formulas → 知乎 formula images, task lists → ☐ / ☑, folds flattened, videos → links,
 * the leading h1 dropped (知乎 shows the title), title cut to the limit.
 */
export function renderZhihu(
  doc: Doc,
  common: CommonFormShape,
  script: Pick<SiteScript, 'urls' | 'limits'>,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang
): ZhihuRendered {
  const report: ReportItem[] = [];
  const rawTitle = (common.title || doc.title || '').trim();
  const titleMax = script.limits?.titleMax ?? 100;
  const cut = truncateText(rawTitle, titleMax);
  if (cut.truncated)
    report.push({
      kind: 'title.truncated',
      text: msg(lang).titleTruncated(titleMax),
      level: 'notice',
      samples: [rawTitle],
    });
  const equation = script.urls.equation ?? 'https://www.zhihu.com/equation?tex={tex}';
  const degraded = degradeTree(doc.json, {
    headings: { min: 2, max: 3 },
    dropTitleHeading: doc.title,
    callouts: { style: 'html' },
    math: { mode: 'image', url: (tex) => fillTemplate(equation, { tex }) },
    taskList: 'symbols',
    flattenDetails: true,
    videoLabel: '视频',
    ...(lang ? { lang } : {}),
  });
  report.push(...degraded.report);
  const images = convert(degraded.json).images.filter((src) => !isZhihuImage(src));
  return {
    title: cut.value,
    json: degraded.json,
    html: toZhihuHtml(degraded.json, script),
    images,
    report,
  };
}

/** After rehosting: the final HTML with 知乎 image URLs. */
export function withImages(
  rendered: ZhihuRendered,
  map: ReadonlyMap<string, string>,
  script: Pick<SiteScript, 'urls'>
): string {
  return map.size ? toZhihuHtml(rewriteImageSrcs(rendered.json, map), script) : rendered.html;
}
