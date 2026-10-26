/**
 * 「我们帮你做了什么」(SPEC-r8 §12.4): what an adapter changed or did on the user's behalf — images
 * rehosted, links turned into footnotes, a title truncated, only a draft saved… Hosts show these in the
 * publish summary; the API stores them on `platform_posts.report`.
 *
 * Known kinds are listed for autocompletion; adapters may report others (`string & {}`).
 */
export type ReportKind =
  | 'image.rehosted'
  | 'image.reused'
  | 'image.failed'
  | 'image.compressed'
  | 'link.footnoted'
  | 'link.stripped'
  | 'link.tracked'
  | 'title.truncated'
  | 'summary.generated'
  | 'summary.truncated'
  | 'tags.trimmed'
  | 'tags.mapped'
  | 'tags.generated'
  | 'block.degraded'
  | 'math.rasterized'
  | 'math.as-source'
  | 'table.rasterized'
  | 'code.rasterized'
  | 'video.linkified'
  | 'cover.cropped'
  | 'cover.generated'
  | 'canonical.set'
  | 'translated'
  | 'draft.only'
  | 'handoff.pending'
  | 'scheduled'
  | 'unchanged'
  | 'link.first_comment'
  | 'followup.posted'
  | 'followup.failed'
  | 'media.too_large'
  | 'media.format'
  | 'media.count'
  | 'media.size'
  | 'media.aspect'
  | 'media.duration'
  | (string & {});

export interface ReportItem {
  kind: ReportKind;
  /** One localized sentence, e.g. 「3 张图片已转存到仓库」. */
  text: string;
  count?: number;
  /**
   * `notice`: the user should know; `warn`: may affect how the post reads (or was fixed for the user, e.g. an image
   * compressed); `error`: the platform will refuse it, change it first (SPEC-r12 §3, `checkMedia`). Default `info`.
   */
  level?: 'info' | 'notice' | 'warn' | 'error';
  /** Up to 3 examples (a truncated title, a dropped link…). */
  samples?: string[];
  detail?: Record<string, unknown>;
}

/**
 * Merges report lists by `kind`: an item replaces an earlier one of the same kind (adapters report
 * running totals, so the last word wins), keeping the position where the kind first appeared.
 */
export function mergeReports(
  ...lists: ReadonlyArray<ReadonlyArray<ReportItem> | undefined>
): ReportItem[] {
  const byKind = new Map<string, ReportItem>();
  for (const list of lists) for (const item of list ?? []) byKind.set(item.kind, item);
  return [...byKind.values()];
}
