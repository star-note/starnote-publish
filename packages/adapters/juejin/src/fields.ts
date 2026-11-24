/**
 * 掘金发布时的分类、标签、摘要（SPEC-r15 §2）。分类、标签是用户的选择，辰记不替用户猜（2026-11-09：「分类等不要随便猜」）：
 *
 * - 分类：只用辰记表单里选的；没选时草稿里留空，报告提醒在掘金的发布弹窗里选。
 * - 标签：表单选的；没选时只用笔记自己的标签，在掘金标签库里找同名的（大小写、空白不计），找不到就留空。只预填 1 个：
 *   新号（LV.2 以下）只能加 1 个标签，多了掘金会拒绝；用户在表单里选了几个就用几个。
 * - 摘要：`juejinBrief`（50–100 字，掘金硬限制），从正文取。
 */

/** The note's own tags, as keywords to look up in 掘金's tag library (`#` and blanks dropped). */
export function tagKeywords(tags: string[] | undefined): string[] {
  return (tags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
}

/** Pure: is the 掘金 tag the same as the note's tag (case and whitespace ignored)? */
export function sameTag(name: string, keyword: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  return !!name && norm(name) === norm(keyword);
}
