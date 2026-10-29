/**
 * @starnote/publish-wechat-mp — 微信公众号个人号的桌面端路线（browser-safe entry）：schema、`convertWechat` 渲染 / 预览、
 * 绑定声明、随包签名站点脚本与适配器工厂。登录与请求由 starnote-desktop 主进程实现（`ctx.sessionFetch`）。
 * 只存进公众号后台（草稿箱），发表与群发由用户本人在后台完成。
 */
import {
  bundledScript,
  platformMeta,
  sessionPartition,
  verifySession,
} from '@starnote/publish-core';

import { WECHAT_MP_SITE_SCRIPT } from './adapter';

import type {
  PlatformMeta,
  SessionCheckResult,
  SessionFetch,
  SiteScript,
} from '@starnote/publish-core';

export {
  createWechatMpAdapter,
  WECHAT_HANDOFF_TEXT,
  WECHAT_MP_SITE_SCRIPT,
  WECHAT_RELOGIN_TEXT,
  wechatMpBinding,
  type WechatMpAdapterOptions,
} from './adapter';
export { isWechatImage, renderWechatMp, replaceImageSrcs, type WechatMpRendered } from './render';
export {
  wechatMpSchema,
  wechatMpSchemaFor,
  type WechatMpForm,
  type WechatMpFormInput,
} from './schema';
export { msg as wechatMpMessages } from './i18n';

export const wechatMeta = platformMeta('wechat') as PlatformMeta;

/** Read-only: is the 后台 login still valid (公众号 logins expire in days), and the account name. */
export function verify(
  sessionFetch: SessionFetch,
  accountId: string,
  script: SiteScript = bundledScript(WECHAT_MP_SITE_SCRIPT)
): Promise<SessionCheckResult> {
  return verifySession(script, sessionFetch, sessionPartition('wechat', accountId));
}
