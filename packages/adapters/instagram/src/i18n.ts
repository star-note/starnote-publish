/** SPEC-r14 B5: the Instagram adapters' user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    caption: '文案',
    includeSummary: '带上摘要',
    includeTags: '带上话题',
    includeLink: '文末写上原文地址',
    maxImages: '图片张数',
  },
  imagesTrimmed: (max: number, n: number) => `Instagram 单帖按 ${max} 张准备，去掉 ${n} 张`,
  imagesSkipped: (n: number) => `${n} 张图片没有可下载的地址，已跳过`,
  tagsTrimmed: (max: number) => `Instagram 最多 ${max} 个话题，已去掉多余的`,
  captionTruncated: (max: number) => `文案超过 ${max} 字，已截短`,
  linkNotClickable: 'Instagram 文案里的链接不能点，原文地址以文字附在文末（可放到个人主页链接）',
  handoff:
    '需要在 Instagram App 里完成发布：手机上用系统分享选 Instagram；电脑上下载图片并复制文案，再到手机或 instagram.com 发布',
  manualSteps: [
    '下载图片（按顺序命名 starnote-01、02…）',
    '复制文案',
    '在手机 Instagram App（或 instagram.com）新建帖子，按顺序选图并粘贴文案后发布',
  ],
  notePhone: '手机：系统分享面板选 Instagram，在 App 里完成发布',
  noteComputer: '电脑：下载图片 + 复制文案',
  noteDesktop: '下载图片 + 复制文案',
  needsImage: 'Instagram 帖子至少要 1 张图片：给笔记加封面或插图后再试',
  ready: '图片和文案已备好',
  binding: [
    '只支持专业账号（商家 / 创作者）：先在 Instagram App「设置 → 账户类型和工具」切换',
    '点「用 Instagram 授权」，允许辰记代你发帖',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面；打开「云端代发」才会存到辰记服务器',
    '授权 60 天有效，辰记会自动续期；不用时到 Instagram「设置 → 网站权限 → 应用和网站」移除辰记',
  ],
  unreachable: (urls: string) =>
    `Instagram 要从公网拉取图片，这些地址拉不到（须是公网 HTTPS）：${urls}`,
  listSeparator: '、',
  carousel: (n: number) => `${n} 张图片发成轮播：Instagram 处理完后自动发布`,
  single: '单图帖：Instagram 处理完后自动发布',
  creating: '在 Instagram 建帖子容器',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      caption: '文案',
      includeSummary: '附上摘要',
      includeTags: '附上主題標籤',
      includeLink: '文末寫上原文網址',
      maxImages: '圖片張數',
    },
    imagesTrimmed: (max, n) => `Instagram 單則貼文以 ${max} 張準備，移除 ${n} 張`,
    imagesSkipped: (n) => `${n} 張圖片沒有可下載的網址，已略過`,
    tagsTrimmed: (max) => `Instagram 最多 ${max} 個主題標籤，已移除多餘的`,
    captionTruncated: (max) => `文案超過 ${max} 字，已截短`,
    linkNotClickable:
      'Instagram 文案裡的連結無法點擊，原文網址以文字附在文末（可放到個人檔案連結）',
    handoff:
      '需要在 Instagram App 裡完成發布：手機上用系統分享選 Instagram；電腦上下載圖片並複製文案，再到手機或 instagram.com 發布',
    manualSteps: [
      '下載圖片（依序命名 starnote-01、02…）',
      '複製文案',
      '在手機 Instagram App（或 instagram.com）建立貼文，依序選圖並貼上文案後發布',
    ],
    notePhone: '手機：在系統分享選單選 Instagram，在 App 裡完成發布',
    noteComputer: '電腦：下載圖片 + 複製文案',
    noteDesktop: '下載圖片 + 複製文案',
    needsImage: 'Instagram 貼文至少要 1 張圖片：替筆記加上封面或插圖後再試',
    ready: '圖片和文案已備好',
    binding: [
      '只支援專業帳號（商家 / 創作者）：先在 Instagram App「設定 → 帳號類型和工具」切換',
      '按「用 Instagram 授權」，允許辰記代你發文',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面；開啟「雲端代發」才會存到辰記伺服器',
      '授權 60 天有效，辰記會自動續期；不用時到 Instagram「設定 → 網站權限 → 應用程式和網站」移除辰記',
    ],
    unreachable: (urls) =>
      `Instagram 要從公開網路抓取圖片，這些網址抓不到（須為公開的 HTTPS）：${urls}`,
    listSeparator: '、',
    carousel: (n) => `${n} 張圖片發成輪播：Instagram 處理完後自動發布`,
    single: '單圖貼文：Instagram 處理完後自動發布',
    creating: '在 Instagram 建立貼文容器',
    done: '完成',
  },
  en: {
    form: {
      caption: 'Caption',
      includeSummary: 'Include the summary',
      includeTags: 'Include hashtags',
      includeLink: 'Add the article URL at the end',
      maxImages: 'Number of images',
    },
    imagesTrimmed: (max, n) => `An Instagram post is prepared with ${max} images; ${n} left out`,
    imagesSkipped: (n) =>
      `${n === 1 ? '1 image has' : `${n} images have`} no downloadable URL and ${n === 1 ? 'was' : 'were'} skipped`,
    tagsTrimmed: (max) => `Instagram allows at most ${max} hashtags; the rest were removed`,
    captionTruncated: (max) => `Caption is over ${max} characters; shortened`,
    linkNotClickable:
      'Links in Instagram captions aren’t clickable: the article URL is added as text at the end (you can put it in your bio link)',
    handoff:
      'Finish in the Instagram app: on a phone, share to Instagram from the share sheet; on a computer, download the images and copy the caption, then post from your phone or instagram.com',
    manualSteps: [
      'Download the images (named in order: starnote-01, 02…)',
      'Copy the caption',
      'Create a post in the Instagram app (or on instagram.com), pick the images in order, paste the caption and post',
    ],
    notePhone: 'Phone: pick Instagram in the share sheet and finish in the app',
    noteComputer: 'Computer: download the images and copy the caption',
    noteDesktop: 'Download the images and copy the caption',
    needsImage:
      'An Instagram post needs at least 1 image: add a cover or an image to the note and try again',
    ready: 'Images and caption are ready',
    binding: [
      'Only professional (business / creator) accounts are supported: switch in the Instagram app under Settings → Account type and tools',
      'Click “Authorize with Instagram” and allow StarNote to post for you',
      'Desktop app: the token is stored encrypted on this computer; web: it stays in this page only; it’s stored on the StarNote server only with Cloud relay on',
      'The authorization lasts 60 days and StarNote renews it; when you no longer need it, remove StarNote under Instagram Settings → Website permissions → Apps and websites',
    ],
    unreachable: (urls) =>
      `Instagram fetches images from the public internet and can’t reach these (they must be public HTTPS): ${urls}`,
    listSeparator: ', ',
    carousel: (n) => `${n} images posted as a carousel: Instagram publishes it once processed`,
    single: 'Single-image post: Instagram publishes it once processed',
    creating: 'Creating the Instagram post container',
    done: 'Done',
  },
});
