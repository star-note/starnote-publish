/** SPEC-r14 B5: the WordPress.com adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    siteIdDigits: '站点 ID 是数字',
    site: '站点',
    status: '发布方式',
    categories: '分类',
    slugFormat: '只能用小写字母、数字和 -',
    slug: '网址',
    originNote: '文末注明首发于辰记',
    setCanonical: '附原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    idDigits: '文章 ID 是数字',
    externalId: '已发布文章 ID',
  },
  binding: [
    '点「用 WordPress.com 授权」，登录后选择要授权的站点并允许',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到 WordPress.com「账户设置 → 已连接的应用」断开辰记',
  ],
  /** `wordpressComBinding.selects[0].title` (`site_id`). */
  selectSite: '发布到哪个站点',
  coverInline: 'WordPress.com 的特色图片只能选媒体库里已有的图片，封面图放在正文开头',
  originNoted: 'WordPress.com 没有 canonical 字段，已在文末注明首发于辰记并附原文链接',
  pending: '提交为「待审」，由站点编辑审核后发布',
  private: '以私密文章发布，只有站点管理员和编辑能看到',
  draft: '保存为 WordPress.com 草稿',
  publishing: '发布到 WordPress.com',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      siteIdDigits: '網站 ID 是數字',
      site: '網站',
      status: '發布方式',
      categories: '分類',
      slugFormat: '只能用小寫字母、數字和 -',
      slug: '網址',
      originNote: '文末註明首發於辰記',
      setCanonical: '附上原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      idDigits: '文章 ID 是數字',
      externalId: '已發布文章 ID',
    },
    binding: [
      '按「用 WordPress.com 授權」，登入後選擇要授權的網站並允許',
      '桌面版：權杖加密存在本機；網頁：權杖只在目前頁面，關閉即失效；開啟「雲端代發」才會存到辰記伺服器',
      '不用時到 WordPress.com「帳號設定 → 已連結的應用程式」中斷與辰記的連結',
    ],
    selectSite: '發布到哪個網站',
    coverInline: 'WordPress.com 的精選圖片只能選媒體庫裡已有的圖片，封面圖放在內文開頭',
    originNoted: 'WordPress.com 沒有 canonical 欄位，已在文末註明首發於辰記並附上原文連結',
    pending: '送出為「待審」，由網站編輯審核後發布',
    private: '以私密文章發布，只有網站管理員和編輯看得到',
    draft: '儲存為 WordPress.com 草稿',
    publishing: '發布到 WordPress.com',
    done: '完成',
  },
  en: {
    form: {
      siteIdDigits: 'The site ID is a number',
      site: 'Site',
      status: 'Publish as',
      categories: 'Categories',
      slugFormat: 'Only lowercase letters, digits and -',
      slug: 'URL slug',
      originNote: 'Note at the end that it was first published on StarNote',
      setCanonical: 'Include the original link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Original link',
      idDigits: 'The post ID is a number',
      externalId: 'Published post ID',
    },
    binding: [
      'Click “Authorize with WordPress.com”, log in, choose the site to authorize and allow it',
      'Desktop app: the token is stored encrypted on this computer; web: it stays in this page only and is gone when you close it; it’s saved on the StarNote server only with Cloud relay on',
      'When you no longer need it, disconnect StarNote in WordPress.com under Account settings → Connected applications',
    ],
    selectSite: 'Site to publish to',
    coverInline:
      'WordPress.com’s featured image can only be one already in the media library, so the cover goes at the top of the post',
    originNoted:
      'WordPress.com has no canonical field, so a “first published on StarNote” line with the original link closes the post',
    pending: 'Submitted as “Pending review”: a site editor publishes it after review',
    private: 'Published as private: only site admins and editors can see it',
    draft: 'Saved as a WordPress.com draft',
    publishing: 'Publishing to WordPress.com',
    done: 'Done',
  },
});
