# starnote-publish

发布 SDK for 辰记 StarNote：把 Tiptap JSON 转成各平台需要的正文，并通过统一的适配器契约把一篇笔记发到一个或多个平台。契约见 `starnote-docs/SPEC.md` §15，多平台扩展（内容类型、端与引导、绑定、report、平台注册表）见 `starnote-docs/SPEC-r8-publish-platforms.md` §12–§13。

| 包                                | 路径                             | 作用                                                                                                            |
| --------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@starnote/publish-core`          | `packages/core`                  | `convert`、`Adapter` 契约、`createPublisher`、zod → antd 表单工具、`planRuntime`、平台注册表 `PLATFORMS`、绑定 / report / stats / engage 类型 |
| `@starnote/publish-chenji`        | `packages/adapters/chenji`       | 辰记适配器：`POST /notes/{id}/publish/chenji`                                                                   |
| `@starnote/publish-github-pages`  | `packages/adapters/github-pages` | GitHub Pages：front matter + HTML（含双语、图片转存）经 Git Data API 一次提交；令牌校验、开启 Pages、绑定编排 |
| `@starnote/publish-kit` | `packages/adapters/kit` | 适配器公用件：块降级（提示框 / 徽章标题 / 分割线…）、错误映射（401 relogin、429 retry、其余 help）、字数与标签截断、图片转存、经辰记 API 转发（`relayPublish`） |
| `@starnote/publish-devto` / `-hashnode` / `-ghost` / `-wordpress` | `packages/adapters/{devto,hashnode,ghost,wordpress}` | 浏览器里渲染请求体，POST `/notes/{id}/publish/{platform}`，由 Python API 加凭据转发（Ghost 的 JWT 在服务端签）；只有浏览器安全入口 |
| `@starnote/publish-cnblogs` | `packages/adapters/cnblogs` | 博客园：用户的个人访问令牌存在服务端，Python API 调 MetaWeblog（XML-RPC）发布、存草稿、更新，图片用 `newMediaObject` 转存；数据读 Open API |
| `@starnote/publish-convertkit` / `-beehiiv` / `-buttondown` / `-hatena` / `-qiita` / `-zenn` / `-telegraph` | `packages/adapters/{convertkit,beehiiv,buttondown,hatena,qiita,zenn,telegraph}` | SPEC-r14 A1 海外官方接口：同 DEV，浏览器 / 桌面渲染请求体（Kit / beehiiv HTML，Buttondown / Qiita Markdown，はてなブログ按博客编辑模式，Zenn 整个 `articles/<slug>.md`，Telegraph Node JSON），Python API 加凭据发送（はてなブログ由服务端写 Atom XML，Zenn 用 GitHub 提交，Telegraph 绑定时自动 `createAccount`）；Newsletter 默认存草稿 |
| `@starnote/publish-share` | `packages/adapters/share` | X / LinkedIn / Facebook / Threads / Pinterest / 微博 / Telegram 分享链接（Reddit 作为未获批时的降级）与 Medium 导入：`buildShare` 生成打开地址和文案，结果 `state: 'handoff'` + `handoff {via, openUrl, copyText}` |
| `@starnote/publish-blogger` / `-wordpress-com` / `-tumblr` / `-reddit` / `-mastodon` | `packages/adapters/{blogger,wordpress-com,tumblr,reddit,mastodon}` | 官方 OAuth + 官方接口：浏览器 / 桌面渲染请求体。桌面端令牌加密存本机、主进程直接发；网页令牌只在页面内存（`MemoryCredentialStore`），随 `credential` 经辰记 API 转发一次、不保存；打开「云端代发」才存服务器。网页授权流程见 kit 的 `startWebAuthorization` / `completeWebAuthorization` |
| `@starnote/publish-bluesky` | `packages/adapters/bluesky` | atproto OAuth（公开客户端，PKCE + PAR + DPoP）：网页在页面内直接授权并发到 PDS（`./oauth`），桌面端由主进程完成；服务器不参与，不支持云端代发 |
| `@starnote/publish-instagram` | `packages/adapters/instagram` | 交接：手机用 Web Share 把图片 + 文案交给系统分享面板，电脑下载图片 + 复制文案；`handoff.files`。SPEC-r11 起另有 API 模式 `instagramApiAdapter`（专业账号，单图 / 轮播三段式发布；图片须是公网 HTTPS） |
| `@starnote/publish-telegram` / `-discord` / `-slack` | `packages/adapters/{telegram,discord,slack}` | SPEC-r11 令牌绑定（Bot 令牌 + 频道、频道 Webhook）：渲染引流卡片请求体，经辰记中转发送；没绑定时 Telegram 回落 `t.me/share/url`，Discord / Slack 回落「复制文案」（`via: 'copy'`） |
| `@starnote/publish-linkedin` / `-threads` / `-facebook` / `-pinterest` | `packages/adapters/{linkedin,threads,facebook,pinterest}` | SPEC-r11 OAuth 直发：LinkedIn 文章卡片、Threads 三段式（建容器 → `/check` → `/finalize`）、Facebook 主页链接帖、Pinterest Pin；没绑定时回落原来的分享跳转（`@starnote/publish-share`） |
| `@starnote/publish-zhihu` / `-juejin` / `-csdn` / `-wechat-mp` | `packages/adapters/{zhihu,juejin,csdn,wechat-mp}` | 登录态平台（桌面端）：`.` 入口只有声明、渲染与预览；`./electron` 用 `ctx.sessionFetch` 在账号会话里发请求。默认**交接**（填好标题正文、由用户点发布，进桌面端「发布台」）；公众号个人号只存进后台。易变部分放在签名站点脚本 `site-script.signed.json` |
| `@starnote/platform-logos` | `packages/logos` | 全部平台 logo 的唯一来源：`logoOf(key)`、`platformMeta(key)`（注册表字段 + logo），资源内联，`SOURCES.md` 记来源与许可 |
| `@starnote/moderation` | `packages/moderation` | 敏感词打码：`maskText` / `maskHtml`（预览高亮 `mark.sn-masked`，正式输出 `**`），MIT 词库，归一化与白名单 |

### 入口与端

每个包的 `.` 入口都是**浏览器安全**的（不引入 `node:*` / `electron`，由 `packages/core/test/browser-safe.test.ts` 与 eslint `no-restricted-imports` 把关）。按端的实现放在子入口：

| 入口 | 内容 |
| --- | --- |
| `@starnote/publish-core` | 全部核心 API；`@starnote/publish-core/platforms.json` 是注册表的 JSON 版（构建时生成，给 FastAPI 读） |
| `@starnote/publish-github-pages` | schema、目录约定 `GITHUB_PAGES_LAYOUT`、`renderPost`、`commitFiles`、`githubPagesBinding`、`connect` / `verifyGithubToken` / `ensurePages` / `detectRepo`、预填链接 |
| `…/github-pages/web`、`…/electron` | 临时直连方案：需要服务器把令牌下发给客户端，只在接受这一取舍时注册 |

**没有 Node 发布服务。** 服务端发布（凭据加密保存、定时发布）只在 Python 后端 `starnote-api` 执行：GitHub Pages 见 `app/services/github_publish.py`，DEV / Hashnode / Ghost / WordPress 见 `app/services/relay_platforms.py`（浏览器用 SDK 渲染请求体，POST `/notes/{id}/publish/{platform}`，后端按白名单校验、加凭据后转发）。`Runtime` 的 `'server'` 即「服务器代发」，`'node'` 只作为过时别名保留。SPEC-r8 §1 的 `starnote-publish-runner` 已取消。

```sh
pnpm install
pnpm build       # tsup → packages/*/dist (ESM + d.ts)
pnpm test        # vitest
pnpm lint        # eslint (typescript-eslint) + prettier config
pnpm typecheck   # tsc --noEmit per package
pnpm changeset   # record a change (changesets is set up; nothing is published)
node scripts/sign-site-scripts.mjs [--check|--key <file>]   # 给登录态平台的站点脚本签名（默认开发密钥）
```

`pnpm build` 还会生成 `packages/core/dist/platforms.json`（注册表的 JSON，FastAPI 读）与各包 `dist/`。starnote-web / mobile / shared / desktop 以 `link:` 引用这些包，改完要重新 `pnpm build`。

`zod` is a **peer dependency** (`^3.25 || ^4`): the host app brings its own copy so schemas are instances of the same class the form layer uses.

## Consuming from the web app

The packages are not on npm; link them from `starnote-web/package.json`:

```json
{
  "dependencies": {
    "@starnote/publish-core": "link:../starnote-publish/packages/core",
    "@starnote/publish-chenji": "link:../starnote-publish/packages/adapters/chenji",
    "@starnote/platform-logos": "link:../starnote-publish/packages/logos",
    "@starnote/moderation": "link:../starnote-publish/packages/moderation"
  }
}
```

网页端把每个平台适配器都 link 了一份（见 `starnote-web/package.json`）；手机端只需 core、chenji 与 shared。

Run `pnpm build` here first so `dist/` exists — `exports` point at `dist/index.js` and `dist/index.d.ts`.

## The adapter contract

An adapter is a plain object, one per platform:

```ts
import { z } from 'zod';
import type { Adapter } from '@starnote/publish-core';

