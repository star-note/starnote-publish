/** SPEC-r14 B5: the Discord adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    text: '附言',
    httpUrl: '请填写以 http(s):// 开头的地址',
    link: '链接',
    includeSummary: '卡片带摘要',
    withCover: '卡片带封面图',
    username: '显示名称',
    webhookHint: '请粘贴 https://discord.com/api/webhooks/… 形式的 Webhook 地址',
    webhook: 'Webhook 地址',
  },
  permissions: ['在频道设置里「管理 Webhook」的权限'],
  binding: [
    '打开要发到的频道 → 编辑频道 → 整合（Integrations）→ Webhook → 新 Webhook',
    '给它起个名字、选好头像，点「复制 Webhook URL」，粘贴到这里',
    '地址相当于发帖凭据：加密存在辰记服务器，不要发给别人；不用时在 Discord 里删除这个 Webhook',
  ],
  titleTruncated: (max: number) => `Discord 卡片标题最多 ${max} 字，已截短`,
  summaryTruncated: (max: number) => `卡片摘要按 ${max} 字截短`,
  messageTruncated: (max: number) => `Discord 消息最多 ${max} 字，已截短`,
  card: '以卡片发出：标题链接到原文',
  noMentions: '不会 @ 任何人（发送时关闭 allowed_mentions）',
  handoff: '还没有绑定 Discord Webhook：文案已备好，请到频道里粘贴发出',
  empty: '消息是空的',
  sending: '经 Webhook 发到 Discord',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      text: '附言',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      link: '連結',
      includeSummary: '卡片附上摘要',
      withCover: '卡片附上封面圖',
      username: '顯示名稱',
      webhookHint: '請貼上 https://discord.com/api/webhooks/… 格式的 Webhook 網址',
      webhook: 'Webhook 網址',
    },
    permissions: ['頻道設定裡「管理 Webhook」的權限'],
    binding: [
      '開啟要發到的頻道 → 編輯頻道 → 整合（Integrations）→ Webhook → 新 Webhook',
      '幫它取個名字、選好頭像，按「複製 Webhook URL」，貼到這裡',
      '網址等同於發文憑證：加密存在辰記伺服器，不要傳給別人；不用時在 Discord 裡刪除這個 Webhook',
    ],
    titleTruncated: (max) => `Discord 卡片標題最多 ${max} 字，已截短`,
    summaryTruncated: (max) => `卡片摘要依 ${max} 字截短`,
    messageTruncated: (max) => `Discord 訊息最多 ${max} 字，已截短`,
    card: '以卡片發出：標題連結到原文',
    noMentions: '不會 @ 任何人（傳送時關閉 allowed_mentions）',
    handoff: '還沒有綁定 Discord Webhook：文案已備好，請到頻道裡貼上發出',
    empty: '訊息是空的',
    sending: '經 Webhook 發到 Discord',
    done: '完成',
  },
  en: {
    form: {
      text: 'Note above the card',
      httpUrl: 'Enter a URL starting with http(s)://',
      link: 'Link',
      includeSummary: 'Summary in the card',
      withCover: 'Cover image in the card',
      username: 'Display name',
      webhookHint: 'Paste a webhook URL like https://discord.com/api/webhooks/…',
      webhook: 'Webhook URL',
    },
    permissions: ['The “Manage Webhooks” permission in the channel settings'],
    binding: [
      'Open the channel to post to → Edit Channel → Integrations → Webhooks → New Webhook',
      'Give it a name and an avatar, click “Copy Webhook URL” and paste it here',
      'The URL works like a posting credential: it’s stored encrypted on the StarNote server, so don’t share it; delete the webhook in Discord when you no longer need it',
    ],
    titleTruncated: (max) => `A Discord card title can be at most ${max} characters; shortened`,
    summaryTruncated: (max) => `Card summary shortened to ${max} characters`,
    messageTruncated: (max) => `A Discord message can be at most ${max} characters; shortened`,
    card: 'Sent as a card whose title links to the original',
    noMentions: 'Won’t @mention anyone (allowed_mentions is off when sending)',
    handoff:
      'No Discord webhook connected yet: the text is ready, paste it into the channel to post',
    empty: 'The message is empty',
    sending: 'Sending to Discord through the webhook',
    done: 'Done',
  },
});
