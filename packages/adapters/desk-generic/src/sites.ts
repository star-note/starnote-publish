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

/** SPEC-r13 §6 第一批、第二批的国内平台：还没有用真实账号核实编辑器，先走通用模式。 */
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
};