const schema = z.object({ column_id: z.string().min(1, '请选择专栏') });

export const zhihu: Adapter<typeof schema> = {
  key: 'zhihu',
  label: '知乎',
  runtime: ['electron'], // where it can run
  capabilities: { supportsUpdate: false, titleMax: 100, needsLogin: true },
  schema, // platform-specific form fields
  prefill(doc, ctx) {
    // optional: guess form values
    return {};
  },
  async publish({ doc, form, common, ctx }) {
    ctx.emit({ type: 'progress', percent: 10, text: '打开知乎' });
    const code = await ctx.needInput({ id: 'sms', kind: 'text', title: '短信验证码' });
    // … drive the site, upload doc.html / doc.markdown / doc.images …
    return { url: 'https://zhuanlan.zhihu.com/p/…', externalId: '…' };
  },
};
```

- `schema` is a `z.object`. The publisher validates `perPlatform[key]` with it before calling `publish`; the web app renders the form from it with `zodToAntdRules(schema)` / `zodFieldMeta(schema)`.
- `publish` receives the converted `doc` (`html`, `markdown`, `text`, `toc`, `images`, `title`, `summary`), the validated `form`, the shared `common` form (`title`, `summary`, `cover`, `tags`, `scheduleAt`) and a `ctx`:
  - `ctx.emit(event)` — report progress; `at` is stamped for you.
  - `ctx.needInput({ id, kind, title, image?, options? })` — pause until the host calls `publisher.answer(platform, id, value)`.
  - `ctx.fetch` — the host's fetch (with auth headers in the web app); `ctx.signal` for cancellation.
  - `ctx.noteId`, `ctx.apiBase`, `ctx.runtime`; `ctx.page(partition)` in Electron for site automation.
- Throwing ends the platform with a `failed` event carrying a `重试` action; returning ends it with `done`. Exactly one of them is always emitted per platform.

Optional fields added for SPEC-r8 (all incremental; adapters without them behave as before):

| 字段 | 作用 |
| --- | --- |
| `runtimes: RuntimeSupport[]` | 每个端的支持方式 `{runtime, mode: 'api'\|'automation'\|'handoff'\|'manual', needs?, schedulable?, kinds?, handoff?}`；`runtime` 保留为它的别名（`defineAdapter` 自动推导，`runtimeList()` 读取二者） |
| `contentTypes` | `article` / `image-set` / `video` / `short-text`，默认 `['article']`；job 的 `content` / `perPlatformContent` 类型不符时以 `kind_unsupported` 失败 |
| `binding` / `binder` | 绑定声明 `{kind: 'session'\|'oauth'\|'token'\|'app-secret'\|'wx-component'\|'cookie'\|'none', store: 'server'\|'desktop'\|'none', provider?, fields?, form?, permissions?, createUrl?}` 与 `bind / status / unbind` 驱动；存放位置说明见 `CREDENTIAL_STORES` |
| `preview(doc, form, common?, content?)` | 无副作用地给出将提交的正文 / 文件和预测的 report |
| `publish` 返回 `{url, externalId?, state?, report?}` | `state`: `published` / `draft` / `pending-review` / `handoff` |
| `fetchStats` / `statsRequires` | SPEC-r11 §7：帖子数据（views / likes / comments / shares）。DEV、Hashnode、Mastodon、Bluesky、Reddit、Threads、Pinterest 已实现；`statsRow()` 转成 `POST /me/platform-stats` 的一行。只读请求可自动重试（kit `readJson`） |
| `engage` | 只有类型（SPEC-r8 §7.4） |

SPEC-r11 增量（同样都是可选字段）：

| 字段 | 作用 |
| --- | --- |
| `renderRequest(args)` / `renderHandoff(args)` | 纯函数、无网络：`publish` 会发的中转请求 `{body, previous?}`，以及没绑定时的交接（分享页 / 复制文案）。`publisher.prepare` 用它们生成排期任务 |
| `checkStatus` / `finalize` / `pollIntervalSec`（默认 5）/ `pollTimeoutSec`（默认 600） | 三段式：`publish` 返回 `state: 'processing'` + `pending`，publisher 轮询 `checkStatus`，`ready` 时调一次 `finalize`，到 `completed` 为止；超时以 `kind: 'unknown'` 失败。`finalize` 生效后 `checkStatus` 不能再返回 `ready` |
| `maxConcurrent` | `concurrency > 1` 时同一平台最多同时几个（Reddit / LinkedIn 1，Telegram / Discord / Slack 3） |

**报错分类**（`ErrorKind`）：`failed.kind` / `PlatformResult.kind` 为 `refresh` / `retry` / `bad_body` / `disconnect` / `unknown`；kit 的 `PlatformError.errorKind` 由状态码推出，中转错误信封里的 `error_kind` 优先。动作随类型：`disconnect` → 重新绑定，`retry` → N 秒后重试，`unknown` → 「去平台确认」+「仍要重发」。**写操作（发帖、`finalize`）从不自动重试**；只读请求（状态查询、统计）可以。

**幂等与多账号**：`PublishJob.jobId` + `attempt` 让中转带上 `Idempotency-Key: ${jobId}:${platform}:${accountId ?? 'default'}:${attempt}`（`PublishTarget.idempotencyKey` 直接指定，如排期任务里存的 key）；`finalize` 用 `finalize:${platform}:${containerId}`。`PublishJob.targets: [{platform, accountId?, account?, form?, previous?, idempotencyKey?}]` 让同一平台的多个账号各发一次，结果按 `targetKey()`（`platform@accountId`）分开；中转 body 带 `account_id`。

## The event stream

Every platform in a job produces an ordered stream of `PublishEvent`s, delivered to `onEvent(platform, event)`:

```
progress { percent, text? }        0–100, as often as the adapter likes
log      { level, text }           'info' | 'warn'
asset    { kind, url, text? }      screenshot or file produced on the way
needInput{ id, kind, title, … }    the host must answer; see below
report   { items: [{ kind, text, count?, level?, samples? }] }  「我们帮你做了什么」，同 kind 后者覆盖前者
done     { url, externalId?, state?, report? }  terminal
failed   { reason, code?, actions?, retryAfterSec?, kind? } terminal; actions: retry | relogin | skip | help
```

With `targets`, `onEvent(key, event, target)` gets `key = targetKey(target)` (`platform` or `platform@accountId`).

The stream ends with exactly one `done` or `failed`. Events are plain JSON so they can be forwarded unchanged to `POST /publish/jobs/{id}/tasks/{platform}/events` and replayed from the SSE endpoint.

## How a host consumes it

```ts
import { chenjiAdapter } from '@starnote/publish-chenji';
import { convert, createPublisher } from '@starnote/publish-core';

