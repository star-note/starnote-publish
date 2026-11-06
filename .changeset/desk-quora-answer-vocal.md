---
'@starnote/publish-desk-generic': minor
'@starnote/publish-core': minor
'@starnote/platform-logos': patch
---

Quora 改成「提问加回答」：标题当作问题（没有问号就补上），发布台用它打开 Quora 搜索页（站点脚本 `flags.writeQuery`），用户进到问题页后（`urls.fillOn`）点 Answer 填好回答。发帖子拆成单独的发布对象「Quora 帖子」（`quora-post`，和 Quora 共用登录）。Vocal 加入发布台：自动填好标题、副标题（摘要，`selectors.subtitle`）和正文。预填新增 `summary`。
