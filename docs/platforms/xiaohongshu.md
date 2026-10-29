# 小红书（xiaohongshu）

调研日期：2026-10-29。资料来自公开资料和开源工具源码。登录后实测的结果记在「实测记录」，还没测的写「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://creator.xiaohongshu.com/`（扫码或手机验证码；可以用手机 App 里的账号） |
| 上传图文 | 创作服务平台 →「发布笔记」→「上传图文」 |
| 写长文 | `https://creator.xiaohongshu.com/publish/publish?from=menu&target=article` |
| logo | `packages/logos`：`xiaohongshu.svg` |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | 没有官方的。`xpzouying/xiaohongshu-mcp` 是第三方实现，用无头浏览器操作网页 |
| 个人作者发布 API | **没有**。开放平台主要面向品牌方和广告主，要求企业认证 ⚠️ |
| Webhook / RSS 导入 | 未查到 |

## 编辑器与正文格式

- **图文笔记**：图片加一段短正文。正文框是 `div[role="textbox"][contenteditable]`（tiptap）。
- **长文笔记**：ProseMirror 编辑器，最多 10000 字。Wechatsync 往里写的是 ProseMirror JSON。
- **正文格式**：不接受 Markdown，只能用 HTML 或 ProseMirror JSON。
- **图片上传**：必须传到小红书。流程是先 `GET /api/media/v1/upload/web/permit` 取 `file_id` 和 `token`，再 `PUT ros-upload.xiaohongshu.com/{file_id}`。
- **代码块、表格、公式**：待实测。小红书本来就不适合这类内容，辰记做转换时应该把它们改成图片或纯文字。

## 发布字段（图文笔记）

| 字段 | 必填 | 说明 |
|---|---|---|
| 标题 | 必填 | **20 字**（页面会实时提示）。长文标题 64 字 ⚠️ |
| 正文 | 必填 | **1000 字**。长文 10000 字 |
| 图片 | 至少 1 张 | 最多 18 张 ⚠️。第一张就是封面 |
| 话题 | 选填 | **最多 10 个**。输入 `#话题名` 后，从联想列表里点选 |
| @用户 | 选填 | 内部字段 `ats` |
| 定时发布 | 选填 | 只能定在 **1 小时到 14 天之内** |
| 可见范围 | 选填 | 公开（默认）/ 仅自己可见 / 仅互关好友可见 |
| 原创声明 | 选填 | 打开开关后，要勾选「原创声明须知」再点「声明原创」 |
| 商品 | 选填 | 账号要先开通商品功能 |
| 地点 | 选填 | 内部字段 `post_loc`，怎么选地点待实测 |
| 内容类型声明 / 评论设置 / 合集 | — | 待实测 |

内部发布接口 `POST edith.xiaohongshu.com/web_api/sns/v2/note` 需要 `x-s` 签名，**辰记不调用这个接口**（理由见下文）。

## 发布规则

- **每日篇数**：官方没有公布。有人凭经验说一天 50 篇左右 ⚠️。发得太频繁会触发 `RATE_LIMIT`。
- **审核**：发布后先是「审核中」。
- **导流**：带网址、联系方式、二维码、售卖话术的笔记不会被推荐。导流违规会按次数升级处罚：先警告，再限流加禁言 ⚠️。
- **重点监测**：虚构体验、夸大其词、搬运、诱导、导流、拉踩。
- **限流**：一般不会通知。

## 风控与反爬

这是风控最严的一家。

- **cookie**：`a1` 用于签名，`web_session` 是登录态。
- **请求签名**：`x-s`、`x-t`、`x-s-common`，算法没有公开。**辰记不复刻签名，也不在页面外调这些接口。**
- **验证与封禁**：
  - 返回 461 / 471 时，响应头会带 `Verifytype`，需要用户自己完成验证。
  - 还会按 IP 限流。
- **单端登录**：同一账号不能同时在多个网页端登录，另一端登录会把这边踢下线。所以桌面端发布台会和用户自己浏览器里的登录互相顶掉，界面上要提示这一点。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | xiaohongshu-mcp | 辰记现状 |
|---|---|---|---|---|---|
| 标题 / 正文 | 长文（私有适配器） | ✔ | ✔（长文） | ✔ | 没有适配器 |
| 图片 | ✔ | ✔ | — | ✔ | — |
| 话题 | — | 把 `#tag#` 当文字加在正文末尾 | — | ✔（从联想列表点选） | — |
| 定时发布 / 可见范围 / 原创 / 商品 | — | — | — | ✔ | — |
| 发布方式 | 存草稿 | 可以自动点发布 | 存草稿 | 可以发布 | — |

## 辰记要做到的

**只用页面操作（DOM）的发布台。** 辰记不调签名接口，用户登录后，由辰记在页面里把这些都填好：

- 图片：笔记里的图片，或用辰记卡片版式生成的图片，最多 18 张。
- 标题：20 字以内，超出要提示。
- 正文：1000 字以内。
- 话题：从联想列表点选，不是把 `#话题#` 当文字写进正文。
- 定时发布、可见范围、原创声明、地点。

最后由用户自己点「发布」。

长文笔记另外做一个入口。

## 待实测

- [ ] 图片张数上限
- [ ] 长文的标题和正文字数上限
- [ ] 地点怎么选
- [ ] 评论设置、内容类型声明
- [ ] 桌面端登录会不会把用户浏览器里的登录踢下线

## 实测记录

（登录后补充）

## 来源

- xiaohongshu-mcp：https://github.com/xpzouying/xiaohongshu-mcp（`xiaohongshu/publish.go`）
- ReaJason/xhs：https://github.com/ReaJason/xhs（`xhs/core.py`）
- xiaohongshu-cli：https://pkg.go.dev/github.com/tamnd/xiaohongshu-cli
- Wechatsync CHANGELOG：https://github.com/wechatsync/Wechatsync/blob/v2/CHANGELOG.md
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/dynamic/rednote.ts
- COSE：https://github.com/doocs/cose/blob/main/packages/core/src/platforms/xiaohongshu.js
