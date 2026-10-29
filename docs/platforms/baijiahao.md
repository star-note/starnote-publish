# 百家号（baijiahao）

调研日期：2026-10-29。资料来自公开资料和开源插件源码；登录后实测的内容记在文末「实测记录」，还没测的写「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://baijiahao.baidu.com/`（百度账号，个人注册后需审核） |
| 写图文 | `https://baijiahao.baidu.com/builder/rc/edit?type=news` |
| 登录检测 | `GET https://baijiahao.baidu.com/builder/app/appinfo` |
| 编辑令牌 | 编辑页 `window.__BJH__INIT__AUTH__`，或 `localStorage['edit-token']`，作为请求头 `token` |
| logo | `packages/logos`：`baijiahao-64.png` / `baijiahao-128.png` |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | 未查到 |
| 官方发文 API | **有，个人作者可用**：「内容开放接口」，用 `app_id`（作者账号 ID）+ `app_token` 调用，不走 OAuth。前提是同意开发者规范、以自己名义开发、账号状态正常。申请入口的具体页面待实测 |
| Webhook / RSS 导入 | 未查到 |

官方接口（基址 `http://baijiahao.baidu.com`）：

| 能力 | 路径 |
|---|---|
| 发图文 | `/builderinner/open/resource/article/publish` |
| 发图集 | `/builderinner/open/resource/article/gallery` |
| 撤回 | `/builderinner/open/resource/article/withdraw` |
| 修改 | `/builderinner/open/resource/article/republish` |

**图文参数**
- `title`：必填，8–40 字。
- `content`：必填，富文本，不超过 20000 字。
- `origin_url`：必填，原文链接。
- `cover_images`：0–3 张，每张至少 218×146。不传封面时文章进草稿。
- `is_original`：1 表示原创，0 表示非原创。
- 官方接口**没有**摘要、标签、定时、分类这几个参数。

**错误码**
- `60001009`：今日可发篇数为 0。
- `60001008`：日发文数检查失败。
- `60000005`：账号未通过审核，或在禁言期。

**注意**
- 同一篇文章不能重复提交。
- 接口不得提供给其他产品使用。⚠️ 辰记作为第三方工具替用户调用是否合规，需要读原文确认；目前的思路是「用户自己申请 Token、填进辰记」。
- 第三方反馈：接口返回成功，后台却看不到文章。⚠️

## 编辑器与正文格式

- 标题是 contenteditable；正文是 UEditor，部分版本放在 iframe 里，接受 HTML。
- 图片必须转存到百度的域名下，以下域名不用转存：`baijiahao.baidu.com`、`bdstatic.com`、`bcebos.com`。
  - 上传接口：`POST /pcui/picture/uploadproxy`，参数 `media` / `type=image` / `save_material=1` / `article_type=news`。
  - 备用接口：`/materialui/picture/uploadProxy`。
- 代码块、表格、公式：未查到，待实测。

## 发布字段（网页端 `POST /pcui/article/save?callback=bjhdraft`）

| 字段 | 必填 | 接口字段 | 说明 |
|---|---|---|---|
| 标题 | 必填 | `title` | 官方接口要求 8–40 字；MultiPost 截到 64 字。⚠️ 两者冲突，待实测 |
| 正文 | 必填 | `content`、`len`（字数） | `type=news` |
| 封面 | 选填 | `cover_layout`（`one` 是单图，三图的值待实测）、`cover_images`、`vertical_cover`、`_cover_images_map`、`cover_source`、`is_auto_optimize_cover` | 先上传原图，再调 `/pcui/Picture/CuttingPicproxy` 裁出横版 1.5 和竖版 0.75 两种比例 |
| 摘要 | 选填 | `abstract`、`abstract_from` | |
| 副标题 | 选填 | `subtitle` | |
| 话题 | 选填 | `bjhtopic_id` / `bjhtopic_info` | 插件都留空 |
| 原创声明 | 选填 | `original_status` | 账号要有「图文原创」权限，否则报「声明原创失败」 |
| 首发 / 独家 | 选填 | `first_exclusive_publish_v2` | MultiPost 传 3，含义待实测 |
| 允许转载 | 选填 | `source_reprinted_allow` | |
| 功能开关 | 选填 | `activity_list`：`ttv`、`ai_tts`、`reward`、`aigc_bjh_status` | `aigc_bjh_status` ⚠️ 推测是 AI 生成声明 |
| 排版美化 | 选填 | `isBeautify`、`usingImgFilter` | |
| 定时发布 | 选填 | 待实测 | 易媒助手提到「定时发布后封面错位」，说明有这个功能 |

