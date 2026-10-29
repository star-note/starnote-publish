# 博客园（cnblogs）

调研日期 2026-10-29。资料来源：实测，以及公开资料。⚠️ 表示只有第三方说法，或者还没实测。

## 入口

| 项 | 值 |
|---|---|
| 登录 | `https://account.cnblogs.com/signin` |
| 博客后台 | `https://i.cnblogs.com/`；写文章是 `/posts/edit` |
| 开通博客 | `https://account.cnblogs.com/blog-apply`。**新账号要先申请开通博客** |
| 个人访问令牌 | `https://account.cnblogs.com/settings/tokens` |
| logo | `packages/logos`：`cnblogs.svg` |
| 辰记现状 | 注册表里已登记：`api('server', needs('token'))`，绑定方式 `TOKEN`，备注写的是 MetaWeblog API。**还没有适配器** |

## 官方开放能力（已实测）

| 能力 | 结论 |
|---|---|
| 个人访问令牌（PAT） | **有，个人可以用**。页面原文：「个人访问令牌可用于 Open API，VSCode 插件，MetaWeblog 客户端」。可以「创建令牌」和「删除所有」 |
| MetaWeblog | 有 ⚠️。接口地址是 `https://rpc.cnblogs.com/metaweblog/{博客地址名}`，用户名填登录名，密码填 PAT |
| Open API | 有 ⚠️。地址 `api.cnblogs.com`，具体能力待查 |
| VSCode 插件 | 官方插件用的也是 PAT |
| MCP / Webhook | 未查到 |

**博客园是国内少数几个个人账号就能用官方接口发文的平台**，可以和 DEV、Hashnode 一样做成「填令牌，一键发布」。

## MetaWeblog 发文（⚠️ 按公开资料整理，要等开通博客后实测）

| 方法 | 作用 | 要点 |
|---|---|---|
| `blogger.getUsersBlogs` | 校验令牌，取 `blogid` | 绑定时调用 |
| `metaWeblog.newPost` / `editPost` | 新建 / 修改文章 | `title`；`description` 是正文；`categories` 里放 `[Markdown]` 表示正文是 Markdown，放 `[随笔分类]xxx` 表示个人分类；`mt_keywords` 是标签；`publish` 传 false 就是存草稿 |
| `metaWeblog.newMediaObject` | 上传图片 | 返回博客园图床地址，正文里的图片要先转存 |
| `metaWeblog.getCategories` | 取个人分类 | 给表单的下拉框用 |

## 发布规则

- **个人博客只能发软件开发相关的技术内容，不能发推广内容**（开通申请页原文）。企业推广要另外申请企业博客。
- 开通博客要填申请理由（10–2000 字），可以选填姓名、职位、单位、技术方向，然后**人工审核**。
- 「发布到首页」有门槛，比如原创、技术相关、篇幅够长，上首页要审核 ⚠️，待查规则页。

## 风控

- 走官方 PAT，不用登录态，也没有签名。
- 网页后台是 Angular 应用，`i.cnblogs.com` 没登录或没开通博客时，会跳转到 `account.cnblogs.com`。

## 发布后的数据

- 文章页公开显示阅读数和评论数。⚠️ Open API 应该能读到，待实测。
- 后台的「统计」在开通博客后再看。

## 变现

- **没有给作者的收益分成**，注册表里 `monetization: []` 也是这么记的。
- 博客园的价值在于技术圈的影响力和搜索引擎收录，属于「技术同步」类平台。

## 决定（2026-10-29）

博客园**只走个人访问令牌**，不做登录态发布台。具体做法：

- **绑定**：用户在 `account.cnblogs.com/settings/tokens` 自己创建令牌，把令牌和博客地址名填进辰记。辰记调 `blogger.getUsersBlogs` 校验，并拿到 `blogid`。
- **发布**：
  - 参照 DEV、Hashnode、WordPress 的做法，SDK 在浏览器端渲染请求体（Markdown 正文、标题、标签、分类），通过 `POST /notes/{id}/publish/cnblogs` 交给 starnote-api。
  - starnote-api 加上凭据，调用 MetaWeblog（XML-RPC），代码放在 `relay_platforms.py` 一类的模块里。
  - 桌面端也可以直接在本机调用。
- **正文**：用 Markdown 发，`categories` 里带 `[Markdown]`。图片先用 `newMediaObject` 转存到博客园，或者保留辰记的公网地址（⚠️ 外链图片能不能正常显示，待实测）。
- **表单**：标题、标签（`mt_keywords`）、个人分类（`getCategories`）、是否发布（不发布就是存草稿），以及「发布到首页」（待实测字段）。
- **数据**：文章页上的阅读数和评论数，优先用 Open API 读取，读不到就从公开页面上取。

## 实测记录

### 2026-10-29

- 这个账号还没开通博客。打开 `i.cnblogs.com/posts/edit`，被跳转到「申请开通博客」页。
- 账号中心的菜单：账号设置、会员中心、个人资料、屏蔽管理、博客申请、**Access Tokens**。
- 「个人访问令牌」页确认可以创建 PAT，用途写的是 Open API、VSCode 插件、MetaWeblog 客户端。**没有实际创建令牌**。

## 待实测（开通博客以后）

- [ ] 网页编辑器的发布选项：分类、标签、发布到首页、网站分类、摘要、访问权限、评论、置顶
- [ ] MetaWeblog 的 `[Markdown]` 分类写法和图片上传是否可用
- [ ] Open API 有没有读取文章数据的接口
- [ ] 每日发文限制
