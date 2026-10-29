/** SPEC-r14 B5: the CSDN adapter's user-visible texts (form, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    articleType: '文章类型',
    httpUrl: '请填写以 http(s):// 开头的原文链接',
    originalUrl: '原文链接',
    repostNeedsUrl: '转载文章需要填写原文链接',
  },
  binding: [
    '在辰记桌面端点「在桌面端登录 CSDN」',
    '在弹出的 CSDN 登录页里用任意方式登录，验证码由你本人完成',
    '登录成功后窗口自动关闭，登录状态只保存在这台电脑上',
  ],
  runtimeNote: '第 3 层（交接）：打开 CSDN 编辑器粘贴好内容，由你点「发布文章」',
  titleTruncated: (max: number) => `标题超过 ${max} 字，已截短`,
  titleShort: (min: number) => `CSDN 要求标题至少 ${min} 个字，请在编辑器里补全`,
  readScript: '读取 CSDN 站点脚本',
  desktopOnly: 'CSDN 需要在桌面端打开编辑器发布',
  noEditorConfig: 'CSDN 站点脚本缺少编辑器配置',
  uploadingImages: '上传图片到 CSDN',
  uploadProgress: (done: number, total: number) => `上传图片 ${done}/${total}`,
  imagesNotUploaded: (n: number) =>
    `${n} 张图片没有预先上传，已保留原图链接；CSDN 编辑器粘贴时会尝试转存`,
  openingEditor: '打开 CSDN 编辑器',
  /** `type`: CSDN's own (Chinese) option name. */
  finish: (filled: string, type: string, originalUrl: string) =>
    `${filled}：在 CSDN 编辑器里点「发布文章」，文章类型选「${type}」${
      originalUrl ? `并填写原文链接 ${originalUrl}` : ''
    }，再选标签和分类专栏`,
  waitingPublish: '等你在 CSDN 编辑器里发布',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      articleType: '文章類型',
      httpUrl: '請填寫以 http(s):// 開頭的原文連結',
      originalUrl: '原文連結',
      repostNeedsUrl: '轉載文章需要填寫原文連結',
    },
    binding: [
      '在辰記桌面版點「在桌面版登入 CSDN」',
      '在彈出的 CSDN 登入頁裡用任何方式登入，驗證碼由你本人完成',
      '登入成功後視窗會自動關閉，登入狀態只儲存在這台電腦上',
    ],
    runtimeNote: '第 3 層（交接）：開啟 CSDN 編輯器貼好內容，由你按「發布文章」',
    titleTruncated: (max) => `標題超過 ${max} 字，已截短`,
    titleShort: (min) => `CSDN 要求標題至少 ${min} 個字，請在編輯器裡補齊`,
    readScript: '讀取 CSDN 站點腳本',
    desktopOnly: 'CSDN 需要在桌面版開啟編輯器發布',
    noEditorConfig: 'CSDN 站點腳本缺少編輯器設定',
    uploadingImages: '上傳圖片到 CSDN',
    uploadProgress: (done, total) => `上傳圖片 ${done}/${total}`,
    imagesNotUploaded: (n) =>
      `${n} 張圖片沒有預先上傳，已保留原圖連結；貼到 CSDN 編輯器時會嘗試轉存`,
    openingEditor: '開啟 CSDN 編輯器',
    finish: (filled, type, originalUrl) =>
      `${filled}：在 CSDN 編輯器裡按「發布文章」，文章類型選「${type}」${
        originalUrl ? `並填寫原文連結 ${originalUrl}` : ''
      }，再選標籤和分類專欄`,
    waitingPublish: '等你在 CSDN 編輯器裡發布',
  },
  en: {
    form: {
      articleType: 'Article type',
      httpUrl: 'Enter an original link starting with http(s)://',
      originalUrl: 'Original link',
      repostNeedsUrl: 'A repost needs the original link',
    },
    binding: [
      'In the StarNote desktop app, click “Log in to CSDN on desktop”',
      'Log in on the CSDN page that opens, any way you like; you complete any verification yourself',
      'The window closes once you’re logged in; the login stays on this computer only',
    ],
    runtimeNote:
      'Level 3 (hand-off): opens the CSDN editor with the content pasted; you click “发布文章” (Publish)',
    titleTruncated: (max) => `Title is over ${max} characters and was shortened`,
    titleShort: (min) =>
      `CSDN needs a title of at least ${min} characters: complete it in the editor`,
    readScript: 'Loading the CSDN site script',
    desktopOnly: 'CSDN has to be published from the desktop app’s editor window',
    noEditorConfig: 'The CSDN site script has no editor settings',
    uploadingImages: 'Uploading images to CSDN',
    uploadProgress: (done, total) => `Uploading images ${done}/${total}`,
    imagesNotUploaded: (n) =>
      `${n} ${n === 1 ? 'image wasn’t' : 'images weren’t'} uploaded in advance and keep their original links; CSDN’s editor tries to copy them when pasting`,
    openingEditor: 'Opening the CSDN editor',
    finish: (filled, type, originalUrl) =>
      `${filled}: in the CSDN editor click “发布文章” (Publish), choose “${type}” as the article type${
        originalUrl ? ` and enter the original link ${originalUrl}` : ''
      }, then pick the tags and column`,
    waitingPublish: 'Waiting for you to publish in the CSDN editor',
  },
});
