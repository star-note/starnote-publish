/** SPEC-r14 B5: the LinkedIn adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    text: '动态文案',
    httpUrl: '请填写以 http(s):// 开头的地址',
    link: '链接',
    visibility: '可见范围',
    includeSummary: '文案带上摘要',
    includeTags: '带上话题',
    withCover: '卡片带封面图',
  },
  binding: [
    '点「用 LinkedIn 授权」，在 LinkedIn 页面允许辰记代你发动态',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    'LinkedIn 的授权 60 天后过期且不能自动续期，到期前会提醒你重新授权',
    '不用时到 LinkedIn「设置 → 数据隐私 → 其他应用」撤销辰记',
  ],
  truncated: (max: number) => `LinkedIn 动态最多 ${max} 字，已截短`,
  linkCard: '以文章卡片发出，点开是辰记原文',
  thumbnail: '封面图由服务器上传为卡片缩略图',
  empty: '动态是空的',
  posting: '发到 LinkedIn',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      text: '動態文案',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      link: '連結',
      visibility: '可見範圍',
      includeSummary: '文案附上摘要',
      includeTags: '附上主題標籤',
      withCover: '卡片附上封面圖',
    },
    binding: [
      '按「用 LinkedIn 授權」，在 LinkedIn 頁面允許辰記代你發動態',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面，關閉即失效；開啟「雲端代發」才會存到辰記伺服器',
      'LinkedIn 的授權 60 天後過期且無法自動續期，到期前會提醒你重新授權',
      '不用時到 LinkedIn「設定 → 資料隱私 → 其他應用程式」撤銷辰記',
    ],
    truncated: (max) => `LinkedIn 動態最多 ${max} 字，已截短`,
    linkCard: '以文章卡片發出，點開是辰記原文',
    thumbnail: '封面圖由伺服器上傳為卡片縮圖',
    empty: '動態是空的',
    posting: '發到 LinkedIn',
    done: '完成',
  },
  en: {
    form: {
      text: 'Post text',
      httpUrl: 'Enter a URL starting with http(s)://',
      link: 'Link',
      visibility: 'Visibility',
      includeSummary: 'Include the summary in the text',
      includeTags: 'Include hashtags',
      withCover: 'Show the cover on the card',
    },
    binding: [
      'Click “Authorize with LinkedIn” and allow StarNote to post for you',
      'Desktop app: the token is stored encrypted on this computer; web: it stays in this page only and expires when closed; it’s stored on the StarNote server only with Cloud relay on',
      'LinkedIn authorizations expire after 60 days and can’t be renewed automatically; you’ll be reminded to authorize again before then',
      'When you no longer need it, revoke StarNote under LinkedIn Settings → Data privacy → Other applications',
    ],
    truncated: (max) => `LinkedIn posts allow at most ${max} characters; shortened`,
    linkCard: 'Posted as an article card that opens the StarNote original',
    thumbnail: 'The server uploads the cover as the card thumbnail',
    empty: 'The post is empty',
    posting: 'Posting to LinkedIn',
    done: 'Done',
  },
});
