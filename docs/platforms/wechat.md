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

### 2026-10-30：个人主体订阅号（新注册，0 粉丝，管理员扫码登录）

**注册**
- 在网页「立即注册」里选「个人」后，页面只给出一个二维码，提示「在手机端快速注册」。用手机扫这个码，在内嵌浏览器环境里打开是**空白页**，原因待查。
- 用户换成其他方式完成了注册，可以用手机微信里的「公众号助手」小程序，或者用自己的浏览器。
- 注册页说明：个人可注册 1 个账号；个体工商户、企业、其他组织可注册 2 个；政府和媒体可注册 50 个。个人类型不支持微信认证、微信支付和高级接口。

**后台菜单**（首页 `/cgi-bin/home?t=home/index&token={token}`，所有后台地址都带 `token`）
- 内容管理：草稿箱、素材库、发表记录、原创、合集
- 互动管理：留言、划线、私信、提到、投票、视频弹幕
- 自动回复、自定义菜单、用户管理、号内搜索
- 数据分析：内容分析、用户分析
- 收入变现：赞赏、付费、带货、广告收入、微信小店
- 账号成长：我的足迹、账号检测
- 营销与服务：营销推广、小程序管理、加热工具、微信搜一搜、服务市场
- 设置与开发：账号设置、人员设置、安全中心、违规记录、开发接口管理
- 首页「新的创作」可选：**文章、选择已有内容、贴图（小绿书）、播客、转载、视频、直播**。

**开发接口管理已迁走**
- 页面公告：「设置与开发 - 开发接口管理」**自 2025-12-01 起迁移到微信开发者平台**。开发者平台支持全部开发接口管理功能，管理员还能在那里配置开发者权限。
- 官方文档：**从 2025-07 起，个人主体、未认证企业主体以及不支持认证的账号，被收回了 freepublish 系列接口的调用权限**，包括发布草稿、发布状态查询、获取已发布列表、删除发布。草稿箱接口（`draft/add`）在文档里没有写回收，个人号到底能不能调用，要在微信开发者平台登录后确认。⚠️
- 结论：个人订阅号**不能通过官方 API 发布**，最多只能存草稿。所以走网页后台的登录态，让用户自己点「发表」，这是唯一稳定的方式。

**编辑器**（「新的创作 → 文章」）
- 点「文章」会用 `window.open` 打开新窗口，内嵌浏览器会拦截，所以要直接打开它要去的地址：`/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0&token={token}`。
- 编辑器是 **ProseMirror**，页面上有 `window.__MP_Editor_JSAPI__` 对象，可以用 `mp_editor_set_content` 往编辑器里写内容。另外还加载了 UEditor 的全局对象 `UE`。
- 顶部插入栏：图片、视频、音频、超链接、小程序、模板、投票、搜索、更多。格式栏：格式刷、字号、加粗、斜体、下划线、删除线、颜色、背景色、对齐、缩进、行距、列表、表格等。另有「导入」、「AI 配图」、「一键排版」、「历史版本」，还能「增加一条」，把多篇图文放在一次群发里。
- 打开页面时会依次弹出两个提示框，都关掉即可：「小店返佣商品」（**没有开通**）和「支持添加话题卡片」。

**发表设置**（标题区和正文下方）

| 字段 | 说明 |
|---|---|
| 标题 | 最多 **64** 字（`#title`，页面显示 0/64） |
| 作者 | `#author` |
| 编者荐语 | `#reprint_recommend_title`，转载时用 |
| 摘要 | `#js_description`，最多 **120** 字。不填的话，默认抓正文开头部分；摘要会显示在转发卡片和公众号会话里 |
| 封面 | 拖拽上传或从素材里选 |
| 原创 | 默认未声明。分原创类型、快捷转载。声明成功后享有平台著作权保护，还可能被推荐 |
| 赞赏 | **要先声明原创才能开启** |
| 留言 | 默认「留言自动精选公开」。可以选只让「已关注的人」或「已关注 7 天及以上的人」留言；付费文章可以设「允许未付费用户留言」。**快捷私信和留言不能同时开** |
| 合集 | 默认未添加 |
| 原文链接 | `#source_url` |
| **创作来源** | 内容由AI生成 / 素材来源官方媒体或网络新闻 / 个人观点，仅供参考。页面引用了网信办关于自媒体标注信息来源的通知，以及《人工智能生成合成内容标识办法》：**AI 生成的内容发布时必须主动声明** |
| 平台推荐 | 默认开启，内容可能被推荐到「看一看」等场景；关闭后不会被推荐，但不影响推送给粉丝。另有一项「推荐」图标样式：常规内容，或时政新闻等严肃内容 |
| 辟谣来源 | 有这个字段 |

底部有三个按钮：保存为草稿、预览、**发表**。「发表」弹窗里的群发通知、定时发表等选项还没看，因为要先填好内容才能打开。⚠️

**风控**
- 后台每个请求都靠 URL 里的 `token`，登录态在 httpOnly cookie 里。页面能读到的 cookie 只有 `wxuin`、`pgv_pvid`、`qlogin_uid`、`mm_lang`、`_clck`、`_clsk`。
- 登录页会依次探测本机端口 13013–14015，看电脑上有没有微信客户端可以快速登录。内嵌浏览器里这些探测都会失败，不影响扫码登录。
- 这次没看到签名参数。每打开一页都停了 3–5 秒，没有触发任何风控。

**发布后的数据**
- 「内容分析」老版页面写着「历史数据更新至 2025-10-31，前往新版内容分析」。指标有：阅读次数、分享次数、完成阅读次数、跳转阅读原文、微信收藏、发表篇数；按渠道拆分为公众号消息、推荐、聊天、朋友圈、公众号主页、搜一搜、其它；可以下载数据明细。数据接口是 `/misc/datacubequery?action=`。
- 首页有昨日阅读人数、分享人数、新增关注人数和总用户数，统计口径是前一天的 00:00–24:00。
- 文章发出后，链接 `mp.weixin.qq.com/s/...` 到「发表记录」里取。

**变现**

| 方式 | 入口 | 状态 / 门槛 |
|---|---|---|
| 广告收入（流量主） | `/promotion/publisher/publisher_index` | 「**你暂未满足开通条件，可预约开通**」，页面上没写具体门槛 ⚠️。开通后可以投的广告位：常看列表、文章底部、文章中部、留言区、文中关键词、返佣商品和内容推广、互选广告 |
| 赞赏 | `/merchant/reward` | 包括数据概况、赞赏账户、赞赏回复设置。单篇文章要先声明原创才能开赞赏 |
| 付费 | `/merchant/mppaysubscribe` | 付费阅读，门槛待查 |
| 带货、微信小店 | `/cgi-bin/productpage`、`/cgi-bin/weshop` | 小店返佣商品：实名主体是个人、企业或媒体，注册地在中国大陆（这个号**已满足**）；还要绑定微信小店带货账号，并同意开通协议 |

**对辰记的影响**
- 公众号只能走登录态发布台。正文通过 `__MP_Editor_JSAPI__` 写入；图片先转存，标题、作者、摘要等按上表填好。
- 需要用户自己做的设置：原创要用户确认后再声明，平台推荐和留言范围由用户设置。
- 「创作来源」三个选项都放进表单，**由用户自己选，辰记不预设**。法规要求 AI 生成的内容要主动声明，表单旁边用一句话提示这条规定即可。
- 「发表」由用户自己点。群发通知是推给粉丝的，订阅号每天只能 1 次，这一点在界面上要提示清楚。

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
