# CSDN（csdn，适配器 `@starnote/publish-csdn`）

调研日期：2026-10-29。资料来自公开资料和开源插件源码。登录后实测的结果记在「实测记录」，还没测的项写「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://passport.csdn.net/login`（扫码 / 手机验证码 / 密码 / 第三方） |
| Markdown 编辑器 | `https://editor.csdn.net/md/` |
| 富文本编辑器 | `https://mp.csdn.net/mp_blog/creation/editor`（CKEditor） |
| 创作中心 | `https://mp.csdn.net/` |
| 登录检测 | `GET https://bizapi.csdn.net/blog-console-api/v3/editor/getBaseInfo`（要签名，见下文）。站点脚本里写的是旧接口 `me.csdn.net/api/user/show`，待实测 |
| logo | `packages/logos`：`csdn.svg` |

## 官方开放能力

MCP、发布 API、Webhook、RSS 导入都没有。`bizapi.csdn.net` 是编辑器内部用的接口，不对外开放。

## 编辑器与正文格式

- Markdown 编辑器：保存时同时提交 `markdowncontent` 和 `content`（HTML）。
- 富文本编辑器：CKEditor Classic，只能通过 `setData()` 写入内容；直接改 DOM 的话，保存后内容是空的。
- 图片要转存到 CSDN 的华为云 OBS：
  1. 先取签名：`POST bizapi.csdn.net/resource-api/v1/image/direct/upload/signature`。站点脚本用的是 `imgservice.csdn.net` 的上传策略。
  2. 再用 multipart 上传到 OBS。
- 代码块、表格：Markdown 原生支持。公式待实测。

## 发布字段

接口：`POST https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle`（MultiPost 用的是 `v1/postedit/saveArticle`）。

| 字段 | 必填 | 接口字段 | 限制 | 辰记现状 |
|---|---|---|---|---|
| 标题 | 必填 | `title` | 5–100 字 | ✔ |
| 正文 | 必填 | `markdowncontent` + `content` | | ✔ |
| 摘要 | 选填 | `description` | MultiPost 截到 256 字 | 待核对 |
| 标签 | **发布必填** | `tags`（逗号分隔） | 站点脚本上限 5 个；MultiPost 没填时默认「经验分享」 | 待核对 |
| 分类专栏 | 选填 | `categories` | | 待核对 |
| 文章类型 | 必填 | `type`：`original` / `repost` / 翻译（⚠️ 翻译的取值待实测） | | 待核对 |
| 转载来源 | 转载时必填 | `original_link` | | 待核对 |
| 可见范围 | 选填 | `readType`：`public`，其他取值（私密 / 粉丝 / VIP）待实测 | | 待核对 |
| 封面 | 选填 | `cover_images[]`、`cover_type` | 比例待实测 | 待核对 |
| 定时发布 | 选填 | `scheduled_time`（秒级时间戳） | | 待核对 |
| 创作活动 | 选填 | `creator_activity_id` | | — |
| 状态 | — | `status`、`pubStatus:"draft"` | | — |

辰记的 CSDN 适配器把字段映射写在 `render.ts` / `electron.ts` 里，站点脚本里没有。上表「待核对」各行，下一步对照代码补上。

## 发布规则

- 每日篇数说法互相矛盾，**不要写死**，以发布时页面实际提示为准：
  - 旧资料：普通用户 10 篇，VIP 20 篇。
  - 2026 年文章：非会员每天最多 3 篇。⚠️
- 发布后要审核。

## 风控与反爬

- 登录态 cookie：`UserToken`（站点脚本用它判断是否登录成功）、`dc_session_id`、`p_uid`、`uuid_tt_dd`。
- **`bizapi` 是 API 网关签名**：请求头要带 `x-ca-key`、`x-ca-nonce`、`x-ca-signature`（HMAC-SHA256）、`x-ca-signature-headers`。
  - key 和 secret 是 CSDN 前端 JS 里的公开常量。
  - **辰记不复刻签名**：在 `editor.csdn.net` 页面里发请求，让页面自己的请求封装加签。
  - 如果现在的适配器是用 `session.fetch` 直接发的，要实测是否会被拒。
- `Origin` / `Referer` 必须是 `https://editor.csdn.net`。
- 有无头浏览器检测：无头浏览器打开编辑页会被跳转到倒计时页。桌面端用的是正常窗口，不受影响。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | 辰记现状 |
|---|---|---|---|---|
| 标题 / 正文 / 图片转存 | ✔ | ✔ | ✔（Markdown） | ✔ |
| 摘要 / 标签 / 分类专栏 | 空 | ✔ | — | 待核对 |
| 原创 / 转载 | 固定 original | ✔ | — | 待核对 |
| 封面 / 定时 | — | ✔ | — | 待核对 |
| 可见范围 | 固定 public | 固定 public | — | 待核对 |
| 发布方式 | 草稿 | 建好后跳到编辑页 | 填好表单 | 发布台（填好内容，由用户点发布） |

MultiPost 是 CSDN 上填得最全的插件，辰记至少要和它一样。

## 辰记要补的

- 表单字段：
  - 标签（必填，最多 5 个）
  - 分类专栏（列出用户已有的专栏）
  - 文章类型：原创 / 转载 / 翻译；选转载时要填原文链接
  - 可见范围
  - 封面
  - 摘要
  - 定时发布
  - 创作活动
- 遇到「发文上限」提示时，原样显示给用户。

## 待实测

- [ ] 每日篇数上限
- [ ] 标签上限
- [ ] `readType` 的取值
- [ ] 封面比例
- [ ] `session.fetch` 不加签直接调 `saveArticle` 会不会被拒
- [ ] 登录检测用哪个接口

## 实测记录

（登录后补充）

## 来源

- Wechatsync v2：https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/csdn.ts
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/article/csdn.ts
- COSE：https://github.com/doocs/cose/blob/main/packages/core/src/platforms/csdn.js
- 第三方文章：
  - https://juejin.cn/post/7666771393114062894
  - https://blog.csdn.net/2401_88405924/article/details/144624935
