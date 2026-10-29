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

## Open API（`https://api.cnblogs.com`，文档 `https://api.cnblogs.com/help`）

**认证方式**
- Client Credentials：`POST https://api.cnblogs.com/token`，参数 `client_id`、`client_secret`、`grant_type=client_credentials`。
- Authorization Code：先请求 `https://oauth.cnblogs.com/connect/authorize` 拿授权码，再用 `/connect/token` 换取令牌。
- 调用接口时带 `Authorization: Bearer <token>`。
- 令牌页上写明「个人访问令牌可用于 Open API」，⚠️ 实际用法应该也是 Bearer，帮助页里没写，待实测。

**接口分组**：Users、Blogs、BlogPosts、BlogPostComments、Bookmarks、KbArticles、NewsItems、NewsComments、Statuses（闪存）、Question（博问）、Edu（班级）、ZzkDocuments（搜索）。

**和博客文章有关的接口只能读，不能发布或编辑**：

| 接口 | 作用 |
|---|---|
| `GET /api/users` | 当前用户 |
| `GET /api/blogs/{blogApp}` | 博客信息：`blogId`、标题、`postCount` |
| `GET /api/blogs/{blogApp}/posts?pageIndex=` | 个人随笔列表，**带 `ViewCount`、`CommentCount`、`DiggCount`** |
| `GET /api/blogposts/{id}/body` | 正文 |
| `GET /api/blogposts/@sitehome?pageIndex=&pageSize=` | 首页博文列表，可用来判断文章有没有上首页 |
| `GET/POST /api/blogs/{blogApp}/posts/{postId}/comments` | 读评论、发评论 |

Open API 里还有发「闪存」（`POST /api/statuses`）的接口。闪存是博客园的短动态，可以作为「分享到博客园」的短文渠道。

**结论**：
- **发文用 MetaWeblog**。
- **数据用 Open API**：`fetchStats` 读随笔列表里的阅读、评论、推荐数，来源标 `source: 'official-api'`。

## MetaWeblog 发文（`https://rpc.cnblogs.com/metaweblog/{blogApp}`，页面上有方法说明）

用户名填登录名，密码填个人访问令牌（⚠️ 过去用的是博客密码，现在改成令牌，待实测）。

| 方法 | 参数 | 返回 |
|---|---|---|
| `blogger.getUsersBlogs` | appKey, username, password | `BlogInfo[]`（含 `blogid`） |
| `metaWeblog.newPost` | blogid, username, password, `Post`, publish | 新文章的 `postid` |
| `metaWeblog.editPost` | postid, username, password, `Post`, publish | — |
| `metaWeblog.getPost` / `getRecentPosts` | postid / blogid + numberOfPosts | `Post` / `Post[]` |
| `blogger.deletePost` | appKey, postid, username, password, publish | true |
| `metaWeblog.getCategories` | blogid, username, password | `CategoryInfo[]` |
| `wp.newCategory` | blog_id, username, password, `WpCategory` | 新分类的 id |
| `metaWeblog.newMediaObject` | blogid, username, password, `FileData` | `UrlData`（图片地址） |

`Post` 结构体的字段：
- 发布时必填：`title`、`description`（正文）、`dateCreated`。
- 选填：`categories`、`mt_keywords`（标签）、`mt_excerpt`（摘要）、`wp_slug`、`mt_allow_comments`、`mt_text_more`、`link`、`permalink`、`postid`、`enclosure`、`source`、`userid`。

`categories` 里的特殊写法（⚠️ 公开资料，待实测）：
- `[Markdown]` 表示正文是 Markdown；
- `[随笔分类]xxx` 表示个人分类；
- `[发布至博客园首页]` 表示投首页；
- `[网站分类]xxx` 表示网站分类。

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
