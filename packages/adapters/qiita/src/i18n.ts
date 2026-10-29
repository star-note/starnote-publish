/** SPEC-r14 B5: the Qiita adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    private: '限定共有（不公开）',
    originNote: '文末注明原文',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    orgRule: '组织名只能用字母、数字、_ 和 -',
    organization: 'Organization',
    itemId: '文章 ID 是 20 位十六进制',
    externalId: '已发布文章 ID',
  },
  key: { tokenHint: '请粘贴 Qiita 设置页生成的 40 位访问令牌', token: 'アクセストークン' },
  binding: [
    '打开 Qiita 的 設定 → アプリケーション，在「個人用アクセストークン」点「新しくトークンを発行する」',
    '说明填「StarNote」，勾选 read_qiita 和 write_qiita，生成后复制令牌',
    '粘贴到这里并点「测试连接」；不用时在同一页删除令牌，绑定立即失效',
  ],
  originNote: '文末注明首发于辰记并附原文链接（Qiita 没有 canonical 字段）',
  tagsRequired: 'Qiita 至少要 1 个标签，请在标签里填写技术名（如 Python、TypeScript）',
  private: '以「限定共有」发出：只有拿到链接的人能看，可以在 Qiita 上改为公开',
  relaying: '由服务器代发到 Qiita',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      private: '限定共有（不公開）',
      originNote: '文末註明原文',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      orgRule: '組織名稱只能使用字母、數字、_ 和 -',
      organization: 'Organization',
      itemId: '文章 ID 是 20 位十六進位',
      externalId: '已發布文章 ID',
    },
    key: { tokenHint: '請貼上 Qiita 設定頁產生的 40 位存取權杖', token: 'アクセストークン' },
    binding: [
      '開啟 Qiita 的 設定 → アプリケーション，在「個人用アクセストークン」按「新しくトークンを発行する」',
      '說明填「StarNote」，勾選 read_qiita 和 write_qiita，產生後複製權杖',
      '貼到這裡並按「測試連線」；不用時在同一頁刪除權杖，綁定立即失效',
    ],
    originNote: '文末註明首發於辰記並附上原文連結（Qiita 沒有 canonical 欄位）',
    tagsRequired: 'Qiita 至少要 1 個標籤，請在標籤裡填寫技術名稱（如 Python、TypeScript）',
    private: '以「限定共有」發出：只有拿到連結的人能看，可以在 Qiita 上改為公開',
    relaying: '由伺服器代發到 Qiita',
    done: '完成',
  },
  en: {
    form: {
      private: 'Limited sharing (限定共有, not public)',
      originNote: 'Credit the original at the end',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Canonical link',
      orgRule: 'The organization name can only use letters, digits, _ and -',
      organization: 'Organization',
      itemId: 'The article ID is 20 hexadecimal characters',
      externalId: 'Published article ID',
    },
    key: {
      tokenHint: 'Paste the 40-character access token generated in Qiita’s settings',
      token: 'Access token',
    },
    binding: [
      'In Qiita, open 設定 → アプリケーション (Settings → Applications) and click 新しくトークンを発行する (issue a new token) under 個人用アクセストークン (personal access tokens)',
      'Describe it as “StarNote”, tick read_qiita and write_qiita, generate it and copy the token',
      'Paste it here and click “Test connection”; delete the token on the same page when you no longer need it, and the connection stops at once',
    ],
    originNote:
      'Added a line at the end saying it first appeared on StarNote, with the link (Qiita has no canonical field)',
    tagsRequired:
      'Qiita needs at least 1 tag: add technology names as tags (e.g. Python, TypeScript)',
    private:
      'Posted as limited sharing (限定共有): only people with the link can read it; you can make it public on Qiita',
    relaying: 'Sending to Qiita through the server',
    done: 'Done',
  },
});
