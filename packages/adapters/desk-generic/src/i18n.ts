/** SPEC-r14 B5: the 发布台 通用模式 adapter's user-visible texts (binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  titleTruncated: (max: number) => `标题超过 ${max} 字，已截短`,
  binding: (platform: string) => [
    `在辰记桌面端点「在桌面端登录${platform}」`,
    `在弹出的${platform}页面里用任意方式登录，验证码由你本人完成`,
    '登录好后关掉窗口，在提示里点「已登录」。登录状态只保存在这台电脑上',
  ],
  runtimeNote: (platform: string) =>
    `通用模式：在发布台打开${platform}，复制标题和正文粘贴进去，由你点发布`,
  readScript: (platform: string) => `读取${platform}的站点脚本`,
  desktopOnly: (platform: string) => `${platform}需要在辰记桌面端发布`,
  noEntry: (platform: string) => `${platform}的站点脚本缺少入口地址`,
  opening: (platform: string) => `在发布台打开${platform}`,
  steps: (platform: string) =>
    `在${platform}里打开写文章，点格子顶栏的「复制标题」「复制正文」粘贴进去，检查后自己点发布，再点「我已发布」并把文章链接贴回辰记`,
  waiting: (platform: string) => `等你在${platform}里发布`,
  runtimeNoteFill: (platform: string) =>
    `发布台打开${platform}的写作页，自动填好标题和正文，由你选好平台选项后点发布`,
  filled: (platform: string) => `已在${platform}的写作页里填好标题和正文`,
  markdownBody: (platform: string) => `正文按 Markdown 复制，粘贴到${platform}的 Markdown 编辑器里`,
  markdownFilled: (platform: string) => `正文按 Markdown 填进了${platform}的 Markdown 编辑器`,
  chooseDeclarations: (platform: string) =>
    `${platform}的分类、原创、AI 声明等选项请在页面上自己选`,
  stepsFilled: (platform: string) =>
    `检查后在${platform}里点发布，再点格子顶栏的「我已发布」并把文章链接贴回辰记`,
  /** Extra steps of one platform (keyed by registry key). */
  hints: {
    'xiaohongshu-article': '小红书长文要先点「新的创作」，编辑器出现后辰记再填入（最多等 3 分钟）',
    sohu: '搜狐号要实名认证后才能发布文章',
    'weibo-article': '打开编辑器时微博会自动新建一篇草稿',
  } as Partial<Record<string, string>>,
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    titleTruncated: (max) => `標題超過 ${max} 字，已截短`,
    binding: (platform) => [
      `在辰記桌面版點「在桌面版登入${platform}」`,
      `在彈出的${platform}頁面裡用任何方式登入，驗證碼由你本人完成`,
      '登入好後關閉視窗，在提示裡按「已登入」。登入狀態只儲存在這台電腦上',
    ],
    runtimeNote: (platform) =>
      `通用模式：在發布台開啟${platform}，複製標題和內文貼進去，由你按發布`,
    readScript: (platform) => `讀取${platform}的站點腳本`,
    desktopOnly: (platform) => `${platform}需要在辰記桌面版發布`,
    noEntry: (platform) => `${platform}的站點腳本缺少入口網址`,
    opening: (platform) => `在發布台開啟${platform}`,
    steps: (platform) =>
      `在${platform}裡開啟寫文章，按格子頂欄的「複製標題」「複製內文」貼進去，檢查後自己按發布，再按「我已發布」並把文章連結貼回辰記`,
    waiting: (platform) => `等你在${platform}裡發布`,
    runtimeNoteFill: (platform) =>
      `發布台開啟${platform}的寫作頁，自動填好標題和內文，由你選好平台選項後按發布`,
    filled: (platform) => `已在${platform}的寫作頁裡填好標題和內文`,
    markdownBody: (platform) => `內文按 Markdown 複製，貼到${platform}的 Markdown 編輯器裡`,
    markdownFilled: (platform) => `內文按 Markdown 填進了${platform}的 Markdown 編輯器`,
    chooseDeclarations: (platform) => `${platform}的分類、原創、AI 聲明等選項請在頁面上自己選`,
    stepsFilled: (platform) =>
      `檢查後在${platform}裡按發布，再按格子頂欄的「我已發布」並把文章連結貼回辰記`,
    hints: {
      'xiaohongshu-article':
        '小紅書長文要先按「新的創作」，編輯器出現後辰記再填入（最多等 3 分鐘）',
      sohu: '搜狐號要實名認證後才能發布文章',
      'weibo-article': '開啟編輯器時微博會自動新建一篇草稿',
    },
  },
  en: {
    titleTruncated: (max) => `Title is over ${max} characters and was shortened`,
    binding: (platform) => [
      `In the StarNote desktop app, click “Log in to ${platform} on desktop”`,
      `Log in on the ${platform} page that opens, any way you like; you complete any verification yourself`,
      'Once logged in, close the window and click “Logged in” in the prompt. The login stays on this computer only',
    ],
    runtimeNote: (platform) =>
      `Generic mode: the Publish Desk opens ${platform}; copy the title and body into it and publish yourself`,
    readScript: (platform) => `Loading the ${platform} site script`,
    desktopOnly: (platform) => `${platform} has to be published from the StarNote desktop app`,
    noEntry: (platform) => `The ${platform} site script has no entry URL`,
    opening: (platform) => `Opening ${platform} on the Publish Desk`,
    steps: (platform) =>
      `Start a new post on ${platform}, use “Copy title” and “Copy body” on the tile’s top bar to paste them in, check it and publish it yourself, then click “I’ve published” and paste the post link back into StarNote`,
    waiting: (platform) => `Waiting for you to publish on ${platform}`,
    runtimeNoteFill: (platform) =>
      `The Publish Desk opens the ${platform} editor with the title and body filled in; you pick the platform’s options and publish`,
    filled: (platform) => `Filled in the title and body in the ${platform} editor`,
    markdownBody: (platform) =>
      `The body is copied as Markdown; paste it into the ${platform} Markdown editor`,
    markdownFilled: (platform) =>
      `The body was filled in as Markdown in the ${platform} Markdown editor`,
    chooseDeclarations: (platform) =>
      `Pick ${platform}’s options (category, original, AI statement…) yourself on the page`,
    stepsFilled: (platform) =>
      `Check it and publish on ${platform}, then click “I’ve published” on the tile’s top bar and paste the post link back into StarNote`,
    hints: {
      'xiaohongshu-article':
        'On Xiaohongshu long-form, click “新的创作” (New post) first: StarNote fills the editor once it appears (waits up to 3 minutes)',
      sohu: 'Sohu Hao publishes articles only after real-name verification',
      'weibo-article': 'Weibo creates a draft as soon as the editor opens',
    },
  },
});
