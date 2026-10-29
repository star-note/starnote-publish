/** SPEC-r14 B5: the Buttondown adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    status: '发送方式',
    isoTime: '请填写带时区的时间，如 2026-11-01T09:00:00+08:00',
    publishDate: '定时发送时间',
    slugRule: '只能用小写字母、数字和 -',
    slug: '网址',
    setCanonical: '设置原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    originNote: '文末注明原文',
    emailId: '邮件 ID 格式不对',
    externalId: '已建邮件 ID',
  },
  key: { apiKeyHint: '请粘贴 Buttondown 的 API key', apiKey: 'API key' },
  binding: [
    '打开 Buttondown 的 API requests 页（Settings → API），复制 API key',
    '粘贴到这里并点「测试连接」',
    '辰记只建草稿或定时邮件，不会直接群发；在 Buttondown 里检查后发送',
  ],
  originNote: '邮件末尾注明首发于辰记并附原文链接',
  scheduleMissing: '定时发送需要填写时间',
  scheduled: (at: string | undefined) => `Buttondown 将在 ${at ?? '指定时间'} 发给订阅者`,
  draftOnly: '存为 Buttondown 草稿，在 Buttondown 里检查后发送',
  relaying: '由服务器代发到 Buttondown',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      status: '發送方式',
      isoTime: '請填寫含時區的時間，例如 2026-11-01T09:00:00+08:00',
      publishDate: '排程發送時間',
      slugRule: '只能使用小寫字母、數字和 -',
      slug: '網址',
      setCanonical: '設定原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      originNote: '文末註明原文',
      emailId: '郵件 ID 格式不正確',
      externalId: '已建立的郵件 ID',
    },
    key: { apiKeyHint: '請貼上 Buttondown 的 API key', apiKey: 'API key' },
    binding: [
      '開啟 Buttondown 的 API requests 頁面（Settings → API），複製 API key',
      '貼到這裡並按「測試連線」',
      '辰記只建立草稿或排程郵件，不會直接群發；請在 Buttondown 裡檢查後發送',
    ],
    originNote: '郵件末尾註明首發於辰記並附上原文連結',
    scheduleMissing: '排程發送需要填寫時間',
    scheduled: (at) => `Buttondown 將在 ${at ?? '指定時間'} 寄給訂閱者`,
    draftOnly: '存為 Buttondown 草稿，在 Buttondown 裡檢查後發送',
    relaying: '由伺服器代發到 Buttondown',
    done: '完成',
  },
  en: {
    form: {
      status: 'Sending',
      isoTime: 'Enter a time with a time zone, e.g. 2026-11-01T09:00:00+08:00',
      publishDate: 'Scheduled send time',
      slugRule: 'Only lowercase letters, digits and -',
      slug: 'URL slug',
      setCanonical: 'Set the canonical link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Canonical link',
      originNote: 'Credit the original at the end',
      emailId: 'Invalid email ID',
      externalId: 'Existing email ID',
    },
    key: { apiKeyHint: 'Paste your Buttondown API key', apiKey: 'API key' },
    binding: [
      'Open Buttondown’s API requests page (Settings → API) and copy the API key',
      'Paste it here and click “Test connection”',
      'StarNote only creates drafts or scheduled emails and never sends right away; check and send in Buttondown',
    ],
    originNote:
      'Added a line at the end of the email saying it first appeared on StarNote, with the link',
    scheduleMissing: 'A scheduled send needs a time',
    scheduled: (at) => `Buttondown will send it to subscribers at ${at ?? 'the chosen time'}`,
    draftOnly: 'Saved as a Buttondown draft: check it in Buttondown, then send',
    relaying: 'Sending to Buttondown through the server',
    done: 'Done',
  },
});
