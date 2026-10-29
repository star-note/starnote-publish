# 微信公众号（wechat，适配器 `@starnote/publish-wechat-mp`）

调研日期：2026-10-29。来源包括官方开发文档、公开资料和开源插件源码。登录后实测的结果记在「实测记录」，还没测的写「待实测」。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://mp.weixin.qq.com/`（管理员用微信扫码） |
| 注册 | 首页右上「立即注册」。个人主体只能注册**订阅号**；需要一个没绑定过其他微信账号的邮箱，并完成实名扫码 |
| 写文章 | 后台首页 →「新的创作 / 文章」。编辑页地址：`/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&token={token}` |
| 会话令牌 | URL 参数 `token`。首页 HTML 的 `wx.commonData` 里有 `t` / `ticket` / `user_name` / `time` |
| logo | `packages/logos`：`wechat.svg` |

## 官方开放能力

| 能力 | 结论 |
|---|---|
| MCP | 官方没有。wechat-publisher-mcp 等都是第三方，靠 AppID + AppSecret + IP 白名单 |
| 草稿接口 `draft/add` / `draft/update` | 官方。文档里公众号和服务号都打了勾。⚠️ **个人订阅号实际能不能调，官方没写清楚**，待实测 |
| 发布接口 `freepublish/submit` | 官方，但**从 2025-07 起，个人主体、未认证企业主体都没有权限**（返回 48001）。只有已认证的企业主体能用 |
| 发布结果 Webhook | 官方事件 `PUBLISHJOBFINISH`，推到开发者配置的 URL。`publish_status` 取值：0 成功，2 原创失败，4 审核不通过，等等 |
| access_token | 只能在服务端调，必须配 IP 白名单（否则报 40164），有效期 7200 秒 |
| 素材 | 正文图片用 `media/uploadimg`（JPG / PNG，< 1MB）；永久素材用 `material/add_material` |
| RSS 导入 | 没有 |

官方草稿接口没有这些字段：原创声明、赞赏、合集、话题、定时群发、付费。

结论：
- 个人号能走的只有「网页后台登录态」。辰记现在就是这么做的。
- 认证过的企业号，以后可以考虑加一档官方接口：用户填 AppID 和 AppSecret，由辰记服务器（固定出口 IP）调用。

## 编辑器与正文格式

- 新版编辑器是 ProseMirror。往编辑器里写内容的首选方式是页面暴露的 `window.__MP_Editor_JSAPI__.invoke({apiName:'mp_editor_set_content', apiParam:{content: html}})`。
  - 用合成 paste 事件写入，图片可能丢。
  - 直接改 `innerHTML`，内容不会进 ProseMirror 的文档模型。
- 正文只接受 HTML，不接受 Markdown。样式必须写成内联样式。限制：少于 2 万字符、小于 1MB，`<script>` 会被去掉。
- **外链图片会被过滤**。图片必须先换成 `mmbiz.qpic.cn` 的地址：
  - 网页端：`uploadimg2cdn` 按 URL 转存，或下载后走 `filetransfer` 上传。
  - 官方接口：`uploadimg`。
- 代码块要写成带内联样式的 HTML。表格支持有限。公式要转成 SVG 或图片（⚠️ 来自经验，官方没写）。

## 发布字段

网页端接口：`POST /cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77`，字段名都带 `0` 后缀。

| 字段 | 必填 | 网页端字段 | 限制 / 说明 | 辰记现状 |
|---|---|---|---|---|
| 标题 | 必填 | `title0` | 64 字（站点脚本 `titleMax`）；官方接口文档写 32 字 ⚠️ 待实测 | ✔ |
| 作者 | 选填 | `author0` | 16 字 | ✔（表单有） |
| 摘要 | 选填 | `digest0`、`auto_gen_digest0` | 120 字；留空时自动取正文前 54 字 | ✔ |
| 正文 | 必填 | `content0` | 见上 | ✔ |
| 封面 | 选填（群发时必填） | `cdn_url0`、`cdn_235_1_url0`、`cdn_1_1_url0`、`cdn_16_9_url0`、`cdn_3_4_url0`、`crop_list0`、`show_cover_pic0` | 要裁成 2.35:1 和 1:1。MultiPost 调 `cgi-bin/cropimage?action=crop_multi` 一次生成 16:9、1:1、3:4 三种 | 只填了 `cdn_url0` 和 `cdn_235_1_url0`，**没有调裁剪** |
| 阅读原文 | 选填 | `sourceurl0` | 不超过 1KB | ✔ |
| 留言 | 选填 | `need_open_comment0`、`only_fans_can_comment0` | | 固定开启，**不能选** |
| 原创声明 | 选填 | `copyright_type0`、`releasefirst0`、`platform0`、`original_article_type0`、`ori_white_list0` | 后台有入口，不需要单独开通 | 固定 0，**不能选** |
| 转载设置 | 选填 | `reprint_permit_type0`、`allow_reprint0`、`allow_reprint_modify0`、`is_share_copyright0` | | 没有 |
| 赞赏 | 选填 | `can_reward0` | 要先开通赞赏账户 | 固定 0 |
| 付费阅读 | 选填 | `fee0`、`free_content0` | 个人号需要申请 ⚠️ | 没有 |
| 合集 / 话题 | 选填 | `categories_list0`（⚠️ 字段含义未确认） | | 没有 |
| 定时群发 | 选填 | 后台界面里有；字段名待实测 | 官方接口不支持 | 没有 |
| 其他 | 选填 | 投票 `voteid0`、卡片 `cardid0`、音乐、视频、广告、商品 | | 没有 |