const publisher = createPublisher({
  adapters: [chenjiAdapter],
  runtime: 'web', // 'web' | 'electron' | 'server'（'node' 为过时别名）
  fetch: authedFetch, // adds Authorization; defaults to globalThis.fetch
  apiBase: '/api/v1',
  onEvent: (platform, event) => log.push(platform, event),
});

const doc = convert(editor.getJSON());
const { results } = await publisher.publish({
  noteId,
  doc,
  platforms: ['chenji', 'zhihu'],
  common: { title: doc.title, summary: doc.summary },
  perPlatform: { chenji: { category_id, visibility: 'public', show_in_blog: true } },
});
// results.chenji → { ok: true, url } ; results.zhihu → { ok: false, error: '该平台适配器尚未接入' }
```

- **Web**: only adapters whose `runtime` includes `'web'` run in the browser (chenji: a JSON API call). Others fail immediately with a runtime reason; the web app shows "即将支持" and, later, queues them for the desktop (`queued_for_desktop`).
- **Electron**: the desktop runtime passes `runtime: 'electron'` and a `page(partition)` factory that opens a hidden `BrowserWindow`/webview per platform session, so adapters can automate sites that have no API. `needInput` surfaces QR codes and verification codes to the renderer; the renderer calls `publisher.answer(...)`.
- **Server（服务器代发）**: there is **no Node publishing service**. Server-side publishing (stored credentials, scheduled posts) runs only in the Python API (`starnote-api`): GitHub Pages in `app/services/github_publish.py`, DEV / Hashnode / Ghost / WordPress in `app/services/relay_platforms.py` (the browser renders the request body with the SDK and posts it to `POST /notes/{id}/publish/{platform}`; the API whitelists it, adds the credential and forwards it). `runtime: 'server'` means 「辰记服务器代发」; `'node'` is accepted as a deprecated alias (`normalizeRuntime`). The `starnote-publish-runner` design in SPEC-r8 §1 is cancelled.

`results[platform].report` 收集了该平台所有 `report` 事件和 `publish` 返回的 report（按 kind 合并，失败时也保留）；`state` 是落地状态。

**引导（端不支持时怎么办）**：纯函数 `planRuntime(target, env, {scheduleAt?, contentKind?})` 对一个平台（注册表条目或适配器）给出按优先级排序的 `RuntimeGuide[]`，`kind` 为 `run-here` / `server`（服务器代发，可定时）/ `desktop`（交给或排队等桌面端）/ `download-desktop` / `bind-first` / `handoff`（deeplink、share-intent、import-url…）/ `copy`（复制后手动发，总在最后）/ `unavailable`，每项带 `label`、`href?`、`reason`。`planPlatforms` 批量计算；`publisher.plan(platform)` 用已注册的适配器（否则用注册表），`publisher.preview(platform, {doc, form})` 调适配器的 `preview`。运行端不符时 `results[platform].guides` 也会带上这份引导。

**平台注册表**：`PLATFORMS` / `platformMeta(key)` / `listPlatforms({region, contentType})` 覆盖 SPEC-r8 §2、§5 的国内外平台（SPEC-r11 新增 discord、slack，共 54 个）（key、名称、`short`、颜色、`region`、`contentTypes`、推荐 `runtimes`、绑定方式、变现方式、落地阶段 `phase`），是前后端平台 key 的唯一来源（GitHub 统一用 `github-pages`）。

**排期（SPEC-r11 §4、§12）**：`publisher.prepare({doc, targets, common, perPlatform, accounts, canonicalUrl?, previous?})` 不发请求，返回每个目标的 `PreparedTask`：`{platform, accountId?, runtime: 'server'|'desktop'|'handoff', seq, request?: {body, previous?}, handoff?: {open_url, copy_text?, files?}, label, report?, dependsOnChenji?, problem?}`，直接作为 `POST /publish/schedules` 的 `tasks`。规则：辰记和开了云端代发的账号 → `server`；本机账号、发布台平台、Bluesky → `desktop`（发布台不带 request，桌面端认领时再渲染）；不需要账号或没绑定 → `handoff`；只在页面里授权过的 → `server` + `problem: needs_cloud`（同时给出 `handoff` 备选）。辰记在同一批且还没发布时，其他平台里的原文链接写成 `CANONICAL_PLACEHOLDER`（`__STARNOTE_CANONICAL_URL__`），服务器先发辰记再替换（`fillCanonicalPlaceholder` 是同一操作的 TS 版）。排版时按真实链接长度（`CANONICAL_PLACEHOLDER_RESERVE` = 64）留位置，截断只截正文、不截链接（kit `appendLink` / `fitPost`）；Bluesky 不把占位符写进正文（facet 的字节偏移会错位），改用链接卡片。`toScheduleTasks(prepared, {needsCloud?: 'handoff'|'drop'|'keep'})` 把结果转成 API 的 `TaskIn`（snake_case）：去掉 `BLOCKING_PROBLEMS`（invalid_form / render_failed / unsupported / disabled）的任务，`needs_cloud` 默认改为到点提醒，辰记跑不了时去掉依赖占位符的任务。

`publisher.capabilities(key)` returns an adapter's `capabilities` for the form (title length, cover ratio, login needed); `publisher.adapters` lists what is registered. `publish` runs platforms sequentially unless `concurrency > 1`; pass `{ signal }` to cancel — pending `needInput`s reject and the platform ends `failed`.

## Site scripts are data, not code

Adapters that automate third-party sites depend on selectors and flows that break whenever a site changes. Those fragile parts are **not shipped as code**: the adapter carries the stable logic (login detection, upload order, error mapping) and downloads a **signed JSON "site script"** (selectors, URLs, wait conditions, version) from the StarNote API at run time. The runtime verifies the signature before use and falls back to the bundled copy when the download fails. Updating a broken flow is a data push, not a desktop release, and nothing downloaded is ever `eval`ed.

## GitHub Pages

绑定只要求用户粘贴一个**细粒度个人访问令牌**（只选博客仓库；Contents 读写、Pages 读写、Metadata 只读），令牌加密存在服务器：

1. `templateRepoUrl({login})` 预填「用模板建仓库」页（`owner=@me&name=<login>.github.io&visibility=public…`），用户只点 Create repository；`detectRepo(login)` 不带令牌查 `<login>.github.io` 是否已存在，存在就跳过这一步。
2. `tokenCreateUrl({repo})` 预填令牌生成页（参数名待在真实页面核实），用户只选仓库、点生成。
3. `connect(token, {fetch, repo?, publishExisting?})`：`GET /user` → 列出令牌能访问的仓库（一个自动选，多个返回 `choose-repo`，没有返回 `no-repo` + 建仓链接）→ `verifyGithubToken`（`permissions.push`、能访问多个仓库时给 warning、读 `github-authentication-token-expiration` 得 `expiresAt`）→ `ensurePages`（`build_type: workflow`）→ 可选的首次发布；每步返回 `done / failed / skipped / waiting`，前端逐步打勾。

发布（以模板 `starnote-blog-template` 为准，见 `SPEC-r8-github-template.md` §2）：`content/posts/<post_id>/index.<lang>.html`（YAML front matter + `<!--sn:article 1-->` + HTML），图片按 sha256 前 12 位存进同目录 `assets/`，译文写 `index.en.html`；URL 默认语言在 `/<id>/`，其他语言 `/en/<id>/`，目录名就是网址。front matter 依次是 `title, summary, lang, published_at, updated_at, category{slug,name}, tags, cover, canonical, starnote_url, starnote_id, note_id, translations, toc, generator`：`starnote_url` / `starnote_id` 是辰记原文地址和 short_id（模板据此显示评论预览），不再写容易和 short_id 混淆的 `id`。所有路径和模板仓库名都在 `GITHUB_PAGES_LAYOUT` 里（站点配置是 `content/site.json`），可按适配器覆盖。`commitFiles` 用 Git Data API（ref → commit → tree → blobs → tree → commit → PATCH ref，非快进最多重试 3 次），未变化的文件不上传，全部未变化则不提交。

站点设置（`site` 选项，`shared/site.ts`）：每次发布读 `content/site.json`，`applySiteSettings` 只改 `starnote`、`cname`、`adsense`（首次还填博客名和作者名），有变化就放进同一个提交。「用自己的域名，开启广告收入」：`normalizeMonetize` 校验域名和 `ca-pub-` + 16 位数字的发布商 ID，`setPagesDomain` 调 `PUT /repos/{o}/{r}/pages {cname}`（取消时 `cname: null`），`enforceHttps` 在证书签发后开 `https_enforced`（否则返回 `pending`），`dnsRecords` 给出 DNS 记录（子域名 CNAME → `<owner>.github.io`，根域名 4 条 A 记录，IP 集中在 `GITHUB_PAGES_A_RECORDS`，来源 GitHub Docs）。模板按 `adsense.client` 生成 `ads.txt`，按 `cname` 写 `CNAME`。

服务器侧同一套逻辑由 `starnote-api/app/services/github_publish.py`（Python）实现，`POST /notes/{id}/publish/github-pages` 调用；两边改动要同步。阅读统计本轮不做（模板不加载统计脚本），`fetchStats` 只保留类型。

## Repo layout

```
packages/core/src
  convert.ts / wechat.ts / mobile.ts   Tiptap JSON → 博客 HTML、公众号内联 HTML、手机端适配（图片 max-width、表格滚动）
  mask.ts / condense.ts / themes.ts    打码（接 @starnote/moderation）、摘编、文章主题 token（与 shared/styles 同一套）
  publisher.ts                         createPublisher：校验、事件、needInput / answer、取消、report 合并、done|failed 保证、
                                       三段式轮询、按平台限流（maxConcurrent）
  prepare.ts / targets.ts              publisher.prepare（排期任务）；targetKey、幂等 key、规范链接占位符、errorKindOf
  runtime.ts / platforms.ts            RuntimeSupport、planRuntime / planPlatforms；PLATFORMS 注册表（54 个平台：端、绑定、
                                       内容类型、rules、mobileFirst、stage…）→ 构建时导出 dist/platforms.json
  binding.ts / desktop-session.ts      凭据声明（token / oauth / cookie…）、桌面登录态会话声明
  site-script.ts                       签名站点脚本（ed25519）校验、过期、回落随包副本
  compliance.ts / rules.ts / learned.ts checkCompliance（确定性规则 + 学习规则 extraRules）；golden 用例与 FastAPI 共享
  session-client.ts / session-adapter.ts / render-steps.ts   登录态平台的公共请求与渲染步骤
  content.ts / report.ts / insights.ts / define.ts / schema.ts / types.ts
