/** SPEC-r14 B5: the Mastodon adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    instanceHint: '请填写实例域名，如 mastodon.social',
    instance: '实例',
    text: '嘟文',
    httpUrl: '请填写以 http(s):// 开头的地址',
    link: '链接',
    visibility: '可见范围',
    spoiler: '内容警告',
    sensitive: '敏感内容',
    includeSummary: '带上摘要',
    includeTags: '带上话题',
    idDigits: '嘟文 ID 是数字',
    externalId: '已发布嘟文 ID',
  },
  binding: [
    '填写你的实例域名（如 mastodon.social），点「授权」',
    '在实例页面登录并允许辰记发嘟文（辰记会自动在该实例登记应用，不需要你自己创建）',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到实例「设置 → 账户 → 授权的应用」撤销辰记',
  ],
  truncated: (limit: number, urlChars: number) =>
    `嘟文按实例上限 ${limit} 字截短（链接按 ${urlChars} 字计）`,
  tagsTrimmed: (kept: number, dropped: number) => `话题保留 ${kept} 个，去掉 ${dropped} 个`,
  linkCard: '实例会按正文里的链接生成预览卡片',
  noLink: '还没有辰记原文链接，嘟文里没有链接（先发布到辰记再同步可以带上原文卡片）',
  empty: '嘟文是空的',
  publishing: '发布到 Mastodon',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      instanceHint: '請填寫站台網域，例如 mastodon.social',
      instance: '站台',
      text: '嘟文',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      link: '連結',
      visibility: '可見範圍',
      spoiler: '內容警告',
      sensitive: '敏感內容',
      includeSummary: '附上摘要',
      includeTags: '附上主題標籤',
      idDigits: '嘟文 ID 是數字',
      externalId: '已發布嘟文 ID',
    },
    binding: [
      '填寫你的站台網域（例如 mastodon.social），按「授權」',
      '在站台頁面登入並允許辰記發嘟文（辰記會自動在該站台註冊應用程式，不需要你自己建立）',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面，關閉即失效；開啟「雲端代發」才會存到辰記伺服器',
      '不用時到站台「設定 → 帳號 → 已授權的應用程式」撤銷辰記',
    ],
    truncated: (limit, urlChars) => `嘟文依站台上限 ${limit} 字截短（連結以 ${urlChars} 字計）`,
    tagsTrimmed: (kept, dropped) => `主題標籤保留 ${kept} 個，移除 ${dropped} 個`,
    linkCard: '站台會依內文裡的連結產生預覽卡片',
    noLink: '還沒有辰記原文連結，嘟文裡沒有連結（先發布到辰記再同步，可以附上原文卡片）',
    empty: '嘟文是空的',
    publishing: '發布到 Mastodon',
    done: '完成',
  },
  en: {
    form: {
      instanceHint: 'Enter the instance domain, e.g. mastodon.social',
      instance: 'Instance',
      text: 'Post text',
      httpUrl: 'Enter a URL starting with http(s)://',
      link: 'Link',
      visibility: 'Visibility',
      spoiler: 'Content warning',
      sensitive: 'Sensitive content',
      includeSummary: 'Include the summary',
      includeTags: 'Include hashtags',
      idDigits: 'The post ID is a number',
      externalId: 'Published post ID',
    },
    binding: [
      'Enter your instance’s domain (e.g. mastodon.social), then click “Authorize”',
      'Sign in on the instance and allow StarNote to post (StarNote registers its app on the instance for you)',
      'Desktop app: the token is stored encrypted on this computer; web: the token lives only in this page and is gone when you close it; it’s stored on the StarNote server only with Cloud relay on',
      'When you no longer need it, revoke StarNote under Preferences → Account → Authorized apps on your instance',
    ],
    truncated: (limit, urlChars) =>
      `Post shortened to the instance’s limit of ${limit} characters (a link counts as ${urlChars})`,
    tagsTrimmed: (kept, dropped) => `Kept ${kept} hashtags, dropped ${dropped}`,
    linkCard: 'The instance builds a preview card from the link in the post',
    noLink:
      'No StarNote original yet, so the post has no link (publish to StarNote first to include the article card)',
    empty: 'The post is empty',
    publishing: 'Publishing to Mastodon',
    done: 'Done',
  },
});
