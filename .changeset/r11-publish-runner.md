---
'@starnote/publish-core': minor
'@starnote/publish-kit': minor
'@starnote/publish-share': minor
'@starnote/publish-chenji': minor
'@starnote/publish-devto': minor
'@starnote/publish-hashnode': minor
'@starnote/publish-ghost': minor
'@starnote/publish-wordpress': minor
'@starnote/publish-blogger': minor
'@starnote/publish-wordpress-com': minor
'@starnote/publish-tumblr': minor
'@starnote/publish-reddit': minor
'@starnote/publish-mastodon': minor
'@starnote/publish-bluesky': minor
'@starnote/publish-instagram': minor
'@starnote/publish-telegram': minor
'@starnote/publish-discord': minor
'@starnote/publish-slack': minor
'@starnote/publish-linkedin': minor
'@starnote/publish-threads': minor
'@starnote/publish-facebook': minor
'@starnote/publish-pinterest': minor
'@starnote/platform-logos': minor
---

SPEC-r11 发布补齐（SDK 部分）：

- 报错四分类 `ErrorKind`（`failed.kind`、`PlatformResult.kind`、kit `PlatformError.errorKind`，中转信封 `error_kind` 优先），写操作不自动重试；
- 三段式发布：`Adapter.checkStatus` / `finalize` / `pollIntervalSec` / `pollTimeoutSec`，`state: 'processing'` + `pending`，publisher 轮询与超时；kit `relayCheck` / `relayFinalize`；
- 中转 `Idempotency-Key`（`PublishJob.jobId` / `attempt`、`PublishTarget.idempotencyKey`）；
- 多账号：`PublishJob.targets`、`ctx.accountId`，中转 body 带 `account_id`，结果按 `targetKey` 分开；
- `Adapter.maxConcurrent`；
- `fetchStats`：DEV、Hashnode、Mastodon、Bluesky、Reddit、Threads、Pinterest；`statsRow`；
- `Adapter.renderRequest` / `renderHandoff` 与 `publisher.prepare`（排期任务，`CANONICAL_PLACEHOLDER`）；
- 新直发平台包 telegram、discord、slack、linkedin、threads、facebook、pinterest，Instagram API 模式；注册表新增 discord、slack，logo 同步。