## 发布规则

- 群发次数：订阅号每天 1 次，服务号每月 4 次，每次最多 8 篇（来自社区回答，与官方运营多年的规则一致）。删除已群发的文章，次数不会返还 ⚠️。
- 「发表」（不推送给粉丝）据说不限次数 ⚠️。
- 先审核再发出；原创声明可能失败（`publish_status` 2）。
- 正文外链：基本只允许微信域名下的链接，其他链接改放到「阅读原文」⚠️。

## 风控与反爬

- 用户扫码登录。以下 cookie 待实测：`slave_sid`（站点脚本里用来判断登录成功）、`slave_user`、`bizuin`、`data_ticket`。
- 每个请求都要带 `token`，以及 `f=json&ajax=1&lang=zh_CN`。上传图片时还要带 `ticket_id`、`ticket`、`svr_time`。
- 没有 `a_bogus` 这一类签名。
- `base_resp.ret` 返回码：200003 要重新登录，200013 是限流，-6 / -8 要人工验证。
- 编辑器的 JSAPI 和页面结构会变。容易变的部分放在签名站点脚本里，变了只需更新脚本。

## 插件对照

| 字段 | Wechatsync | MultiPost | COSE | 辰记现状 |
|---|---|---|---|---|
| 标题 / 正文 / 图片转存 | ✔ | ✔ | 标题、正文（经 JSAPI，可能丢图） | ✔ |
| 作者 | 空 | ✔（取昵称） | — | ✔ |
| 摘要 | 自动生成 | ✔（截到 120 字） | — | ✔ |
| 封面 | 空 | ✔（三种比例裁剪） | — | 半成品（没有裁剪） |
| 留言 | 固定开启 | 固定开启 | — | 固定开启 |
| 原创 / 赞赏 / 合集 / 定时 | — | — | — | — |
| 发布方式 | 草稿 | 草稿 | 保存为草稿 | 存进草稿箱，由用户在后台群发 |

## 辰记要补的（以超过插件为目标）

- 封面调 `cropimage` 生成 2.35:1、1:1、16:9、3:4 四种比例，用户可以调整裁剪框。
- 留言：开 / 关 / 仅粉丝。
- 原创声明，加上转载设置。
- 赞赏：账号已开通时才显示。
- 合集。
- 定时群发：如果网页端有接口就用，没有就停在草稿，并在后台提示用户手动设置。

## 待实测

- [ ] 个人订阅号能不能调官方 `draft/add`
- [ ] 标题上限是 64 还是 32
- [ ] 原创声明和转载设置的取值
- [ ] `categories_list0` 的含义
- [ ] 定时群发的字段
- [ ] 登录 cookie 名
- [ ] `uploadimg2cdn` 还能不能用

## 实测记录

（登录后补充）

## 来源

- 官方文档：
  - [draft/add](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add.html)
  - [freepublish/submit](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit.html)
  - [个人主体权限调整](https://developers.weixin.qq.com/doc/subscription/guide/product/publish.html)
  - [access_token](https://developers.weixin.qq.com/doc/service/api/base/api_getaccesstoken.html)
  - [uploadimg](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage.html)
- 群发次数（社区回答）：https://developers.weixin.qq.com/community/develop/doc/0008044fc6c5f0c0a6904ebd261000
- Wechatsync v2：https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/weixin.ts
- MultiPost：https://github.com/leaperone/MultiPost-Extension/blob/main/src/sync/article/weixin.ts
- COSE：https://github.com/doocs/cose/blob/main/packages/core/src/platforms/wechat.js
