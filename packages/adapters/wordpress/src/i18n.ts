/** SPEC-r14 B5: the WordPress adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    status: '发布方式',
    categories: '分类',
    slugFormat: '只能用小写字母、数字和 -',
    slug: '网址',
    uploadImages: '图片上传到媒体库',
    originNote: '文末注明首发于辰记',
    setCanonical: '附原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    idDigits: '文章 ID 是数字',
    externalId: '已发布文章 ID',
  },
  key: {
    siteUrlRequired: '请填写站点地址',
    siteUrl: '站点地址',
    usernameRequired: '请填写 WordPress 用户名',
    username: '用户名',
    appPasswordFormat: '应用密码是 24 位字母数字（可带空格）',
    appPassword: '应用密码',
  },
  binding: [
    '在你的站点后台「用户 → 个人资料」底部的「应用密码」区，新建一个名为「辰记」的密码并复制',
    '填入站点地址、用户名和这串密码，点「测试连接」（站点需要 HTTPS，WordPress 才会启用应用密码）',
    '不用时在同一处撤销这个应用密码即可',
  ],
  /** `wordpressBinding.selects[0].title` (`categories`). */
  selectCategories: '默认分类',
  originNoted: 'WordPress 没有 canonical 字段，已在文末注明首发于辰记并附原文链接',
  imagesWillUpload: (n: number) => `${n} 张图片将上传到站点媒体库`,
  pending: '提交为「待审」，由站点编辑审核后发布',
  draftOnly: '以未公开状态保存到 WordPress',
  relaying: '由服务器代发到 WordPress',
  done: '完成',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      status: '發布方式',
      categories: '分類',
      slugFormat: '只能用小寫字母、數字和 -',
      slug: '網址',
      uploadImages: '圖片上傳到媒體庫',
      originNote: '文末註明首發於辰記',
      setCanonical: '附上原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      idDigits: '文章 ID 是數字',
      externalId: '已發布文章 ID',
    },
    key: {
      siteUrlRequired: '請填寫網站網址',
      siteUrl: '網站網址',
      usernameRequired: '請填寫 WordPress 使用者名稱',
      username: '使用者名稱',
      appPasswordFormat: '應用程式密碼是 24 位英數字（可含空格）',
      appPassword: '應用程式密碼',
    },
    binding: [
      '在你的網站後台「使用者 → 個人資料」底部的「應用程式密碼」區，新增一個名為「辰記」的密碼並複製',
      '填入網站網址、使用者名稱和這串密碼，按「測試連線」（網站需要 HTTPS，WordPress 才會啟用應用程式密碼）',
      '不用時在同一處撤銷這個應用程式密碼即可',
    ],
    selectCategories: '預設分類',
    originNoted: 'WordPress 沒有 canonical 欄位，已在文末註明首發於辰記並附上原文連結',
    imagesWillUpload: (n) => `${n} 張圖片將上傳到網站媒體庫`,
    pending: '送出為「待審」，由網站編輯審核後發布',
    draftOnly: '以未公開狀態儲存到 WordPress',
    relaying: '由伺服器代發到 WordPress',
    done: '完成',
  },
  en: {
    form: {
      status: 'Publish as',
      categories: 'Categories',
      slugFormat: 'Only lowercase letters, digits and -',
      slug: 'URL slug',
      uploadImages: 'Upload images to the media library',
      originNote: 'Note at the end that it was first published on StarNote',
      setCanonical: 'Include the original link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Original link',
      idDigits: 'The post ID is a number',
      externalId: 'Published post ID',
    },
    key: {
      siteUrlRequired: 'Enter the site URL',
      siteUrl: 'Site URL',
      usernameRequired: 'Enter your WordPress username',
      username: 'Username',
      appPasswordFormat: 'An application password is 24 letters and digits (spaces allowed)',
      appPassword: 'Application password',
    },
    binding: [
      'In your site’s admin, go to Users → Profile and, under Application Passwords at the bottom, add one named “StarNote” and copy it',
      'Enter the site URL, your username and that password, then click “Test connection” (WordPress only enables application passwords on HTTPS sites)',
      'When you no longer need it, revoke the application password in the same place',
    ],
    selectCategories: 'Default categories',
    originNoted:
      'WordPress has no canonical field, so a “first published on StarNote” line with the original link closes the post',
    imagesWillUpload: (n) => `${plural(n, 'image')} will be uploaded to the site’s media library`,
    pending: 'Submitted as “Pending review”: a site editor publishes it after review',
    draftOnly: 'Saved to WordPress unpublished',
    relaying: 'Sending to WordPress through the server',
    done: 'Done',
  },
});
