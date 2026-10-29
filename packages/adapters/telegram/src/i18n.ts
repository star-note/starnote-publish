/** SPEC-r14 B5: the Telegram adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    text: '消息文案',
    httpUrl: '请填写以 http(s):// 开头的地址',
    link: '链接',
    includeSummary: '带上摘要',
    includeTags: '带上话题',
    withCover: '带封面图',
    silent: '静默发送',
    tokenHint: '机器人令牌形如 123456789:AA…（在 @BotFather 里获取）',
    token: '机器人令牌',
    chatHint: '填写 @频道用户名，或数字 ID（私有频道 / 群）',
    chat: '频道 / 群',
  },
  permissions: [
    '频道：把机器人设为管理员，并打开「发布消息」权限',
    '群组：把机器人拉进群（建议设为管理员）',
  ],
  binding: [
    '在 Telegram 里找 @BotFather，发送 /newbot 创建机器人，复制它给的令牌',
    '把机器人加进你的频道（或群），设为管理员并允许「发布消息」',
    '填写令牌和频道：公开频道写 @用户名，私有频道 / 群写数字 ID（以 -100 开头）',
    '令牌加密存在辰记服务器，用来到点代发；不用时在这里解绑，并可在 @BotFather 里 /revoke 令牌',
  ],
  truncated: (photo: boolean) =>
    `Telegram ${photo ? '图片说明最多 1024 字' : '消息最多 4096 字'}，已截短`,
  tagsTrimmed: (kept: number, dropped: number) => `话题保留 ${kept} 个，去掉 ${dropped} 个`,
  photoCard: '以封面图消息发出，文末附原文链接',
  linkCard: 'Telegram 会按链接生成预览卡片',
  empty: '消息是空的',
  sending: '由机器人发到 Telegram',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      text: '訊息文案',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      link: '連結',
      includeSummary: '附上摘要',
      includeTags: '附上主題標籤',
      withCover: '附上封面圖',
      silent: '靜音傳送',
      tokenHint: '機器人權杖格式如 123456789:AA…（在 @BotFather 取得）',
      token: '機器人權杖',
      chatHint: '填寫 @頻道使用者名稱，或數字 ID（私人頻道 / 群組）',
      chat: '頻道 / 群組',
    },
    permissions: [
      '頻道：把機器人設為管理員，並開啟「發布訊息」權限',
      '群組：把機器人加進群組（建議設為管理員）',
    ],
    binding: [
      '在 Telegram 裡找 @BotFather，傳送 /newbot 建立機器人，複製它給的權杖',
      '把機器人加進你的頻道（或群組），設為管理員並允許「發布訊息」',
      '填寫權杖和頻道：公開頻道寫 @使用者名稱，私人頻道 / 群組寫數字 ID（以 -100 開頭）',
      '權杖加密存在辰記伺服器，用來到時代發；不用時在這裡解除綁定，也可以在 @BotFather 裡 /revoke 權杖',
    ],
    truncated: (photo) => `Telegram ${photo ? '圖片說明最多 1024 字' : '訊息最多 4096 字'}，已截短`,
    tagsTrimmed: (kept, dropped) => `主題標籤保留 ${kept} 個，移除 ${dropped} 個`,
    photoCard: '以封面圖訊息發出，文末附上原文連結',
    linkCard: 'Telegram 會依連結產生預覽卡片',
    empty: '訊息是空的',
    sending: '由機器人發到 Telegram',
    done: '完成',
  },
  en: {
    form: {
      text: 'Message text',
      httpUrl: 'Enter a URL starting with http(s)://',
      link: 'Link',
      includeSummary: 'Include the summary',
      includeTags: 'Include hashtags',
      withCover: 'Include the cover image',
      silent: 'Send silently',
      tokenHint: 'A bot token looks like 123456789:AA… (get it from @BotFather)',
      token: 'Bot token',
      chatHint: 'Enter the @channel username, or a numeric ID (private channel / group)',
      chat: 'Channel / group',
    },
    permissions: [
      'Channel: make the bot an admin with the “Post messages” permission',
      'Group: add the bot to the group (making it an admin is recommended)',
    ],
    binding: [
      'In Telegram, message @BotFather with /newbot to create a bot, and copy the token it gives you',
      'Add the bot to your channel (or group) as an admin allowed to “Post messages”',
      'Enter the token and the channel: @username for a public channel, the numeric ID (starting with -100) for a private channel or group',
      'The token is stored encrypted on the StarNote server to send at the scheduled time; disconnect here when you no longer need it, and /revoke the token with @BotFather',
    ],
    truncated: (photo) =>
      `Telegram allows at most ${photo ? '1024 characters in a photo caption' : '4096 characters in a message'}; shortened`,
    tagsTrimmed: (kept, dropped) => `Kept ${kept} hashtags, dropped ${dropped}`,
    photoCard: 'Sent as a cover photo message with the article link at the end',
    linkCard: 'Telegram builds a preview card from the link',
    empty: 'The message is empty',
    sending: 'Sending to Telegram with your bot',
    done: 'Done',
  },
});
