# 语雀（yuque）

调研日期：2026-10-29。来源包括公开资料、官方 MCP 仓库和开源插件源码。登录后实测的结果记在「实测记录」，还没测的标「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://www.yuque.com/login`（手机号、支付宝、钉钉） |
| 个人 Token | `https://www.yuque.com/settings/tokens` |
| 工作台 | `https://www.yuque.com/dashboard` |
| 登录检测（网页接口） | `GET https://www.yuque.com/api/mine/common_used` |
| logo | `packages/logos`：`yuque-64.png` / `yuque-128.png` |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | **有，官方出品**：`yuque/yuque-mcp-server`，npm 包名 `yuque-mcp`，2026-02 创建。提供 19 个工具，覆盖用户、搜索、知识库、文档（增删改查）、目录、小记、画板 |
| OpenAPI | **有**：`https://www.yuque.com/api/v2`，请求头 `X-Auth-Token` |
| 个人 Token 门槛 | 多个来源说**需要超级会员**（团队 Token 需要旗舰版空间）⚠️。官方原文没读到，待实测 |
| Webhook / RSS 导入 | 未查到 |

官方 MCP 的文档能力：
- 正文 `format` 支持 `markdown`、`lake`、`html` 三种。
- `create_doc` 的参数有 `title`、`slug`、`body`、`format`、`public`（0 是私密，1 是公开）。
- 不支持评论、附件上传、成员权限管理。
- Markdown 正文要单独更新，不能和 `title`、`slug`、`public` 在同一次请求里一起改。

## 编辑器与正文格式

- 语雀的原生格式是 Lake，一种 HTML 方言。官方 API 同时接受 Markdown、Lake 和 HTML。
- 网页接口 `POST /api/docs/convert`（`from: markdown`、`to: lake`）可以把 Markdown 转成 Lake。
- 图片：
  - 上传接口是 `POST /api/upload/attach?attachable_type=Doc&attachable_id={docId}&type=image`，返回 `cdn.nlark.com` 上的地址。
  - 用官方 API 时，外链图片会不会被拦：待实测。
- 代码块：Wechatsync 会做专门处理。表格、公式：待实测。语雀本身都支持，问题在 Markdown 转换时会不会丢。

## 发布字段

| 字段 | 必填 | 说明 |
|---|---|---|
| 标题 | 必填 | 字数上限待实测 |
| 正文 + 格式 | 必填 | `markdown` / `lake` / `html` |
| 知识库 | 必填 | `book_id` 或 namespace，文档必须放在某个知识库里 |
| slug | 选填 | 文档的 URL 路径 |
| 公开 / 私密 | 选填 | `public`：0 是私密，1 是公开（第三方说 2 是企业内公开 ⚠️） |
| 目录位置 | 选填 | 用目录（TOC）接口调整 |

摘要、封面、标签、原创声明、定时发布：语雀文档没有这些概念。

## 发布规则

- 官方没有公开每日篇数、审核、外链方面的规则。第三方转述官方的说法是：短时间内大量发文可能被限制。⚠️
- 服务条款页 `/about/terms` 返回 404。

## 风控与反爬

- 官方 API 只靠 Token 鉴权，不需要签名。限流数值和 User-Agent 要求待实测。
- 网页接口（插件的做法）：
  - 把 cookie `yuque_ctoken` 的值放进请求头 `x-csrf-token`。
  - `Origin` / `Referer` 设为 `https://www.yuque.com/dashboard`。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | 辰记现状 |
|---|---|---|---|---|
| 标题 / 正文 / 图片转存 | ✔（Markdown 转 Lake） | 不支持 | 不支持 | 没有适配器 |
| 知识库 | 固定用「最近使用」的第一个 | — | — | — |
| 公开 / 私密 | — | — | — | — |
| 发布方式 | 草稿 | — | — | — |

## 辰记要做到的

接入方式分两档：
- **首选官方 API**：用户自己填个人 Token。可以和 DEV、Hashnode 一样，走辰记 API 转发，也可以在桌面端本机直接发。
- **没有会员时**：退回桌面端登录态，按 Wechatsync 的网页接口方式发。

表单要能填：
- 知识库（下拉选择，不能像 Wechatsync 那样写死）
- 目录位置
- slug
- 公开 / 私密
- 正文格式：默认 Markdown，表格多时用 HTML

## 待实测

- [ ] 普通账号能不能在 `/settings/tokens` 创建 Token
- [ ] 官方 API 的限流数值
- [ ] 外链图片会不会自动转存
- [ ] 标题字数上限

## 实测记录

（登录后补充）

## 来源

- 官方 MCP：https://github.com/yuque/yuque-mcp-server
- Wechatsync v2：https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/yuque.ts
- 第三方说明 ⚠️：
  - https://www.publishport.app/zh/blog/yuque-auto-publish/
  - https://help.aliyun.com/zh/model-studio/connector/yuque