## 发布规则（官方手册）

**发文篇数**
- 新手期每天 5 篇，图文、图集、视频合计。审核没通过的也占名额。
- 获得原创标签后，每天 10 篇。

**转正**
- 条件：注册满 7 天，百家号指数 ≥ 500，信用分 100。
- 申请被拒后，第 1 次要等 15 天才能再申请，第 2 次要等 30 天，第 3 次起不能再主动申请。

**图文原创**
- 申请条件：已转正、已实名，质量分 ≥ 500，原创分 ≥ 800，近 30 天有 ≥ 10 篇原创图文获推荐，粉丝 ≥ 30。
- 滥用的后果：第一次被认定非原创，永久取消原创功能；第二次，封号。

**外链与引流**
- 禁止放带营销意图的公众号、二维码、电商链接、第三方网址。
- 辰记默认去掉外链，并提示用户。

**信用分**
- 初始 100 分，扣到 0 封停。
- 一次扣 50 分，同时禁言 5 天。
- 之后 7 天没有新违规的话，每天恢复 1 分。

## 风控与反爬

- 登录态：百度 cookie，常见是 `BDUSS` / `STOKEN`，⚠️ 待实测。
- 鉴权：请求头 `token`，并带 `Origin` / `Referer: https://baijiahao.baidu.com`。在桌面端页面内发请求，这两个头本来就对。
- 签名、验证码、频率限制：未查到。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | 辰记现状 |
|---|---|---|---|---|
| 标题 / 正文 / 图片转存 | ✔ | ✔ | 标题、正文 | 没有适配器 |
| 封面 | — | ✔（单图，横竖两种裁剪） | — | — |
| 摘要 | — | ✔ | — | — |
| 原创 / 首发 / 功能开关 | 固定值 | 固定值 | — | — |
| 发布方式 | 只存草稿 | 存草稿 | 填表 | — |

## 辰记要做到的

**表单要能填的字段**
- 标题（8–40 字，校验）
- 正文（转存图片、去外链）
- 封面：单图 / 三图，横竖裁剪
- 摘要、副标题
- 原创声明（没有权限时提示）
- 首发
- 允许转载
- AI 生成声明
- 定时发布

**两种接入方式**
- 默认：桌面端发布台，填好以后由用户点发布。
- 另一种：用户自己申请官方 `app_token` 后，可以直接调官方接口发布。官方接口只支持标题、正文、封面、原创，用这种方式时要把这一点告诉用户。

## 待实测

- [ ] 网页端标题字数上限
- [ ] 三图封面 `cover_layout` 的值
- [ ] 定时发布的字段
- [ ] `first_exclusive_publish_v2` 的含义
- [ ] 开放接口申请入口，以及 `app_token` 在哪里查看
- [ ] 登录 cookie 名

## 实测记录

（登录后补充）

## 来源

- 官方接口文档：https://baijiahao.baidu.com/builder/author/openauth/openauthProtection
- 官方手册：https://baijiahao.baidu.com/builder/author/info/manual
- Wechatsync v2：https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/baijiahao.ts
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/article/baijiahao.ts
- 易媒助手帮助中心：https://www.yimeizhushou.com/help.html
- 第三方反馈（接口成功但后台不见）：izualzhy.cn ⚠️
