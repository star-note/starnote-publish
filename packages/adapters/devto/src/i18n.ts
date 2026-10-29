/** SPEC-r14 B5: the DEV adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    published: '直接公开',
    seriesMax: '系列名最多 100 字',
    series: '系列',
    setCanonical: '设置原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    originNote: '文末注明原文',
    organizationId: '组织 ID',
    idDigits: '文章 ID 是数字',
    externalId: '已发布文章 ID',
  },
  key: { apiKeyHint: '请粘贴 DEV 设置页生成的 API key', apiKey: 'API key' },
  binding: [
    '打开 DEV 的 Settings → Extensions，在 DEV Community API Keys 填一个名字（如 StarNote）生成 key',
    '复制 key，粘贴到这里并点「测试连接」',
    '不用时在同一页删除这个 key，绑定立即失效',
  ],
  originNote: '文末加上「Originally published at」原文链接',
  draftOnly: '以未公开状态保存到 DEV，检查后在 DEV 上点 Publish',
  relaying: '由服务器代发到 DEV',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      published: '直接公開',
      seriesMax: '系列名稱最多 100 字',
      series: '系列',
      setCanonical: '設定原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      originNote: '文末註明原文',
      organizationId: '組織 ID',
      idDigits: '文章 ID 是數字',
      externalId: '已發布文章 ID',
    },
    key: { apiKeyHint: '請貼上 DEV 設定頁產生的 API key', apiKey: 'API key' },
    binding: [
      '開啟 DEV 的 Settings → Extensions，在 DEV Community API Keys 填一個名稱（如 StarNote）產生 key',
      '複製 key，貼到這裡並按「測試連線」',
      '不用時在同一頁刪除這個 key，綁定立即失效',
    ],
    originNote: '文末加上「Originally published at」原文連結',
    draftOnly: '以未公開狀態儲存到 DEV，檢查後在 DEV 上按 Publish',
    relaying: '由伺服器代發到 DEV',
    done: '完成',
  },
  en: {
    form: {
      published: 'Publish right away',
      seriesMax: 'Series name can be at most 100 characters',
      series: 'Series',
      setCanonical: 'Set the canonical link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Canonical link',
      originNote: 'Credit the original at the end',
      organizationId: 'Organization ID',
      idDigits: 'The article ID is a number',
      externalId: 'Published article ID',
    },
    key: { apiKeyHint: 'Paste the API key generated on DEV’s settings page', apiKey: 'API key' },
    binding: [
      'On DEV, open Settings → Extensions and generate a key under DEV Community API Keys with a name (e.g. StarNote)',
      'Copy the key, paste it here and click “Test connection”',
      'When you no longer need it, delete the key on the same page; the connection stops working at once',
    ],
    originNote: 'Added an “Originally published at” link at the end',
    draftOnly: 'Saved to DEV unpublished: check it, then click Publish on DEV',
    relaying: 'Sending to DEV through the server',
    done: 'Done',
  },
});
