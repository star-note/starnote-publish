# 微博（weibo）：短微博与头条文章

调研日期 2026-10-29。资料来自公开资料和开源插件源码。登录后实测的结果记在「实测记录」，还没测的写「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://passport.weibo.com/sso/signin`（扫码 / 短信） |
| 头条文章编辑器 | `https://card.weibo.com/article/v5/editor`（也有 v3） |
| 发短微博 | `https://weibo.com/` 首页的发布框 |
| logo | `packages/logos`：`weibo.svg` |
| 辰记现状 | 走 `@starnote/publish-share`，打开微博的分享页，带上摘要和原文链接，不需要绑定 |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | 未查到 |
| 官方 API | 只有 `statuses/share`：`POST https://api.weibo.com/2/statuses/share.json`，用 OAuth2 的 `access_token`，还要传真实 IP `rip` |
| 头条文章 API | 未查到官方接口 |
| Webhook / RSS 导入 | 未查到 |

`statuses/share` 的限制：

- 正文最多 140 个汉字。
- 正文里必须带一个属于应用「安全域名」的网址。
- 正文不能含 `#话题#`。
- 配图可选，小于 5MB。
- 有调用频率限制。

对辰记来说，`statuses/share` 适合用来发一条「带原文链接的短微博」。申请这个接口需要辰记自己注册微博应用，并配置安全域名（例如 starnote.app）。

## 编辑器与正文格式（头条文章）

- 编辑器是 ProseMirror / TipTap，接受 HTML。
- 图片：
  - 正文图片的结构是 `<figure class="image"><img src="https://wx3.sinaimg.cn/large/{pid}.jpg" data-pid="{pid}"></figure>`。
  - 上传方式一：调 `asyncuploadimg` 让服务端去抓外链图，再轮询 `asyncimginfo` 看结果（`task_status_code` 为 1 是成功，2 是失败）。
  - 上传方式二：直接把图片传到 `picupload.weibo.com/interface/pic_upload.php`。
- 代码块、表格、公式：待实测。

## 发布字段（头条文章）

接口流程：先调 `POST https://card.weibo.com/article/v5/aj/editor/draft/create`，再调 `.../draft/save`。两次都带 `uid` 和 `_rid`。

| 字段 | 必填 | 接口字段 | 说明 |
|---|---|---|---|
| 标题 | 必填 | `title` | MultiPost 截到 32 字 |
| 正文 | 必填 | `content` | HTML |
| 封面 | 选填 | `cover` | 先传到图床。MultiPost 会裁成 16:9；第三方说尺寸是 980×560 ⚠️ |
| 导语 | 选填 | `summary` | MultiPost 截到 44 字 |
| 副标题 / 作者 | 选填 | `subtitle` / `writer` | |
| 定时发布 | 选填 | `publish_at` / `publish_local_at` / `timestamp` | |
| 关注后阅读 | 选填 | `follow_to_read`、`follow_to_read_detail` | 未认证用户每天只能有 1 篇文章使用 |
| 赞赏 | 选填 | `isreward` | |
| 付费阅读 | 选填 | `pay_setting`、`is_article_free`、`free_content`、`money` | |
| AI 声明 | 选填 | `is_aigc_used`、`is_ai_plugins` | |
| 文集 | 选填 | `collection` | |
| 文末推荐 | 选填 | `article_recommend` | |
| 草稿 / 发布 | — | `status`、`save`、`action` | Wechatsync 存草稿时传 `status:0`、`save:1`、`action:1` |

短微博：正文 + 图片 + `#话题#`。可见范围、评论设置：待实测。

## 发布规则

- 官方的发文规则（每日条数、引流、违规）：未查到。
- 已知只有一条：未认证用户每天只能有 1 篇文章开启「关注后阅读」。

## 风控与反爬

- 登录 cookie：`SUB`、`SUBP`。
- 写操作要带请求头 `X-XSRF-TOKEN`，值取 cookie `XSRF-TOKEN`，**先做 URL 解码**，否则返回 403。
- 头条文章接口还要带：
  - `SN-REQID`：43 位随机串（参考 Wechatsync 的 `generateReqId`）。
  - `Origin` / `Referer`：设为编辑器页面地址。
- 频率：第三方客户端把写请求串行，每次间隔 800ms，遇到 429 就暂停一段时间 ⚠️。
- 第一次访问会经过「Sina Visitor System」访客验证。它会自动跳转，跳不过去就让用户刷新，或在自己的浏览器里完成。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | 辰记现状 |
|---|---|---|---|---|
| 标题 / 正文 / 图片转存 | ✔ | ✔ | 标题、正文 | 只有分享页（摘要 + 链接） |
| 封面 | ✔ | ✔（16:9） | — | — |
| 导语 | — | ✔ | — | — |
| AI 声明 / 关注后阅读 / 赞赏 | 固定值 | 固定值 | — | — |
| 发布方式 | 草稿 | 草稿（v5 失败时退回 v3） | 点「保存草稿」 | 打开分享页 |

## 辰记要做到的

- 新增「头条文章」桌面端发布台。表单要能填：
  - 标题、正文（图片转存）、封面（16:9 裁剪）、导语
  - 定时发布、关注后阅读、赞赏、AI 声明、文集
- 短微博继续走分享页。以后如果申请到微博应用，再加 `statuses/share` 一键发「链接 + 摘要」。

## 待实测

- [ ] v5 编辑器是否仍是默认
- [ ] 封面的官方尺寸
- [ ] 正文是否支持代码块、表格
- [ ] 可见范围、评论设置对应哪个字段
- [ ] `status`、`save`、`action` 的取值含义

## 实测记录

（登录后补充）

## 来源

- `statuses/share`：https://open.weibo.com/wiki/2/statuses/share
- Wechatsync v2：https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/weibo.ts
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/article/weibo.ts
- COSE：https://github.com/doocs/cose
- Matter（第三方客户端）的鉴权说明：https://github.com/HapeLee/Matter/blob/main/docs/credential-auth-review.md
