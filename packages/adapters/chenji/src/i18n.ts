/** SPEC-r14 B5: the 辰记 adapter's user-visible texts (form labels, validation, progress, errors). */
import { defineMessages } from '@starnote/publish-core';

const zhCN = {
  pickCategory: '请选择分类',
  categoryName: '请输入分类名',
  categoryNameMax: '分类名最多 40 个字符',
  category: '分类',
  converting: '转换正文',
  uploading: '上传到辰记',
  unreadable: (status: number) => `辰记服务返回了无法解析的响应（HTTP ${status}）`,
  failed: (code: number | string) => `发布失败（${code}）`,
  done: '发布完成',
};

export const msg = defineMessages<typeof zhCN>({
  'zh-CN': zhCN,
  'zh-TW': {
    pickCategory: '請選擇分類',
    categoryName: '請輸入分類名稱',
    categoryNameMax: '分類名稱最多 40 個字元',
    category: '分類',
    converting: '轉換內文',
    uploading: '上傳到辰記',
    unreadable: (status) => `辰記服務回傳了無法解析的回應（HTTP ${status}）`,
    failed: (code) => `發布失敗（${code}）`,
    done: '發布完成',
  },
  en: {
    pickCategory: 'Choose a category',
    categoryName: 'Enter a category name',
    categoryNameMax: 'Category name can be at most 40 characters',
    category: 'Category',
    converting: 'Converting the article',
    uploading: 'Uploading to StarNote',
    unreadable: (status) => `StarNote returned a response that can’t be read (HTTP ${status})`,
    failed: (code) => `Publishing failed (${code})`,
    done: 'Published',
  },
});
