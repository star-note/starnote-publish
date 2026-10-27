---
'@starnote/publish-core': minor
'@starnote/publish-kit': minor
'@starnote/publish-share': minor
'@starnote/publish-blogger': minor
'@starnote/publish-bluesky': minor
'@starnote/publish-devto': minor
'@starnote/publish-discord': minor
'@starnote/publish-facebook': minor
'@starnote/publish-ghost': minor
'@starnote/publish-hashnode': minor
'@starnote/publish-instagram': minor
'@starnote/publish-juejin': minor
'@starnote/publish-linkedin': minor
'@starnote/publish-mastodon': minor
'@starnote/publish-pinterest': minor
'@starnote/publish-reddit': minor
'@starnote/publish-slack': minor
'@starnote/publish-telegram': minor
'@starnote/publish-threads': minor
'@starnote/publish-tumblr': minor
'@starnote/publish-wechat-mp': minor
'@starnote/publish-wordpress': minor
'@starnote/publish-wordpress-com': minor
---

SPEC-r12 发布闭环（SDK 部分）：

- 回填作品链接：core `parsePostUrl(platform, url)`（各平台规则，`externalId` 与 `publish` 返回的形式一致；没有规则的平台用规范化后的链接）、`POST_URL_PLATFORMS`、`normalizePostUrl`、`isUrlExternalId`、`shortcodeOf`；`Adapter.parsePostUrl`（`defineAdapter` 自动补上）；DEV、Hashnode、Mastodon、Bluesky、Reddit、Threads（`code:`，有令牌时按 shortcode 查）、Pinterest 的 `fetchStats` 能读回填的链接，读不了返回 `null`；
- 链接放第一条评论：`PlatformMeta.linkPlacement`、`LINK_PLACEMENT`，LinkedIn / Threads / Bluesky / Mastodon / Facebook 表单字段 `linkPlacement`；首评时正文不带链接和链接卡片，`AdapterPreview.followUp`、`PublishOutput.followUp`、`Adapter.followUp`、`PlatformResult.followUp`；publisher 在主帖上线后（三段式在 `finalize` 后）只调一次，失败不影响主帖成功并加 `warn`；排期请求带 `follow_up`；kit `relayFollowUp`（`…/comment`，`Idempotency-Key: comment:{platform}:{externalId}`，`followUpKeyOf`）、`placeLink`、`linkCommentText`、`linkPlacementField`，中转结果读 `data.meta`；Bluesky 网页直连发回复（link facet）；
- 媒体限制：`MediaLimits`、`PlatformMeta.limits.media`（`MEDIA_LIMITS`）、`checkMedia`、`mediaItemsOf`、`mediaReport`，各适配器 render 时并入 report；`ReportItem.level` 新增 `error`；`CommonFormShape.coverMeta`；
- 追踪短链：`PublishTarget.trackingUrl`、`ctx.trackingUrl`、`ArticleContent.trackingUrl` / `ShortTextContent.trackingUrl`、`visibleLinkOf`、`withTrackingUrl`、`publisher.preview({ trackingUrl })`；用户看得见的链接（分享、链接卡片、首评、「本文首发于辰记」、公众号「阅读原文」）用短链，canonical 字段不变；`@starnote/publish-share` 的分享链接用短链（Medium 导入仍用原文）。
