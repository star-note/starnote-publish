/** SPEC-r14 B5: the Blogger adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    blogIdDigits: '博客 ID 是数字',
    blog: '博客',
    status: '发布方式',
    originNote: '文末注明首发于辰记',
    setCanonical: '附原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    idDigits: '文章 ID 是数字',
    externalId: '已发布文章 ID',
  },
  binding: [
    '点「用 Google 授权」，在 Google 页面选择账号并允许辰记管理你的 Blogger 博客',
    '回到辰记后选择要发布到的博客',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到 Google 账号「第三方应用和服务」里移除辰记',
  ],
  /** `bloggerBinding.selects[0].title` (`blog_id`). */
  selectBlog: '发布到哪个博客',
  coverInline: 'Blogger 没有封面字段，封面图放在正文开头',
  originNoted: 'Blogger 没有 canonical 字段，已在文末注明首发于辰记并附原文链接',
  draftOnly: '保存为 Blogger 草稿，检查后在 Blogger 后台发布',
  publishing: '发布到 Blogger',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      blogIdDigits: '部落格 ID 是數字',
      blog: '部落格',
      status: '發布方式',
      originNote: '文末註明首發於辰記',
      setCanonical: '附上原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      idDigits: '文章 ID 是數字',
      externalId: '已發布文章 ID',
    },
    binding: [
      '按「用 Google 授權」，在 Google 頁面選擇帳號並允許辰記管理你的 Blogger 部落格',
      '回到辰記後選擇要發布到的部落格',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面，關閉即失效；開啟「雲端代發」才會存到辰記伺服器',
      '不用時到 Google 帳戶的「第三方應用程式和服務」移除辰記',
    ],
    selectBlog: '發布到哪個部落格',
    coverInline: 'Blogger 沒有封面欄位，封面圖放在內文開頭',
    originNoted: 'Blogger 沒有 canonical 欄位，已在文末註明首發於辰記並附上原文連結',
    draftOnly: '儲存為 Blogger 草稿，檢查後在 Blogger 後台發布',
    publishing: '發布到 Blogger',
    done: '完成',
  },
  en: {
    form: {
      blogIdDigits: 'The blog ID is a number',
      blog: 'Blog',
      status: 'Publish as',
      originNote: 'Note at the end that it was first published on StarNote',
      setCanonical: 'Include the original link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Original link',
      idDigits: 'The post ID is a number',
      externalId: 'Published post ID',
    },
    binding: [
      'Click “Authorize with Google”, choose your account on Google’s page and allow StarNote to manage your Blogger blogs',
      'Back in StarNote, choose the blog to publish to',
      'Desktop app: the token is stored encrypted on this computer; web: it stays in this page only and is gone when you close it; it’s saved on the StarNote server only with Cloud relay on',
      'When you no longer need it, remove StarNote under “Third-party apps & services” in your Google Account',
    ],
    selectBlog: 'Blog to publish to',
    coverInline: 'Blogger has no cover field, so the cover goes at the top of the post',
    originNoted:
      'Blogger has no canonical field, so a “first published on StarNote” line with the original link closes the post',
    draftOnly: 'Saved as a Blogger draft: check it, then publish from the Blogger dashboard',
    publishing: 'Publishing to Blogger',
    done: 'Done',
  },
});
