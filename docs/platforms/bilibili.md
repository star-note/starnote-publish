# B 站专栏 / 图文（bilibili）

调研日期：2026-10-29。资料来自公开资料和开源插件源码。登录后实测的内容记在「实测记录」，还没测的标「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://passport.bilibili.com/login`（扫码 / 手机号） |
| 新版图文（opus） | `https://member.bilibili.com/platform/upload/text` |
| 旧版专栏编辑器 | `https://member.bilibili.com/article-text/home?newEditor=-1` |
| 登录检测 | `GET https://api.bilibili.com/x/web-interface/nav`（看 `isLogin`） |
| logo | `packages/logos`：`bilibili.svg` |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | 未查到 |
| 专栏 / 图文的官方发布 API | **没有**。开放平台 `openhome.bilibili.com` 能确认的只有视频投稿（`client_id` / `access_token`）⚠️ |
| Webhook / RSS 导入 | 未查到 |

另外，社区文档 bilibili-API-collect 已在 2026-01 因法律投诉归档并删除，不能再依赖。

## 编辑器与正文格式

- **旧版专栏**：编辑器是 UEditor，接受 HTML。
- **新版图文**：草稿正文是结构化 JSON，不是 HTML。
  - 正文放在 `opus.content.paragraphs[]`，每段由 `para_type` 加 `text.nodes[]` 组成。
  - 要从 Tiptap 转过来，需要单独写一个渲染器。
- **图片**：必须先传到 B 站 CDN（`hdslb.com` / `biliimg.com`）。上传接口有两个：
  - `POST https://api.bilibili.com/x/article/creative/article/upcover`，参数 `binary` + `csrf`。
  - `POST https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs`，参数 `file_up`、`biz=new_dyn`、`category=daily`、`csrf`。
- **外链**：插件会把正文里的链接全部去掉（Wechatsync 的 `removeLinks`）。
- **代码块 / 表格 / 公式**：待实测。

## 发布字段

旧接口：`POST https://api.bilibili.com/x/article/creative/draft/addupdate`

| 字段 | 必填 | 接口字段 | 说明 |
|---|---|---|---|
| 标题 | 必填 | `title` | 页面建议 30 字以内，MultiPost 截到 40 字 |
| 正文 | 必填 | `content`、`words` | |
| 封面 | 选填 | `banner_url` | 先上传到 BFS 拿到地址；尺寸待实测 |
| 摘要 | 选填 | `summary` | |
| 标签 | 选填 | `tags` | 多个标签用逗号分隔 |
| 分类 | 选填 | `tid` / `category` | |
| 原创 / 转载 | 选填 | `original`、`reprint`（0 = 原创，1 = 转载） | |
| 文集 | 选填 | `list_id` | |
| 动态文案 | 选填 | `dynamic_intro` | |
| 剧透 | 选填 | `spoiler` | |
| 草稿 / 发布 | — | `save` | 含义待实测 |

新版图文：`POST /x/dynamic/feed/article/draft/add?csrf=&w_rid=&wts=`，主要字段如下：

- `arg.type=4`
- `template_id`、`category_id`
- `title`、`summary`
- `private_pub`：仅自己可见
- `reprint`、`original`、`list_id`
- `opus{ opus_source, title, content.paragraphs, pub_info.editor_version }`

评论开关、定时发布、AI 声明对应哪个字段：待实测。

## 发布规则

- **门槛**：等级不够不能发专栏。新号要先在手机上答题转正（易媒助手）。
- **频率**：新号往往每天只能发 1 篇专栏。⚠️ 官方数值未查到。
- **错误码 352**：新号、换网络或换设备时常见。处理办法是先手动发一篇专栏，通过验证，连续这样做 3–5 天。
- **审核与引流**：专栏专门的规则未查到。

## 风控与反爬

- **登录 cookie**：`SESSDATA`；`bili_jct` 同时也是 CSRF，作为表单字段 `csrf` 传；`buvid3`。
- **请求头**：`Origin` / `Referer` 是 `https://member.bilibili.com`。在桌面端页面内发请求时，这两个头天然就对。
- **签名**：
  - 旧接口 `addupdate` 在插件里不带签名。
  - 新版图文接口带 wbi 签名（`w_rid` + `wts`）。必须在页面内由页面自己的 JS 生成，辰记不复刻签名算法。
- **风控**：出现 352 或「需要验证之后再发布」时，交给用户在页面里处理。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | 辰记现状 |
|---|---|---|---|---|
| 标题 / 正文 / 图片转存 | ✔ | ✔ | 标题、正文 | 没有适配器 |
| 封面 | — | ✔ | — | — |
| 摘要 | — | ✔ | — | — |
| 标签 | — | ✔ | — | — |
| 分类 | 固定 `tid=4` | ✔ | — | — |
| 原创 / 转载 | — | ✔ | — | — |
| 发布方式 | 只存草稿 | 存草稿 | 点「存草稿」 | — |

## 辰记要做到的

- **表单字段**：标题、正文（图片转存、去外链）、封面、摘要、标签、分类、原创 / 转载、文集、动态文案、仅自己可见。
- **编辑器优先级**：优先支持新版图文编辑器，旧专栏编辑器作为备用。
- **发布方式**：默认交接到发布台，由用户自己点发布。
- **新号提醒**：新号先提示「需要答题转正」和「每天大约只能发 1 篇」。

## 待实测

- [ ] 新版图文编辑器现在是否是默认入口；旧专栏编辑器是否还能用
- [ ] 标题和摘要的字数上限、封面尺寸
- [ ] 评论开关、定时发布、AI 声明对应的字段
- [ ] `save` 的含义
- [ ] 分类列表从哪个接口取

## 实测记录

（登录后补充）

## 来源

- Wechatsync v2：https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/bilibili.ts
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/article/bilibili.ts
- COSE：https://github.com/doocs/cose
- 新版图文抓包笔记（Bilibili-Gate）：https://github.com/magicdawn/Bilibili-Gate/blob/main/src/modules/bilibili/me/article-draft/api/_note.md
- 易媒助手帮助中心：https://www.yimeizhushou.com/help.html
