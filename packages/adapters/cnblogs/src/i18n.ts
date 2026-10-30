/** SPEC-r14 B5: the 博客园 adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    published: '直接发布',
    categories: '随笔分类',
    categoriesMax: '随笔分类最多 5 个',
    home: '投稿到博客园首页',
    originNote: '文末注明首发于辰记',
    idDigits: '文章 ID 是数字',
    externalId: '已发布文章 ID',
  },
  key: {
    blogApp: '博客地址名',
    blogAppHint: '博客地址 www.cnblogs.com/ 后面的那一段，只含字母、数字、- 和 _',
    username: '登录用户名',
    usernameHint: '请填写博客园的登录用户名',
    token: '个人访问令牌',
    tokenHint: '请粘贴在博客园「Access Tokens」页创建的令牌',
  },
  binding: [
    '先在博客园开通博客（新账号要申请，人工审核）',
    '打开账号设置里的「Access Tokens」，点「創建令牌」并复制',
    '在这里填博客地址名、登录用户名和令牌，点「测试连接」',
    '不用时在同一页删除令牌，绑定立即失效',
  ],
  imagesWillUpload: (n: number) => `${n} 张图片由服务器上传到博客园`,
  markdown: '正文以 Markdown 发布（随笔分类里带 [Markdown]）',
  originNote: '文末加上「本文首发于辰记」和原文链接',
  home: '已投稿到博客园首页，首页需要审核，不符合要求时只发在个人博客',
  draftOnly: '保存为博客园草稿，检查后在博客园后台发布',
  techOnly: '博客园个人博客只能发软件开发相关的技术内容，不能发推广内容',
  relaying: '由服务器代发到博客园',
  done: '完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      published: '直接發布',
      categories: '隨筆分類',
      categoriesMax: '隨筆分類最多 5 個',
      home: '投稿到博客園首頁',
      originNote: '文末註明首發於辰記',
      idDigits: '文章 ID 是數字',
      externalId: '已發布文章 ID',
    },
    key: {
      blogApp: '部落格網址名稱',
      blogAppHint: '部落格網址 www.cnblogs.com/ 後面的那一段，只能有字母、數字、- 和 _',
      username: '登入使用者名稱',
      usernameHint: '請填寫博客園的登入使用者名稱',
      token: '個人存取權杖',
      tokenHint: '請貼上在博客園「Access Tokens」頁建立的權杖',
    },
    binding: [
      '先在博客園開通部落格（新帳號要申請，人工審核）',
      '開啟帳號設定裡的「Access Tokens」，按「創建令牌」並複製',
      '在這裡填部落格網址名稱、登入使用者名稱和權杖，按「測試連線」',
      '不用時在同一頁刪除權杖，綁定立即失效',
    ],
    imagesWillUpload: (n) => `${n} 張圖片由伺服器上傳到博客園`,
    markdown: '內文以 Markdown 發布（隨筆分類裡帶 [Markdown]）',
    originNote: '文末加上「本文首發於辰記」和原文連結',
    home: '已投稿到博客園首頁，首頁需要審核，不符合要求時只發在個人部落格',
    draftOnly: '儲存為博客園草稿，檢查後在博客園後台發布',
    techOnly: '博客園個人部落格只能發軟體開發相關的技術內容，不能發推廣內容',
    relaying: '由伺服器代發到博客園',
    done: '完成',
  },
  en: {
    form: {
      published: 'Publish now',
      categories: 'Personal categories',
      categoriesMax: 'Up to 5 personal categories',
      home: 'Submit to the Cnblogs front page',
      originNote: 'Say at the end that it was first published on StarNote',
      idDigits: 'The post ID is a number',
      externalId: 'Published post ID',
    },
    key: {
      blogApp: 'Blog address name',
      blogAppHint:
        'The part after www.cnblogs.com/ in your blog’s address: letters, digits, - and _ only',
      username: 'Login name',
      usernameHint: 'Enter your Cnblogs login name',
      token: 'Personal access token',
      tokenHint: 'Paste the token you created on the Cnblogs “Access Tokens” page',
    },
    binding: [
      'Open your blog on Cnblogs first (new accounts apply and are reviewed by hand)',
      'Open “Access Tokens” in the account settings, click “创建令牌” (Create token) and copy it',
      'Enter the blog address name, login name and token here, then click “Test connection”',
      'To unbind, delete the token on the same page: the binding stops working at once',
    ],
    imagesWillUpload: (n) =>
      `${n} ${n === 1 ? 'image is' : 'images are'} uploaded to Cnblogs by the StarNote server`,
    markdown: 'The body is published as Markdown ([Markdown] in the categories)',
    originNote: 'Adds a “first published on StarNote” line with the original link at the end',
    home: 'Submitted to the Cnblogs front page, which is reviewed: if it isn’t accepted, the post stays on your blog only',
    draftOnly: 'Saved as a Cnblogs draft: check it and publish it in the Cnblogs dashboard',
    techOnly: 'Personal blogs on Cnblogs take software development content only, no promotion',
    relaying: 'Publishing to Cnblogs through the StarNote server',
    done: 'Done',
  },
});
