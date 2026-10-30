/** SPEC-r14 B5: platform names in the SDK's languages (plain data; the registry adds them as `labels`). */
import { normalizeLang } from './lang';

import type { I18nText } from './lang';

/**
 * SPEC-r14 B5: platform names in the SDK's languages, where they differ from `label` (each brand's own English /
 * romanized name; 繁體 forms of the Chinese names). Read with `platformLabel(key, lang)`.
 */
export const PLATFORM_LABELS: Readonly<Record<string, I18nText>> = {
  chenji: { 'zh-TW': '辰記', en: 'StarNote' },
  wechat: { 'zh-TW': '微信公眾號', en: 'WeChat Official Account' },
  zhihu: { en: 'Zhihu' },
  juejin: { en: 'Juejin' },
  xiaohongshu: { 'zh-TW': '小紅書', en: 'Xiaohongshu (RedNote)' },
  'xiaohongshu-article': { 'zh-TW': '小紅書長文', en: 'Xiaohongshu (RedNote) long-form' },
  yuque: { 'zh-TW': '語雀', en: 'Yuque' },
  weibo: { en: 'Weibo' },
  'weibo-article': { 'zh-TW': '微博頭條文章', en: 'Weibo article' },
  toutiao: { 'zh-TW': '頭條號', en: 'Toutiao' },
  baijiahao: { 'zh-TW': '百家號', en: 'Baijiahao' },
  netease: { 'zh-TW': '網易號', en: 'NetEase Hao' },
  sohu: { 'zh-TW': '搜狐號', en: 'Sohu Hao' },
  'qq-om': { 'zh-TW': '企鵝號', en: 'Tencent Qiehao' },
  dayu: { 'zh-TW': '大魚號', en: 'Dayu' },
  yidian: { 'zh-TW': '一點號', en: 'Yidian' },
  bilibili: { 'zh-TW': '嗶哩嗶哩', en: 'Bilibili' },
  douyin: { en: 'Douyin' },
  'douyin-article': { en: 'Douyin article' },
  kuaishou: { en: 'Kuaishou' },
  'wechat-channels': { 'zh-TW': '視頻號', en: 'WeChat Channels' },
  jianshu: { 'zh-TW': '簡書', en: 'Jianshu' },
  smzdm: { 'zh-TW': '什麼值得買', en: 'SMZDM' },
  cnblogs: { 'zh-TW': '博客園', en: 'Cnblogs' },
  segmentfault: { en: 'SegmentFault' },
  oschina: { 'zh-TW': '開源中國', en: 'OSCHINA' },
  'tencent-cloud': { 'zh-TW': '騰訊雲開發者社區', en: 'Tencent Cloud Developer Community' },
  xueqiu: { en: 'Xueqiu (Snowball)' },
  eastmoney: { 'zh-TW': '東方財富', en: 'East Money' },
  huxiu: { en: 'Huxiu' },
  woshipm: { 'zh-TW': '人人都是產品經理', en: 'Woshipm' },
  sspai: { 'zh-TW': '少數派', en: 'Sspai' },
  zsxq: { 'zh-TW': '知識星球', en: 'ZSXQ (Knowledge Planet)' },
  dongchedi: { 'zh-TW': '懂車帝', en: 'Dongchedi' },
  hupu: { 'zh-TW': '虎撲', en: 'Hupu' },
  douban: { en: 'Douban' },
  'douban-read': { 'zh-TW': '豆瓣閱讀', en: 'Douban Read' },
  mafengwo: { 'zh-TW': '馬蜂窩', en: 'Mafengwo' },
  hatena: { en: 'Hatena Blog' },
  kakuyomu: { en: 'Kakuyomu' },
  'naver-blog': { en: 'Naver Blog' },
  brunch: { en: 'Brunch Story' },
  postype: { en: 'Postype' },
  vocus: { en: 'vocus' },
};

/**
 * `label` (an adapter's or a host's own name for the platform) in `lang`: the registry's `labels[lang]` when there is
 * one, else `label` unchanged — so `zh-CN` output is exactly what it was before the SDK spoke other languages.
 */
export function localizedLabel(key: string, label: string, lang?: string | null): string {
  if (!lang) return label;
  return PLATFORM_LABELS[key]?.[normalizeLang(lang)] ?? label;
}
