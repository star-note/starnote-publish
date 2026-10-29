/** SPEC-r14 B5: the Telegraph adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    authorMax: '作者名最多 128 字',
    authorName: '作者名',
    httpUrl: '请填写以 http(s):// 开头的地址',
    authorUrl: '作者链接',
    originNote: '文末注明原文',
    canonicalUrl: '原文链接',
    badPath: '页面路径格式不对',
    externalId: '已发布页面',
  },
  key: { authorMax: '作者名最多 128 字', authorName: '作者名（可选）' },
  binding: [
    'Telegraph 不用注册：点「绑定」后辰记自动为你创建一个 Telegraph 账号，令牌只存在辰记服务器',
    '作者名可选，会显示在每篇文章标题下面',
    '解绑后令牌作废，已经发出的页面不能再从辰记修改',
  ],
  originNote: '文末注明首发于辰记并附原文链接',
  tablesFlattened: (n: number) => `Telegraph 没有表格：${n} 个表格改为每行一段、单元格用 | 分隔`,
  imagesDropped: (n: number) => `${n} 张图片没有公网地址，Telegraph 显示不了，已去掉`,
  tooLarge: (kb: number) => `正文约 ${kb} KB，超过 Telegraph 的 64 KB 上限，请拆成几篇`,
  relaying: '由服务器代发到 Telegraph',
  done: '完成',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      authorMax: '作者名稱最多 128 字',
      authorName: '作者名稱',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      authorUrl: '作者連結',
      originNote: '文末註明原文',
      canonicalUrl: '原文連結',
      badPath: '頁面路徑格式不正確',
      externalId: '已發布頁面',
    },
    key: { authorMax: '作者名稱最多 128 字', authorName: '作者名稱（選填）' },
    binding: [
      'Telegraph 不用註冊：按「綁定」後辰記會自動為你建立一個 Telegraph 帳號，權杖只存在辰記伺服器',
      '作者名稱可不填，會顯示在每篇文章標題下方',
      '解除綁定後權杖失效，已經發出的頁面不能再從辰記修改',
    ],
    originNote: '文末註明首發於辰記並附上原文連結',
    tablesFlattened: (n) => `Telegraph 沒有表格：${n} 個表格改為每列一段、儲存格用 | 分隔`,
    imagesDropped: (n) => `${n} 張圖片沒有公開網址，Telegraph 無法顯示，已移除`,
    tooLarge: (kb) => `內文約 ${kb} KB，超過 Telegraph 的 64 KB 上限，請拆成幾篇`,
    relaying: '由伺服器代發到 Telegraph',
    done: '完成',
  },
  en: {
    form: {
      authorMax: 'Author name can be at most 128 characters',
      authorName: 'Author name',
      httpUrl: 'Enter a URL starting with http(s)://',
      authorUrl: 'Author link',
      originNote: 'Credit the original at the end',
      canonicalUrl: 'Canonical link',
      badPath: 'Invalid page path',
      externalId: 'Published page',
    },
    key: {
      authorMax: 'Author name can be at most 128 characters',
      authorName: 'Author name (optional)',
    },
    binding: [
      'Telegraph needs no sign-up: when you click “Connect”, StarNote creates a Telegraph account for you, and the token stays on the StarNote server',
      'The author name is optional and shows under every article’s title',
      'Disconnecting voids the token; pages already published can no longer be edited from StarNote',
    ],
    originNote: 'Added a line at the end saying it first appeared on StarNote, with the link',
    tablesFlattened: (n) =>
      `Telegraph has no tables: ${plural(n, 'table')} turned into one paragraph per row, cells separated by |`,
    imagesDropped: (n) =>
      `${plural(n, 'image')} with no public URL can’t be shown on Telegraph and were removed`,
    tooLarge: (kb) =>
      `The body is about ${kb} KB, over Telegraph’s 64 KB limit: split it into several posts`,
    relaying: 'Sending to Telegraph through the server',
    done: 'Done',
  },
});
