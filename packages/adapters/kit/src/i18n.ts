/**
 * SPEC-r14 B5: the kit's user-visible texts (reports, failures, action labels) in 简体中文 / 繁體中文 / English.
 * Functions take a `lang` (or read `PlatformRef.lang`); without one they answer in `zh-CN`, as before.
 */
import { coreMessages, defineMessages, localizedLabel } from '@starnote/publish-core';

import type { SdkLang } from '@starnote/publish-core';

const zhCN = {
  canonicalMissing:
    '还没有辰记原文链接，这次没有设置 canonical（先发布到辰记再同步可以把搜索权重留给原文）',
  canonicalTo: (url: string) => `设置 canonical 指向 ${url}`,
  canonicalBack: '设置 canonical 指回辰记原文',
  relayNote: '由服务器代发（凭据只在服务器）',
  imagesLinked: (n: number, platform: string) =>
    `${n} 张图片以辰记图片链接引用（${platform} 直接加载外链）`,
  shortMissingLink: (platform: string) =>
    `还没有辰记原文链接，${platform} 帖子里没有链接（先发布到辰记再同步可以带上原文卡片）`,
  newPost: '这次发出的是一条新帖子（不修改之前发过的）',
  linkPlacementLabel: '原文链接',
  linkFirstComment: '原文链接不放正文，发帖后作为第一条评论发出',
  degrade: {
    callout: (n: number) => `提示框降级为引用块 ${n} 处`,
    heading: (n: number) => `徽章 / 装饰标题改为普通标题 ${n} 处`,
    headingLevel: (n: number) => `标题层级调整为二、三级 ${n} 处`,
    divider: (n: number) => `波浪线等装饰分割线改为普通分割线 ${n} 处`,
    quote: (n: number) => `装饰引用改为普通引用 ${n} 处`,
    codeFenced: (n: number, platform: string) =>
      `代码块输出为带语言的围栏代码 ${n} 处，高亮由 ${platform} 渲染`,
    codeKept: (n: number) => `代码块保留语言标记 ${n} 处，高亮由主题决定`,
    tableMergedMd: (n: number) => `含合并单元格的表格保留为 HTML 表格 ${n} 个`,
    tableMergedHtml: (n: number) =>
      `含合并单元格的表格以 HTML 提交 ${n} 个，显示不正常时请转成图片`,
    table: (n: number) => `表格以 HTML 提交 ${n} 个`,
    mathLiquid: (n: number) => `公式转为 katex liquid tag ${n} 处`,
    mathDollar: (n: number) => `公式保留 $…$ 写法 ${n} 处，显示效果以平台为准`,
    mathTex: (n: number) => `公式暂以 TeX 源码提交 ${n} 处（转图片尚未接入）`,
    youtube: (n: number) => `YouTube 视频转为 youtube liquid tag ${n} 处`,
    video: (n: number) => `视频改为链接 ${n} 处`,
    link: (n: number) => `外链原样保留 ${n} 处`,
    imageAbsolute: (n: number) => `图片地址补全为绝对地址 ${n} 处`,
    highlight: (platform: string, n: number) => `${platform} 不支持高亮标记，已去掉 ${n} 处`,
  },
  text: {
    titleTruncated: (platform: string, max: number) =>
      `标题超过 ${platform} 上限 ${max} 字，已截短`,
    summaryTruncated: (platform: string, max: number) =>
      `摘要超过 ${platform} 上限 ${max} 字，已截短`,
    tagsMapped: (platform: string, n: number) => `标签按 ${platform} 规则改写 ${n} 个`,
    tagsOver: (platform: string, max: number) =>
      `${platform} 最多 ${max} 个标签，已截断为 ${max} 个`,
    tagsUnusable: (n: number) => `${n} 个标签不符合平台规则被去掉`,
    separator: '；',
  },
  errors: {
    rebind: (platform: string) => `重新绑定${platform}`,
    viewGuide: '查看发布指南',
    revoked: (platform: string) => `${platform} 拒绝了授权：凭据无效、已过期或已撤销，请重新绑定`,
    waitThenRetry: (wait: string) => `，请约 ${wait}后重试`,
    retryLater: '，请稍后重试',
    rateLimited: (platform: string, wait: string, detail: string) =>
      `${platform} 请求太频繁（429）${wait}${detail ? `：${detail}` : ''}`,
    forbidden: '没有权限',
    notFound: '找不到资源',
    tooLarge: '内容太大',
    serverError: '平台服务出错',
    rejected: '请求被拒绝',
    http: (platform: string, hint: string, status: number, message: string) =>
      `${platform} ${hint}（HTTP ${status}）${message ? `：${message}` : ''}`,
    writeInterrupted: (platform: string, why: string) =>
      `连接 ${platform} 中断，不确定是否已发出：请先到平台确认，没有再重发（${why}）`,
    unreachable: (platform: string, why: string) => `连不上 ${platform}：${why}`,
  },
  relay: {
    inProgress: (platform: string) =>
      `${platform} 的上一次发布请求还在进行中，结果未知：请稍后到平台确认`,
    unknown: (platform: string, status: number) =>
      `${platform} 的发布请求结果未知（HTTP ${status}）：可能已经发出，请先到平台确认，没有再重发`,
    unreadable: (platform: string, status: number) =>
      `${platform} 的发布请求已被受理，但返回内容无法读取（HTTP ${status}）：请先到平台确认，没有再重发`,
    serverInterrupted: (platform: string) =>
      `连接辰记服务器中断，不确定${platform}是否已发出：请先到平台确认，没有再重发`,
    serverUnreachable: (why: string) => `连不上辰记服务器：${why}`,
    publishFailed: (platform: string) => `${platform} 发布失败`,
    commentFailed: (platform: string) => `${platform} 链接评论发送失败`,
    statusUnknown: (platform: string) => `${platform} 状态查询返回了无法识别的结果`,
    statusUnreadable: (platform: string) => `${platform} 状态查询返回了无法读取的内容`,
    statusFailed: (platform: string) => `${platform} 状态查询失败`,
  },
  oauth: {
    noCrypto: '当前环境没有 WebCrypto，无法发起授权',
    httpFailed: (status: number) => `授权请求失败（HTTP ${status}）`,
    stateMismatch: '授权回跳与本次请求不匹配，请重新授权',
  },
};

