/** The bundled, signed 通用模式 site scripts (`node scripts/sign-site-scripts.mjs` signs `sites/<key>.json`). */
import type { SignedSiteScript } from '@starnote/publish-core';

import xueqiu from './sites/xueqiu.signed.json';
import eastmoney from './sites/eastmoney.signed.json';
import huxiu from './sites/huxiu.signed.json';
import woshipm from './sites/woshipm.signed.json';
import sspai from './sites/sspai.signed.json';
import zsxq from './sites/zsxq.signed.json';
import dongchedi from './sites/dongchedi.signed.json';
import hupu from './sites/hupu.signed.json';
import douban from './sites/douban.signed.json';
import douban_read from './sites/douban-read.signed.json';
import mafengwo from './sites/mafengwo.signed.json';
import note from './sites/note.signed.json';
import kakuyomu from './sites/kakuyomu.signed.json';
import naver_blog from './sites/naver-blog.signed.json';
import tistory from './sites/tistory.signed.json';
import brunch from './sites/brunch.signed.json';
import postype from './sites/postype.signed.json';
import vocus from './sites/vocus.signed.json';
import webnovel from './sites/webnovel.signed.json';
import wattpad from './sites/wattpad.signed.json';
import steady from './sites/steady.signed.json';
import kofi from './sites/kofi.signed.json';
// 国内大平台（2026-10 调研）
import toutiao from './sites/toutiao.signed.json';
import bilibili from './sites/bilibili.signed.json';
import weibo_article from './sites/weibo-article.signed.json';
import sohu from './sites/sohu.signed.json';
import qq_om from './sites/qq-om.signed.json';
import douyin_article from './sites/douyin-article.signed.json';
import xiaohongshu_article from './sites/xiaohongshu-article.signed.json';
import baijiahao from './sites/baijiahao.signed.json';
import netease from './sites/netease.signed.json';
import jianshu from './sites/jianshu.signed.json';
// 技术社区（思否、51CTO 是 Markdown 编辑器，正文按 Markdown；腾讯云、开源中国默认是富文本）
import segmentfault from './sites/segmentfault.signed.json';
import oschina from './sites/oschina.signed.json';
import tencent_cloud from './sites/tencent-cloud.signed.json';
import cto51 from './sites/51cto.signed.json';

/**
 * SPEC-r13 §6 的国内平台和 SPEC-r14 A2 的海外平台：还没有用真实账号核实编辑器，走通用模式（复制粘贴）。
 * 国内大平台（`CN_DESK_KEYS`，2026-10 调研）和垂类里站点脚本有核对过的标题、正文选择器的，发布台自动填好；其余走通用模式。
 * 技术社区（`TECH_DESK_KEYS`）里思否、51CTO 是 Markdown 编辑器，站点脚本 `flags.body: 'markdown'`，正文按 Markdown；腾讯云、开源中国默认是富文本。
 */
export const GENERIC_DESK_KEYS = [
  'xueqiu',
  'eastmoney',
  'huxiu',
  'woshipm',
  'sspai',
  'zsxq',
  'dongchedi',
  'hupu',
  'douban',
  'douban-read',
  'mafengwo',
  // SPEC-r14 A2 海外
  'note',
  'kakuyomu',
  'naver-blog',
  'tistory',
  'brunch',
  'postype',
  'vocus',
  'webnovel',
  'wattpad',
  'steady',
  'kofi',
  // 国内大平台
  'toutiao',
  'bilibili',
  'weibo-article',
  'sohu',
  'qq-om',
  'douyin-article',
  'xiaohongshu-article',
  'baijiahao',
  'netease',
  'jianshu',
  // 技术社区
  'segmentfault',
  'oschina',
  'tencent-cloud',
  '51cto',
] as const;
export type GenericDeskKey = (typeof GENERIC_DESK_KEYS)[number];

export const GENERIC_SITE_SCRIPTS: Record<GenericDeskKey, SignedSiteScript> = {
  xueqiu: xueqiu as SignedSiteScript,
  eastmoney: eastmoney as SignedSiteScript,
  huxiu: huxiu as SignedSiteScript,
  woshipm: woshipm as SignedSiteScript,
  sspai: sspai as SignedSiteScript,
  zsxq: zsxq as SignedSiteScript,
  dongchedi: dongchedi as SignedSiteScript,
  hupu: hupu as SignedSiteScript,
  douban: douban as SignedSiteScript,
  'douban-read': douban_read as SignedSiteScript,
  mafengwo: mafengwo as SignedSiteScript,
  note: note as SignedSiteScript,
  kakuyomu: kakuyomu as SignedSiteScript,
  'naver-blog': naver_blog as SignedSiteScript,
  tistory: tistory as SignedSiteScript,
  brunch: brunch as SignedSiteScript,
  postype: postype as SignedSiteScript,
  vocus: vocus as SignedSiteScript,
  webnovel: webnovel as SignedSiteScript,
  wattpad: wattpad as SignedSiteScript,
  steady: steady as SignedSiteScript,
  kofi: kofi as SignedSiteScript,
  toutiao: toutiao as SignedSiteScript,
  bilibili: bilibili as SignedSiteScript,
  'weibo-article': weibo_article as SignedSiteScript,
  sohu: sohu as SignedSiteScript,
  'qq-om': qq_om as SignedSiteScript,
  'douyin-article': douyin_article as SignedSiteScript,
  'xiaohongshu-article': xiaohongshu_article as SignedSiteScript,
  baijiahao: baijiahao as SignedSiteScript,
  netease: netease as SignedSiteScript,
  jianshu: jianshu as SignedSiteScript,
  segmentfault: segmentfault as SignedSiteScript,
  oschina: oschina as SignedSiteScript,
  'tencent-cloud': tencent_cloud as SignedSiteScript,
  '51cto': cto51 as SignedSiteScript,
};

/** 国内大平台（2026-10 调研）：头条号、B 站专栏、微博头条文章、搜狐号、企鹅号、抖音文章、小红书长文自动填；百家号、网易号、简书走通用模式。 */
export const CN_DESK_KEYS = [
  'toutiao',
  'bilibili',
  'weibo-article',
  'sohu',
  'qq-om',
  'douyin-article',
  'xiaohongshu-article',
  'baijiahao',
  'netease',
  'jianshu',
] as const satisfies readonly GenericDeskKey[];

/** 技术社区：Markdown 编辑器的（站点脚本 `flags.body: 'markdown'`）正文用 Markdown；腾讯云、开源中国是富文本。 */
export const TECH_DESK_KEYS = [
  'segmentfault',
  'oschina',
  'tencent-cloud',
  '51cto',
] as const satisfies readonly GenericDeskKey[];
