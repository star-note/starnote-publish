/** SPEC-r14 B5: the Ghost adapter's user-visible texts (form labels, binding help, report, progress). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  form: {
    status: '发布方式',
    visibility: '可见范围',
    featured: '精选',
    slugFormat: '只能用小写字母、数字和 -',
    slug: '网址',
    uploadImages: '图片上传到 Ghost',
    setCanonical: '设置原文链接',
    httpUrl: '请填写以 http(s):// 开头的地址',
    canonicalUrl: '原文链接',
    idFormat: '文章 ID 是 24 位十六进制',
    externalId: '已发布文章 ID',
  },
  key: {
    siteUrlHint: '请填写 Ghost 站点地址（Integration 页显示的 API URL）',
    siteUrl: '站点地址',
    adminKeyFormat: 'Admin API Key 的格式是「24 位 id:64 位密钥」',
    adminKey: 'Admin API Key',
  },
  binding: [
    '进入 Ghost 后台 → Settings → Integrations，新建 Custom Integration，起名「辰记」',
    '复制 API URL 和 Admin API Key，粘贴到这里并点「测试连接」',
    '在 Ghost 后台删除这个集成，密钥立刻作废',
  ],
  imagesWillUpload: (n: number) => `${n} 张图片将上传到 Ghost 站点`,
  draftOnly: '以未公开状态保存到 Ghost，检查后在 Ghost 后台发布',
  relaying: '由服务器代发到 Ghost',
  done: '完成',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    form: {
      status: '發布方式',
      visibility: '可見範圍',
      featured: '精選',
      slugFormat: '只能用小寫字母、數字和 -',
      slug: '網址',
      uploadImages: '圖片上傳到 Ghost',
      setCanonical: '設定原文連結',
      httpUrl: '請填寫以 http(s):// 開頭的網址',
      canonicalUrl: '原文連結',
      idFormat: '文章 ID 是 24 位十六進位',
      externalId: '已發布文章 ID',
    },
    key: {
      siteUrlHint: '請填寫 Ghost 網站網址（Integration 頁顯示的 API URL）',
      siteUrl: '網站網址',
      adminKeyFormat: 'Admin API Key 的格式是「24 位 id:64 位金鑰」',
      adminKey: 'Admin API Key',
    },
    binding: [
      '進入 Ghost 後台 → Settings → Integrations，新增 Custom Integration，命名為「辰記」',
      '複製 API URL 和 Admin API Key，貼到這裡並按「測試連線」',
      '在 Ghost 後台刪除這個整合，金鑰立即失效',
    ],
    imagesWillUpload: (n) => `${n} 張圖片將上傳到 Ghost 網站`,
    draftOnly: '以未公開狀態儲存到 Ghost，檢查後在 Ghost 後台發布',
    relaying: '由伺服器代發到 Ghost',
    done: '完成',
  },
  en: {
    form: {
      status: 'Publish as',
      visibility: 'Visibility',
      featured: 'Featured',
      slugFormat: 'Only lowercase letters, digits and -',
      slug: 'URL slug',
      uploadImages: 'Upload images to Ghost',
      setCanonical: 'Set the canonical link',
      httpUrl: 'Enter a URL starting with http(s)://',
      canonicalUrl: 'Canonical link',
      idFormat: 'A post ID is 24 hexadecimal characters',
      externalId: 'Published post ID',
    },
    key: {
      siteUrlHint: 'Enter your Ghost site URL (the API URL shown on the integration page)',
      siteUrl: 'Site URL',
      adminKeyFormat: 'An Admin API Key looks like “24-character id:64-character secret”',
      adminKey: 'Admin API Key',
    },
    binding: [
      'In Ghost Admin → Settings → Integrations, add a Custom Integration named “StarNote”',
      'Copy the API URL and the Admin API Key, paste them here and click “Test connection”',
      'Deleting the integration in Ghost Admin revokes the key at once',
    ],
    imagesWillUpload: (n) => `${plural(n, 'image')} will be uploaded to the Ghost site`,
    draftOnly: 'Saved to Ghost unpublished: check it, then publish from Ghost Admin',
    relaying: 'Sending to Ghost through the server',
    done: 'Done',
  },
});
