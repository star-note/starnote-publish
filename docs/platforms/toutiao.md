# 头条号（toutiao）

- 调研日期：2026-10-29。
- 来源：
  - 公开资料与开源插件源码，见文末。
  - 登录后实测的部分在「实测记录」一节，还没测的写「待实测」。
- 标记约定：
  - ⚠️ 表示只有第三方说法，或几个来源互相矛盾。
  - 「未查到」表示没有找到来源。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://mp.toutiao.com/`，可扫码或用手机号登录（头条 / 抖音账号） |
| 写文章 | `https://mp.toutiao.com/profile_v4/graphic/publish`（旧版 `profile_v3`） |
| 创作者后台 | `https://mp.toutiao.com/profile_v4/index` |
| 登录检测 | `GET https://mp.toutiao.com/mp/agw/media/get_media_info` |
| logo | `packages/logos`：`toutiao-64.png` / `toutiao-128.png` |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | 未查到 |
| 个人作者可用的发文 API / Token | **没有**。抖音开放平台的发布能力只对应抖音作品，不覆盖头条号文章。文档是单页应用，读不到正文，⚠️ 待确认 |
| Webhook / OAuth / RSS 导入 | 未查到 |

结论：只能走「登录态 + 桌面端发布台」路线。

## 编辑器与正文格式

- **编辑器**：ProseMirror 富文本，接受 HTML。MultiPost 用 `paste` 事件注入 `text/html`；COSE 用 `execCommand('insertHTML')`。
- **图片**：
  - 必须转存。正文里的图片结构是 `<div class="pgc-img"><img ... web_uri img_width img_height><p class="pgc-img-caption"></p></div>`（code-box）。
  - 新版上传接口：`POST https://mp.toutiao.com/spice/image?upload_source=20020002&aid=1231&device_platform=web`。
  - 旧版上传接口：`/mp/agw/article_material/photo/upload_picture?type=ueditor`；按 URL 转存走 `/tools/catch_picture/`。
- **链接 / iframe**：插件统一删除 `<a>`（保留文字）、`iframe`、SVG 和音乐卡片，说明平台对外链不友好。
- **代码块 / 表格 / 公式 / 视频**：官方说明未查到，待实测。

## 发布字段

发文接口：`POST https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231`，需要 `msToken` / `a_bogus`，见下文「风控与反爬」。

| 字段 | 必填 | 接口字段 | 说明 |
|---|---|---|---|
| 标题 | 必填 | `title` | 2–30 字，见页面占位符 |
| 正文 | 必填 | `content` | HTML；字数上限未查到 |
| 封面 | 选填 | `pgc_feed_covers`（`url` / `uri` / `thumb_width` / `thumb_height`），`draft_form_data.coverType` | 可选单图、三图或无封面；`coverType` 各取值的含义 ⚠️ 待实测 |
| 摘要 | 选填 | `search_creation_info.abstract` | |
| 投放广告 | 选填 | `article_ad_type` | 旧驱动传 2，code-box 传 3，含义 ⚠️ 待实测；第三方说不打开就没有收益 |
| 头条首发 / 独家 | 选填 | `claim_exclusive`（⚠️ 推断） | 页面上有「头条首发」复选框 |
| 声明原创 | 选填 | 待实测 | 第三方说原创要求正文 300 字以上 |
| 作品声明（个人观点、引用 AI 等） | 选填 | 待实测 | |
| 定时发布 | 选填 | `timer_status` + `timer_time` | |
| 粉丝可见 / 赞赏 | 选填 | `is_fans_article`、`praise`、`disable_praise` | |
| 草稿 / 发布 | — | `save` | code-box 注释说 `save:'0'` 是存草稿，⚠️ 与常理相反，待实测 |

固定参数：`pgc_id:0`、`source:29`、`extra`（含 `content_source`、`content_word_cnt`、`gd_ext`）、`mp_editor_stat:'{}'`、`is_refute_rumor`、`activity_tag`、`trends_writing_tag`。

## 发布规则

- **每日篇数**：官方未查到。第三方转述 2021 年规则：⚠️
  - 文章、问答每天 5 篇；微头条每天 10 条；超出部分只推荐给粉丝。
  - 各体裁合计超过 50 篇后，当天不能再发。
- **新手期**：第三方说 2018 年起已取消。⚠️
- **审核、外链、违规后果**：未查到官方原文。插件都会删外链，辰记默认也要删，或者把链接改成纯文字。

## 风控与反爬

- **登录态**：
  - 网页会话 cookie 常见的有 `sessionid`、`ttwid`、`msToken`，⚠️ 待实测。
- **CSRF**：
  1. 请求 `HEAD https://mp.toutiao.com/ttwid/check/`，带上 `x-secsdk-csrf-request:1` 和 `x-secsdk-csrf-version:1.2.22`。
  2. 从响应头 `x-ware-csrf-token` 取出令牌，放进请求头 `x-secsdk-csrf-token`。
  3. 另外还有 `GET /tt-anti-token`。
- **签名**：发文接口要带 `a_bogus` / `msToken`。这两个值由页面里的 JS 在请求时自动注入，在页面外自己发的请求不会带上。
  - 插件的做法：在页面主世界里调用 `fetch`。
  - 辰记桌面端的对应做法：在平台页面内执行请求（`webContents` 主世界），不能用 `session.fetch` 直接发。
  - **不实现、也不复刻签名算法。**
- **验证码 / 频率限制**：触发条件未查到。出现字节的验证中心页面（`verify.snssdk.com` 等）时，交给用户自己处理。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | code-box | 辰记现状 |
|---|---|---|---|---|---|
| 标题 | ✔ | ✔（≤30） | ✔ | ✔ | 没有适配器 |
| 正文 HTML + 图片转存 | ✔ | ✔ | 只按行拆成纯文本 | ✔ | — |
| 封面 | ✔（旧驱动） | ✔（走页面上传） | — | 关闭 | — |
| 摘要 | — | — | — | ✔ | — |
| 广告 / 首发 / 定时 | 固定值 | — | — | 字段在，值固定 | — |
| 发布方式 | 草稿 | 可自动点发布 | 填表 | 草稿 | — |

## 辰记要做到的

不能比插件差，以下都要能填：
- 标题，自动截到 30 字。
- 正文：HTML 转成头条图片结构，图片转存，外链改成纯文字。
- 封面：单图 / 三图 / 无封面。
- 摘要。
- 投放广告、头条首发、声明原创、作品声明（含「引用 AI」）、定时发布。

这些都放进表单。默认走发布台：填好内容，由用户自己点「发布」。

## 待实测

- [ ] `coverType` 的取值。
- [ ] `article_ad_type` 和 `claim_exclusive` 的含义。
- [ ] `save` 的语义。
- [ ] 作品声明、原创声明对应的接口字段。
- [ ] 登录用的 cookie 名。
- [ ] 正文对代码块、表格的支持。
- [ ] 每日篇数限制在页面上怎么提示。

## 实测记录

（登录后补充）

## 来源

- Wechatsync：
  - 旧驱动：https://github.com/wechatsync/Wechatsync/blob/old/packages/@wechatsync/drivers/src/toutiao.js
  - v2 content script：https://github.com/wechatsync/Wechatsync/blob/v2/packages/extension/src/content/toutiao.ts
  - v2 适配器在私有子模块里，读不到。
- code-box：https://github.com/027xiguapi/code-box/blob/main/sync/adapters/platforms/toutiao.ts
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/article/toutiao.ts
- COSE：https://github.com/doocs/cose/blob/main/packages/core/src/platforms/toutiao.js
- 易媒助手帮助中心：https://www.yimeizhushou.com/help.html
