/** SPEC-r14 B5: the Threads adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    text: '帖子文案',
    httpUrl: '请填写以 http(s):// 开头的地址',
    link: '链接',
    includeSummary: '带上摘要',
    includeTags: '带上话题',
    withCover: '发封面图（链接写进文案）',
  },
  binding: [
    '点「用 Threads 授权」，在 Threads 页面允许辰记代你发帖、读取帖子数据',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '授权 60 天有效，辰记会自动续期；不用时到 Threads「设置 → 账户 → 网站权限」移除辰记',
  ],
  truncated: (max: number) => `Threads 最多 ${max} 字（emoji 按字节计），已截短`,
  tagsTrimmed: (max: number) => `Threads 每帖只带 ${max} 个话题`,
  imagePost: '以图片帖发出，原文链接写在文案里',
  linkCard: '以链接卡片发出',
  processing: 'Threads 先建容器、处理完再发布，通常要等半分钟左右',
  empty: '帖子是空的',
  creating: '在 Threads 建帖子容器',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      text: '貼文文案',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      link: '連結',
      includeSummary: '附上摘要',
      includeTags: '附上主題標籤',
      withCover: '發封面圖（連結寫進文案）',
    },
    binding: [
      '按「用 Threads 授權」，在 Threads 頁面允許辰記代你發文、讀取貼文資料',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面，關閉即失效；開啟「雲端代發」才會存到辰記伺服器',
      '授權 60 天有效，辰記會自動續期；不用時到 Threads「設定 → 帳號 → 網站權限」移除辰記',
    ],
    truncated: (max) => `Threads 最多 ${max} 字（emoji 按位元組計），已截短`,
    tagsTrimmed: (max) => `Threads 每則貼文只帶 ${max} 個主題標籤`,
    imagePost: '以圖片貼文發出，原文連結寫在文案裡',
    linkCard: '以連結卡片發出',
    processing: 'Threads 先建立容器、處理完再發布，通常要等半分鐘左右',
    empty: '貼文是空的',
    creating: '在 Threads 建立貼文容器',
    done: '完成',
  },
  en: {
    form: {
      text: 'Post text',
      httpUrl: 'Enter a URL starting with http(s)://',
      link: 'Link',
      includeSummary: 'Include the summary',
      includeTags: 'Include hashtags',
      withCover: 'Post the cover image (link goes in the text)',
    },
    binding: [
      'Click “Authorize with Threads” and allow StarNote to post for you and read post data',
      'Desktop app: the token is stored encrypted on this computer; web: it stays in this page only and expires when closed; it’s stored on the StarNote server only with Cloud relay on',
      'The authorization lasts 60 days and StarNote renews it; when you no longer need it, remove StarNote under Threads Settings → Account → Website permissions',
    ],
    truncated: (max) =>
      `Threads allows at most ${max} characters (emoji counted by bytes); shortened`,
    tagsTrimmed: (max) => `Threads takes only ${max} hashtag per post`,
    imagePost: 'Posted as an image post with the article link in the text',
    linkCard: 'Posted with a link card',
    processing:
      'Threads creates a container and publishes it once processed; this usually takes about half a minute',
    empty: 'The post is empty',
    creating: 'Creating the Threads post container',
    done: 'Done',
  },
});
