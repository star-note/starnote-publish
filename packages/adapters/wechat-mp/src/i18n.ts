/** SPEC-r14 B5: the 公众号 adapter's user-visible texts (form, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    authorMax: '作者最多 16 个字',
    author: '作者',
    httpUrl: '请填写以 http(s):// 开头的链接',
    sourceUrl: '原文链接',
    openComment: '留言',
  },
  binding: [
    '在辰记桌面端点「在桌面端登录微信公众号」',
    '桌面端弹出公众号自己的登录页，由管理员用微信扫码确认',
    '登录成功后窗口自动关闭；公众号后台的登录几天就会过期，过期后再扫一次码',
  ],
  runtimeNote: '第 1 层：存进公众号后台，由你在后台点「发表」',
  relogin: '公众号需要重新扫码登录',
  handoff: '已存进公众号后台，请在后台点「发表」，群发需管理员扫码确认',
  titleTruncated: (max: number) => `标题超过 ${max} 字，已截短`,
  digestTruncated: (max: number) => `摘要超过 ${max} 字，已截短`,
  linksFootnoted: (n: number) => `${n} 处外链已转为文末参考链接（公众号正文里的外链不能点）`,
  imagesWillUpload: (n: number) => `${n} 张图片会上传到公众号素材库`,
  checkingLogin: '检查公众号登录状态',
  uploadingImages: '上传图片到公众号素材库',
  library: '公众号素材库',
  libraryCover: '公众号素材库（封面）',
  uploadProgress: (done: number, total: number) => `上传图片 ${done}/${total}`,
  imagesFailed: (n: number) =>
    `${n} 张图片上传到公众号素材库失败，已保留原图链接（公众号里外部图片通常显示不出来，请在后台替换）`,
  noCover: '没有设置封面：发表前请在公众号后台选一张封面',
  readMore: '「阅读原文」指向辰记原文',
  saving: '存进公众号后台',
  noId: '公众号后台没有返回图文 id',
  saved: '已存进公众号后台',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      authorMax: '作者最多 16 個字',
      author: '作者',
      httpUrl: '請填寫以 http(s):// 開頭的連結',
      sourceUrl: '原文連結',
      openComment: '留言',
    },
    binding: [
      '在辰記桌面版點「在桌面版登入微信公眾號」',
      '桌面版會彈出公眾號自己的登入頁，由管理員用微信掃碼確認',
      '登入成功後視窗會自動關閉；公眾號後台的登入幾天就會過期，過期後再掃一次碼',
    ],
    runtimeNote: '第 1 層：存進公眾號後台，由你在後台按「發表」',
    relogin: '公眾號需要重新掃碼登入',
    handoff: '已存進公眾號後台，請在後台按「發表」，群發需管理員掃碼確認',
    titleTruncated: (max) => `標題超過 ${max} 字，已截短`,
    digestTruncated: (max) => `摘要超過 ${max} 字，已截短`,
    linksFootnoted: (n) => `${n} 處外部連結已轉為文末參考連結（公眾號內文裡的外部連結無法點擊）`,
    imagesWillUpload: (n) => `${n} 張圖片會上傳到公眾號素材庫`,
    checkingLogin: '檢查公眾號登入狀態',
    uploadingImages: '上傳圖片到公眾號素材庫',
    library: '公眾號素材庫',
    libraryCover: '公眾號素材庫（封面）',
    uploadProgress: (done, total) => `上傳圖片 ${done}/${total}`,
    imagesFailed: (n) =>
      `${n} 張圖片上傳到公眾號素材庫失敗，已保留原圖連結（公眾號裡的外部圖片通常無法顯示，請在後台替換）`,
    noCover: '沒有設定封面：發表前請在公眾號後台選一張封面',
    readMore: '「閱讀原文」指向辰記原文',
    saving: '存進公眾號後台',
    noId: '公眾號後台沒有回傳圖文 id',
    saved: '已存進公眾號後台',
  },
  en: {
    form: {
      authorMax: 'Author can be at most 16 characters',
      author: 'Author',
      httpUrl: 'Enter a link starting with http(s)://',
      sourceUrl: 'Original link',
      openComment: 'Comments',
    },
    binding: [
      'In the StarNote desktop app, click “Log in to WeChat Official Account on desktop”',
      'The desktop app opens the Official Account’s own login page; an admin scans the QR code with WeChat',
      'The window closes once you’re logged in; the admin login expires after a few days, then scan again',
    ],
    runtimeNote: 'Level 1: saved into the Official Account admin; you click “发表” (Publish) there',
    relogin: 'The Official Account needs a new QR-code login',
    handoff:
      'Saved into the Official Account admin: click “发表” (Publish) there; a mass send needs the admin to scan to confirm',
    titleTruncated: (max) => `Title is over ${max} characters and was shortened`,
    digestTruncated: (max) => `Summary is over ${max} characters and was shortened`,
    linksFootnoted: (n) =>
      `${n} external ${n === 1 ? 'link' : 'links'} turned into references at the end (links aren’t clickable in Official Account articles)`,
    imagesWillUpload: (n) =>
      `${n} ${n === 1 ? 'image' : 'images'} will be uploaded to the Official Account media library`,
    checkingLogin: 'Checking the Official Account login',
    uploadingImages: 'Uploading images to the Official Account media library',
    library: 'the Official Account media library',
    libraryCover: 'the Official Account media library (cover)',
    uploadProgress: (done, total) => `Uploading images ${done}/${total}`,
    imagesFailed: (n) =>
      `${n} ${n === 1 ? 'image' : 'images'} couldn’t be uploaded to the media library and keep their original links (outside images usually don’t show in Official Account articles: replace them in the admin)`,
    noCover: 'No cover set: pick one in the Official Account admin before publishing',
    readMore: '“Read more” points to the StarNote original',
    saving: 'Saving into the Official Account admin',
    noId: 'The Official Account admin returned no article id',
    saved: 'Saved into the Official Account admin',
  },
});
