---
'@starnote/publish-juejin': patch
---

掘金草稿不再替用户猜分类：只用表单里选的分类、标签；没选分类时草稿里留空，报告提醒在掘金的发布弹窗里选（`category.missing`）。标签没选时只用笔记自己的标签在掘金标签库里找同名的，找不到就留空并提醒（`tags.missing`）。去掉 `guessJuejinCategory`。
