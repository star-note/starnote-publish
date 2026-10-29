/** SPEC-r14 B5: the Facebook adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    text: '帖子文案',
    httpUrl: '请填写以 http(s):// 开头的地址',
    link: '链接',
    includeSummary: '带上摘要',
    includeTags: '带上话题',
    pageDigits: '主页 ID 是数字',
    page: '主页',
  },
  selectPage: '选择要发布的主页',
  binding: [
    '点「用 Facebook 授权」，在 Facebook 页面勾选要让辰记管理的主页（Page）',
    '回到辰记选择要发布的主页；个人主页没有发帖接口，只能用分享',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面；打开「云端代发」才会存到辰记服务器',
    '不用时到 Facebook「设置 → 商务集成」移除辰记',
  ],
  truncated: (max: number) => `引流文案按 ${max} 字截短`,
  linkCard: 'Facebook 会按链接生成预览卡片',
  empty: '帖子是空的',
  posting: '发到 Facebook 主页',
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
      pageDigits: '粉絲專頁 ID 是數字',
      page: '粉絲專頁',
    },
    selectPage: '選擇要發布的粉絲專頁',
    binding: [
      '按「用 Facebook 授權」，在 Facebook 頁面勾選要讓辰記管理的粉絲專頁（Page）',
      '回到辰記選擇要發布的粉絲專頁；個人檔案沒有發文介面，只能用分享',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面；開啟「雲端代發」才會存到辰記伺服器',
      '不用時到 Facebook「設定 → 商業整合」移除辰記',
    ],
    truncated: (max) => `導流文案依 ${max} 字截短`,
    linkCard: 'Facebook 會依連結產生預覽卡片',
    empty: '貼文是空的',
    posting: '發到 Facebook 粉絲專頁',
    done: '完成',
  },
  en: {
    form: {
      text: 'Post text',
      httpUrl: 'Enter a URL starting with http(s)://',
      link: 'Link',
      includeSummary: 'Include the summary',
      includeTags: 'Include hashtags',
      pageDigits: 'The Page ID is a number',
      page: 'Page',
    },
    selectPage: 'Choose the Page to publish to',
    binding: [
      'Click “Authorize with Facebook” and tick the Pages StarNote may manage',
      'Back in StarNote, choose the Page to publish to; personal profiles have no posting API, only sharing',
      'Desktop app: the token is stored encrypted on this computer; web: it stays in this page only; it’s stored on the StarNote server only with Cloud relay on',
      'When you no longer need it, remove StarNote under Facebook Settings → Business integrations',
    ],
    truncated: (max) => `Post text shortened to ${max} characters`,
    linkCard: 'Facebook will make a preview card from the link',
    empty: 'The post is empty',
    posting: 'Posting to your Facebook Page',
    done: 'Done',
  },
});