export type KitMessages = typeof zhCN;

const zhTW: KitMessages = {
  canonicalMissing:
    '還沒有辰記原文連結，這次沒有設定 canonical（先發布到辰記再同步，可以把搜尋權重留給原文）',
  canonicalTo: (url) => `設定 canonical 指向 ${url}`,
  canonicalBack: '設定 canonical 指回辰記原文',
  relayNote: '由伺服器代發（憑證只在伺服器）',
  imagesLinked: (n, platform) => `${n} 張圖片以辰記圖片連結引用（${platform} 直接載入外部連結）`,
  shortMissingLink: (platform) =>
    `還沒有辰記原文連結，${platform} 貼文裡沒有連結（先發布到辰記再同步，可以附上原文卡片）`,
  newPost: '這次發出的是一則新貼文（不修改之前發過的）',
  linkPlacementLabel: '原文連結',
  linkFirstComment: '原文連結不放在內文，發文後作為第一則留言發出',
  degrade: {
    callout: (n) => `提示框降級為引用區塊 ${n} 處`,
    heading: (n) => `徽章 / 裝飾標題改為一般標題 ${n} 處`,
    headingLevel: (n) => `標題層級調整為二、三級 ${n} 處`,
    divider: (n) => `波浪線等裝飾分隔線改為一般分隔線 ${n} 處`,
    quote: (n) => `裝飾引用改為一般引用 ${n} 處`,
    codeFenced: (n, platform) =>
      `程式碼區塊輸出為標註語言的圍欄程式碼 ${n} 處，語法醒目由 ${platform} 呈現`,
    codeKept: (n) => `程式碼區塊保留語言標記 ${n} 處，語法醒目由佈景主題決定`,
    tableMergedMd: (n) => `含合併儲存格的表格保留為 HTML 表格 ${n} 個`,
    tableMergedHtml: (n) => `含合併儲存格的表格以 HTML 送出 ${n} 個，顯示不正常時請轉成圖片`,
    table: (n) => `表格以 HTML 送出 ${n} 個`,
    mathLiquid: (n) => `公式轉為 katex liquid tag ${n} 處`,
    mathDollar: (n) => `公式保留 $…$ 寫法 ${n} 處，顯示效果以平台為準`,
    mathTex: (n) => `公式暫以 TeX 原始碼送出 ${n} 處（轉圖片尚未接入）`,
    youtube: (n) => `YouTube 影片轉為 youtube liquid tag ${n} 處`,
    video: (n) => `影片改為連結 ${n} 處`,
    link: (n) => `外部連結原樣保留 ${n} 處`,
    imageAbsolute: (n) => `圖片網址補全為絕對網址 ${n} 處`,
    highlight: (platform, n) => `${platform} 不支援螢光標記，已移除 ${n} 處`,
  },
  text: {
    titleTruncated: (platform, max) => `標題超過 ${platform} 上限 ${max} 字，已截短`,
    summaryTruncated: (platform, max) => `摘要超過 ${platform} 上限 ${max} 字，已截短`,
    tagsMapped: (platform, n) => `標籤依 ${platform} 規則改寫 ${n} 個`,
    tagsOver: (platform, max) => `${platform} 最多 ${max} 個標籤，已截斷為 ${max} 個`,
    tagsUnusable: (n) => `${n} 個標籤不符合平台規則，已移除`,
    separator: '；',
  },
  errors: {
    rebind: (platform) => `重新綁定${platform}`,
    viewGuide: '查看發布指南',
    revoked: (platform) => `${platform} 拒絕了授權：憑證無效、已過期或已撤銷，請重新綁定`,
    waitThenRetry: (wait) => `，請約 ${wait}後重試`,
    retryLater: '，請稍後重試',
    rateLimited: (platform, wait, detail) =>
      `${platform} 請求太頻繁（429）${wait}${detail ? `：${detail}` : ''}`,
    forbidden: '沒有權限',
    notFound: '找不到資源',
    tooLarge: '內容太大',
    serverError: '平台服務出錯',
    rejected: '請求被拒絕',
    http: (platform, hint, status, message) =>
      `${platform} ${hint}（HTTP ${status}）${message ? `：${message}` : ''}`,
    writeInterrupted: (platform, why) =>
      `與 ${platform} 的連線中斷，不確定是否已發出：請先到平台確認，沒有再重發（${why}）`,
    unreachable: (platform, why) => `連不上 ${platform}：${why}`,
  },
  relay: {
    inProgress: (platform) => `${platform} 的上一次發布請求還在進行中，結果不明：請稍後到平台確認`,
    unknown: (platform, status) =>
      `${platform} 的發布請求結果不明（HTTP ${status}）：可能已經發出，請先到平台確認，沒有再重發`,
    unreadable: (platform, status) =>
      `${platform} 的發布請求已被受理，但回傳內容無法讀取（HTTP ${status}）：請先到平台確認，沒有再重發`,
    serverInterrupted: (platform) =>
      `與辰記伺服器的連線中斷，不確定${platform}是否已發出：請先到平台確認，沒有再重發`,
    serverUnreachable: (why) => `連不上辰記伺服器：${why}`,
    publishFailed: (platform) => `${platform} 發布失敗`,
    commentFailed: (platform) => `${platform} 連結留言發送失敗`,
    statusUnknown: (platform) => `${platform} 狀態查詢回傳了無法辨識的結果`,
    statusUnreadable: (platform) => `${platform} 狀態查詢回傳了無法讀取的內容`,
    statusFailed: (platform) => `${platform} 狀態查詢失敗`,
  },
  oauth: {
    noCrypto: '目前環境沒有 WebCrypto，無法發起授權',
    httpFailed: (status) => `授權請求失敗（HTTP ${status}）`,
    stateMismatch: '授權回跳與這次請求不符，請重新授權',
  },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const en: KitMessages = {
  canonicalMissing:
    'No StarNote original yet, so no canonical link was set (publish to StarNote first to keep search ranking with the original)',
  canonicalTo: (url) => `Canonical link set to ${url}`,
  canonicalBack: 'Canonical link set to the StarNote original',
  relayNote: 'Sent by the server (the credential stays on the server)',
  imagesLinked: (n, platform) =>
    `${plural(n, 'image')} linked from StarNote (${platform} loads them directly)`,
  shortMissingLink: (platform) =>
    `No StarNote original yet, so the ${platform} post has no link (publish to StarNote first to include the article card)`,
  newPost: 'This is posted as a new post (the earlier one isn’t changed)',
  linkPlacementLabel: 'Article link',
  linkFirstComment: 'The article link isn’t in the post; it’s posted as the first comment',
  degrade: {
    callout: (n) => `${plural(n, 'callout')} turned into quotes`,
    heading: (n) => `${plural(n, 'badge / decorated heading')} turned into plain headings`,
    headingLevel: (n) => `${plural(n, 'heading')} moved to level 2/3`,
    divider: (n) => `${plural(n, 'decorative divider')} (wavy etc.) turned into plain dividers`,
    quote: (n) => `${plural(n, 'decorated quote')} turned into plain quotes`,
    codeFenced: (n, platform) =>
      `${plural(n, 'code block')} written as fenced code with its language; ${platform} highlights it`,
    codeKept: (n) => `${plural(n, 'code block')} keep their language; the theme highlights them`,
    tableMergedMd: (n) => `${plural(n, 'table')} with merged cells kept as HTML tables`,
    tableMergedHtml: (n) =>
      `${plural(n, 'table')} with merged cells sent as HTML; turn them into images if they look wrong`,
    table: (n) => `${plural(n, 'table')} sent as HTML`,
    mathLiquid: (n) => `${plural(n, 'formula', 'formulas')} turned into katex liquid tags`,
    mathDollar: (n) =>
      `${plural(n, 'formula', 'formulas')} kept as $…$; how they look depends on the platform`,
    mathTex: (n) =>
      `${plural(n, 'formula', 'formulas')} sent as TeX source for now (images aren’t supported yet)`,
    youtube: (n) => `${plural(n, 'YouTube video')} turned into youtube liquid tags`,
    video: (n) => `${plural(n, 'video')} turned into links`,
    link: (n) => `${plural(n, 'external link')} kept as is`,
    imageAbsolute: (n) => `${plural(n, 'image URL')} made absolute`,
    highlight: (platform, n) =>
      `${platform} doesn’t support highlights; ${plural(n, 'highlight')} removed`,
  },
  text: {
    titleTruncated: (platform, max) =>
      `Title is over ${platform}’s limit of ${max} characters and was shortened`,
    summaryTruncated: (platform, max) =>
      `Summary is over ${platform}’s limit of ${max} characters and was shortened`,
    tagsMapped: (platform, n) => `${plural(n, 'tag')} rewritten to fit ${platform}’s rules`,
    tagsOver: (platform, max) => `${platform} allows at most ${max} tags; cut to ${max}`,
    tagsUnusable: (n) => `${plural(n, 'tag')} dropped for not fitting the platform’s rules`,
    separator: '; ',
  },
  errors: {
    rebind: (platform) => `Reconnect ${platform}`,
    viewGuide: 'View the publishing guide',
    revoked: (platform) =>
      `${platform} refused the authorization: the credential is invalid, expired or revoked. Reconnect the account`,
    waitThenRetry: (wait) => `; retry in about ${wait}`,
    retryLater: '; retry later',
    rateLimited: (platform, wait, detail) =>
      `Too many requests to ${platform} (429)${wait}${detail ? `: ${detail}` : ''}`,
    forbidden: 'permission denied',
    notFound: 'not found',
    tooLarge: 'content too large',
    serverError: 'platform error',
    rejected: 'request rejected',
    http: (platform, hint, status, message) =>
      `${platform}: ${hint} (HTTP ${status})${message ? `: ${message}` : ''}`,
    writeInterrupted: (platform, why) =>
      `The connection to ${platform} dropped and it’s unclear whether it was posted: check on the platform first and only send again if it isn’t there (${why})`,
    unreachable: (platform, why) => `Can’t reach ${platform}: ${why}`,
  },
  relay: {
    inProgress: (platform) =>
      `The previous publish request to ${platform} is still running and its result is unknown: check on the platform later`,
    unknown: (platform, status) =>
      `The result of the publish request to ${platform} is unknown (HTTP ${status}): it may have been posted, so check on the platform first and only send again if it isn’t there`,
    unreadable: (platform, status) =>
      `The publish request to ${platform} was accepted, but its answer can’t be read (HTTP ${status}): check on the platform first and only send again if it isn’t there`,
    serverInterrupted: (platform) =>
      `The connection to the StarNote server dropped and it’s unclear whether ${platform} got the post: check on the platform first and only send again if it isn’t there`,
    serverUnreachable: (why) => `Can’t reach the StarNote server: ${why}`,
    publishFailed: (platform) => `Publishing to ${platform} failed`,
    commentFailed: (platform) => `Posting the link comment on ${platform} failed`,
    statusUnknown: (platform) => `The ${platform} status check returned an unrecognized result`,
    statusUnreadable: (platform) => `The ${platform} status check returned an unreadable answer`,
    statusFailed: (platform) => `The ${platform} status check failed`,
  },
  oauth: {
    noCrypto: 'WebCrypto isn’t available here, so authorization can’t start',
    httpFailed: (status) => `The authorization request failed (HTTP ${status})`,
    stateMismatch: 'The authorization callback doesn’t match this request: authorize again',
  },
};

/** The kit's messages: `kitMessages(lang).relay.publishFailed('DEV')`. */
export const kitMessages = defineMessages<KitMessages>({ 'zh-CN': zhCN, 'zh-TW': zhTW, en });

/** 「30 秒」 / 「2 minutes」 */
export function waitText(sec: number, lang?: SdkLang | string): string {
  const w = coreMessages(lang).wait;
  if (sec < 60) return w.seconds(Math.max(1, Math.round(sec)));
  if (sec < 3600) return w.minutes(Math.round(sec / 60));
  return w.hours(Math.round(sec / 3600));
}

/**
 * A `PlatformRef` in `lang`: its label becomes the registry's name in that language and `lang` rides along, so
 * every error / action built from it speaks the user's language. Without `lang`, `p` unchanged.
 */
export function refIn<P extends { key: string; label: string; lang?: SdkLang }>(
  p: P,
  lang?: SdkLang
): P {
  if (!lang || p.lang === lang) return p;
  return { ...p, label: localizedLabel(p.key, p.label, lang), lang };
}
