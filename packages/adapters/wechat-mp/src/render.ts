import { convertWechat, escapeHtml, mediaReport, truncateText } from '@starnote/publish-core';

import { msg } from './i18n';

import type {
  CommonFormShape,
  Doc,
  ReportItem,
  SiteScript,
  WechatOptions,
} from '@starnote/publish-core';

export interface WechatMpRendered {
  title: string;
  digest: string;
  html: string;
  /** Absolute image URLs that must be uploaded to WeChat (公众号 does not show outside images). */
  images: string[];
  report: ReportItem[];
}

const WX_HOSTS = /(^|\.)(qpic\.cn|qlogo\.cn|weixin\.qq\.com)$/i;

export function isWechatImage(src: string): boolean {
  try {
    return WX_HOSTS.test(new URL(src).hostname);
  } catch {
    return false;
  }
}

/**
 * Pure: the 公众号 HTML from the SDK's `convertWechat` (inline styles, external links → 「文字[n]」 + 参考链接),
 * title / digest cut to the limits.
 */
export function renderWechatMp(
  doc: Doc,
  common: CommonFormShape,
  script: Pick<SiteScript, 'limits'>,
  opts: WechatOptions = {}
): WechatMpRendered {
  const report: ReportItem[] = [];
  const lang = opts.lang;
  const t = msg(lang);
  // SPEC-r12 §3: what the platform will not take (or will change) about the cover / images / video
  report.push(...mediaReport('wechat', '公众号', undefined, common, lang));
  const titleMax = script.limits?.titleMax ?? 64;
  const rawTitle = (common.title || doc.title || '').trim();
  const title = truncateText(rawTitle, titleMax);
  if (title.truncated)
    report.push({
      kind: 'title.truncated',
      text: t.titleTruncated(titleMax),
      level: 'notice',
      samples: [rawTitle],
    });
  const digestMax = script.limits?.summaryMax ?? 120;
  const digest = truncateText(
    (common.summary || doc.summary || '').replace(/\s+/g, ' ').trim(),
    digestMax
  );
  if (digest.truncated)
    report.push({
      kind: 'summary.truncated',
      text: t.digestTruncated(digestMax),
      level: 'info',
    });
  const converted = convertWechat(doc.json, opts);
  if (converted.links.length)
    report.push({
      kind: 'link.footnoted',
      text: t.linksFootnoted(converted.links.length),
      count: converted.links.length,
      level: 'info',
    });
  return {
    title: title.value,
    digest: digest.value,
    html: converted.html,
    images: converted.images.filter((src) => !isWechatImage(src)),
    report,
  };
}

/** Replaces image `src`s in the HTML (attribute values are HTML-escaped by the converter). */
export function replaceImageSrcs(html: string, map: ReadonlyMap<string, string>): string {
  let out = html;
  for (const [from, to] of map) {
    out = out.split(`src="${escapeHtml(from)}"`).join(`src="${escapeHtml(to)}"`);
    if (escapeHtml(from) !== from) out = out.split(`src="${from}"`).join(`src="${escapeHtml(to)}"`);
  }
  return out;
}