packages/adapters/<platform>/          每平台一个包；kit/ 是公用件（块降级、错误映射与分类、截断与 fitPost、OAuth 工具、
                                       中转 relayPublish / relayCheck / relayFinalize、统计读取 readJson）
packages/logos · packages/moderation   logo 与打码（见上表）
scripts/sign-site-scripts.mjs          站点脚本签名；开发密钥在 packages/core/test/fixtures/
```

## 微信公众号 HTML（`convertWechat`）

`convert(json).html` is the blog markup (classes such as `sn-h--pill`, `sn-box--tip`, `divider--wave`, styled by the shared sheet). The 公众号 editor and the draft API strip classes and `<style>`, so `convertWechat(json, { assetBase, accent?, dividerMode? })` writes a second, inline-styled form of the same document and returns `{ html, images, links }`.

What it relies on. These are assumptions from how the 公众号 editor treats pasted or API-submitted HTML. They are not an official whitelist, and `test/wechat.test.ts` pins the output to them.

| Kept | Used for |
| --- | --- |
| `section` `p` `span` `strong` `em` `sup` `br` `img` `ul` `ol` `li` `table` `tbody` `tr` `td` `th` `blockquote` `code` `h1`–`h6` | all text blocks; badges and quotation marks are real `section`/`p` nodes, not pseudo-elements |
| inline `style` with box, text, border, `border-radius`, `background-color`, `background-image: linear-gradient(...)`, `box-shadow`, `display: flex` / `inline-block` | headings, quotes, cards |
| inline `<svg>` with `path` / `rect` / `circle` / `g`, `fill` / `stroke` / `*-opacity` / `transform` attributes | ornamental dividers, the ornament heading |

What it avoids, because it is dropped or rewritten: `class`, `id`, `<style>`, `<script>`, `<div>`, `<figure>`, `position` / `float` / CSS `transform`, `::before` / `::after`, SVG `<defs>`, gradients that reference `url(#id)`, SVG `<text>`. Gradients in dividers are drawn as runs of rects with varying opacity.

Two more rules:

- **Links.** Links outside `mp.weixin.qq.com` are not clickable in articles. They become the link text plus `[n]`, listed under 「参考链接」 at the end.
- **Images and dividers.** `images` lists the absolute URLs of every image, so a publishing adapter can upload them to WeChat's CDN and rewrite the `src`. If an account's editor drops inline SVG, use `dividerMode: 'img'` instead. Dividers then become `<img src="{assetBase}/materials/dividers/{variant}.png">`; those PNGs are produced by `starnote-web`'s `scripts/materials/build-dividers.mjs` from this same serializer.
