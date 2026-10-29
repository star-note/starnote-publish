/** SPEC-r14 B5: the Hashnode adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    publicationFormat: '博客 ID 是 24 位十六进制',
    publication: '博客',
    mode: '发布方式',
    subtitle: '副标题',
    slugFormat: '只能用小写字母、数字和 -',
    slug: '网址',
    enableToc: '显示目录',
    seriesFormat: '系列 ID 是 24 位十六进制',
    series: '系列',
    setCanonical: '设置原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    idFormat: '文章 ID 是 24 位十六进制',
    externalId: '已发布文章 ID',
  },
  key: { tokenHint: '请粘贴 Hashnode 开发者设置页生成的令牌', token: '个人访问令牌' },
  binding: [
    '打开 hashnode.com/settings/developer，生成一个新令牌并复制',
    '粘贴到这里并点「测试连接」；有多个博客时选要发到哪一个',
    '注意：Hashnode 要求博客开通 Pro 才能通过接口发文',
  ],
  /** `hashnodeBinding.selects[0].title` (`publication_id`). */
  selectPublication: '发布到哪个博客',
  draftOnly: '以未公开状态保存到 Hashnode，检查后在 Hashnode 后台发布',
  tooLarge: (kb: number) => `正文太长：Hashnode 单次请求最多 100 KB，这篇约 ${kb} KB`,
  relaying: '由服务器代发到 Hashnode',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      publicationFormat: '部落格 ID 是 24 位十六進位',
      publication: '部落格',
      mode: '發布方式',
      subtitle: '副標題',
      slugFormat: '只能用小寫字母、數字和 -',
      slug: '網址',
      enableToc: '顯示目錄',
      seriesFormat: '系列 ID 是 24 位十六進位',
      series: '系列',
      setCanonical: '設定原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      idFormat: '文章 ID 是 24 位十六進位',
      externalId: '已發布文章 ID',
    },
    key: { tokenHint: '請貼上 Hashnode 開發者設定頁產生的權杖', token: '個人存取權杖' },
    binding: [
      '開啟 hashnode.com/settings/developer，產生一個新權杖並複製',
      '貼到這裡並按「測試連線」；有多個部落格時選要發到哪一個',
      '注意：Hashnode 要求部落格開通 Pro 才能透過 API 發文',
    ],
    selectPublication: '發布到哪個部落格',
    draftOnly: '以未公開狀態儲存到 Hashnode，檢查後在 Hashnode 後台發布',
    tooLarge: (kb) => `內文太長：Hashnode 單次請求最多 100 KB，這篇約 ${kb} KB`,
    relaying: '由伺服器代發到 Hashnode',
    done: '完成',
  },
  en: {
    form: {
      publicationFormat: 'A blog ID is 24 hexadecimal characters',
      publication: 'Blog',
      mode: 'Publish as',
      subtitle: 'Subtitle',
      slugFormat: 'Only lowercase letters, digits and -',
      slug: 'URL slug',
      enableToc: 'Show table of contents',
      seriesFormat: 'A series ID is 24 hexadecimal characters',
      series: 'Series',
      setCanonical: 'Set the canonical link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Canonical link',
      idFormat: 'An article ID is 24 hexadecimal characters',
      externalId: 'Published article ID',
    },
    key: {
      tokenHint: 'Paste the token generated on Hashnode’s developer settings page',
      token: 'Personal access token',
    },
    binding: [
      'Open hashnode.com/settings/developer, generate a new token and copy it',
      'Paste it here and click “Test connection”; with several blogs, pick the one to publish to',
      'Note: Hashnode only lets blogs on Pro publish through the API',
    ],
    selectPublication: 'Blog to publish to',
    draftOnly: 'Saved to Hashnode unpublished: check it, then publish from the Hashnode dashboard',
    tooLarge: (kb) =>
      `The article is too long: Hashnode takes at most 100 KB per request, this one is about ${kb} KB`,
    relaying: 'Sending to Hashnode through the server',
    done: 'Done',
  },
});
