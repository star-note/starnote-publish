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

/** SPEC-r13 §6 的国内平台和 SPEC-r14 A2 的海外平台：还没有用真实账号核实编辑器，先走通用模式。 */
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
};
