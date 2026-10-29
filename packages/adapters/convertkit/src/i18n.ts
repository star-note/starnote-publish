/** SPEC-r14 B5: the Kit adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    send: '发送方式',
    isoTime: '请填写带时区的时间，如 2026-11-01T09:00:00+08:00',
    sendAt: '定时发送时间',
    public: '同时发布到 Kit 网页',
    originNote: '文末注明原文',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    idDigits: '广播 ID 是数字',
    externalId: '已建广播 ID',
  },
  key: { apiKeyHint: '请粘贴 Kit 设置 → Developer 里生成的 v4 API key', apiKey: 'API key' },
  binding: [
    '打开 Kit 的 Settings → Developer，点「Add a new key」，起名「StarNote」',
    'Kit 只显示一次 key：立刻复制，粘贴到这里并点「测试连接」',
    '辰记默认把文章存为 Kit 的草稿（broadcast），由你在 Kit 里检查后发送；不用时在同一页删除 key',
  ],
  originNote: '邮件末尾注明首发于辰记并附原文链接',
  scheduleMissing: '定时发送需要填写发送时间',
  scheduled: (at: string) => `Kit 将在 ${at} 发给订阅者（默认全部订阅者）`,
  draftOnly: '存为 Kit 草稿，在 Kit 里检查收件人后发送',
  relaying: '由服务器代发到 Kit',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      send: '發送方式',
      isoTime: '請填寫含時區的時間，例如 2026-11-01T09:00:00+08:00',
      sendAt: '排程發送時間',
      public: '同時發布到 Kit 網頁',
      originNote: '文末註明原文',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      idDigits: '廣播 ID 是數字',
      externalId: '已建立的廣播 ID',
    },
    key: { apiKeyHint: '請貼上 Kit 設定 → Developer 裡產生的 v4 API key', apiKey: 'API key' },
    binding: [
      '開啟 Kit 的 Settings → Developer，按「Add a new key」，命名為「StarNote」',
      'Kit 只顯示一次 key：立刻複製，貼到這裡並按「測試連線」',
      '辰記預設把文章存為 Kit 的草稿（broadcast），由你在 Kit 裡檢查後發送；不用時在同一頁刪除 key',
    ],
    originNote: '郵件末尾註明首發於辰記並附上原文連結',
    scheduleMissing: '排程發送需要填寫發送時間',
    scheduled: (at) => `Kit 將在 ${at} 寄給訂閱者（預設為全部訂閱者）`,
    draftOnly: '存為 Kit 草稿，在 Kit 裡檢查收件人後發送',
    relaying: '由伺服器代發到 Kit',
    done: '完成',
  },
  en: {
    form: {
      send: 'Sending',
      isoTime: 'Enter a time with a time zone, e.g. 2026-11-01T09:00:00+08:00',
      sendAt: 'Scheduled send time',
      public: 'Also publish on the Kit web feed',
      originNote: 'Credit the original at the end',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Canonical link',
      idDigits: 'The broadcast ID is a number',
      externalId: 'Existing broadcast ID',
    },
    key: {
      apiKeyHint: 'Paste the v4 API key generated under Kit Settings → Developer',
      apiKey: 'API key',
    },
    binding: [
      'In Kit, open Settings → Developer, click “Add a new key” and name it “StarNote”',
      'Kit shows the key only once: copy it right away, paste it here and click “Test connection”',
      'StarNote saves articles as Kit drafts (broadcasts) by default, for you to check and send in Kit; delete the key on the same page when you no longer need it',
    ],
    originNote:
      'Added a line at the end of the email saying it first appeared on StarNote, with the link',
    scheduleMissing: 'A scheduled send needs a send time',
    scheduled: (at) => `Kit will send it to subscribers at ${at} (all subscribers by default)`,
    draftOnly: 'Saved as a Kit draft: check the recipients in Kit, then send',
    relaying: 'Sending to Kit through the server',
    done: 'Done',
  },
});
