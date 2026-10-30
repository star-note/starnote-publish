/**
 * 掘金发布时必填的分类、标签、摘要（SPEC-r15 §2）：用户没选时由辰记预填，写进掘金草稿，用户在掘金的发布弹窗里
 * 看到的已经是填好的，改不改由他。所有开源插件都不填这三项，这里是辰记比插件多做的一步。
 *
 * - 分类：8 个固定分类（后端 / 前端 / Android / iOS / 人工智能 / 开发工具 / 代码人生 / 阅读），按标题、标签、正文里的
 *   关键词打分，取最高的；都没命中时用「代码人生」。分类 id 从掘金的分类接口按名字取。
 * - 标签：先用笔记的标签，其次用分类名，在掘金标签库里搜，取第一个结果。默认只预填 1 个：新号（LV.2 以下）只能加
 *   1 个标签，多了掘金会拒绝；用户在表单里选了几个就用几个。
 * - 摘要：`juejinBrief`（50–100 字，掘金硬限制）。
 */

export const JUEJIN_CATEGORIES = [
  '后端',
  '前端',
  'Android',
  'iOS',
  '人工智能',
  '开发工具',
  '代码人生',
  '阅读',
] as const;
export type JuejinCategory = (typeof JUEJIN_CATEGORIES)[number];

const KEYWORDS: Record<Exclude<JuejinCategory, '代码人生'>, RegExp> = {
  后端: /后端|服务端|java\b|golang|\bgo\b|python|rust|数据库|mysql|postgres|redis|kafka|spring|微服务|分布式|fastapi|django|node\.?js/gi,
  前端: /前端|javascript|typescript|\bjs\b|\bts\b|react|vue|angular|css|html|浏览器|webpack|vite|小程序|tiptap|electron/gi,
  Android: /android|安卓|kotlin|jetpack/gi,
  iOS: /\bios\b|swift|swiftui|objective-?c|xcode/gi,
  人工智能:
    /人工智能|\bai\b|大模型|llm|gpt|claude|机器学习|深度学习|神经网络|agent|智能体|prompt|提示词|rag|mcp/gi,
  开发工具: /开发工具|\bgit\b|github|vscode|\bide\b|docker|命令行|效率工具|插件/gi,
  阅读: /读书|书评|阅读笔记|读后感/gi,
};

/** Pure: the 掘金 category that fits the text best (title and tags weigh 3× the body). */
export function guessJuejinCategory(input: {
  title?: string;
  tags?: string[];
  text?: string;
}): JuejinCategory {
  const head = `${input.title ?? ''} ${(input.tags ?? []).join(' ')}`;
  const body = (input.text ?? '').slice(0, 5000);
  let best: JuejinCategory = '代码人生';
  let bestScore = 0;
  for (const [name, re] of Object.entries(KEYWORDS) as Array<[JuejinCategory, RegExp]>) {
    const score = (head.match(re)?.length ?? 0) * 3 + (body.match(re)?.length ?? 0);
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

/** The keywords to search 掘金 tags with: the note's own tags first, then the category name. */
export function tagKeywords(tags: string[] | undefined, category: string): string[] {
  const out = (tags ?? []).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  if (category !== '代码人生' && !out.includes(category)) out.push(category);
  return out;
}
