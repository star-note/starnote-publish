/** The core dictionaries (no registry import, so any core module can use them without an import cycle). */
import en from './locales/en';
import zhCN from './locales/zh-CN';
import zhTW from './locales/zh-TW';
import { defineMessages } from './lang';

import type { CoreMessages } from './locales/zh-CN';

export type { CoreMessages };

/** The core SDK's messages: `coreMessages(lang).publisher.publishing`. */
export const coreMessages = defineMessages<CoreMessages>({ 'zh-CN': zhCN, 'zh-TW': zhTW, en });

/**
 * The compliance and learned-rule templates of every language, as data (`{name}` placeholders): what
 * `platforms.json` carries for the API's Python port (`compliance.messages`).
 */
export const COMPLIANCE_MESSAGES = {
  'zh-CN': { ...zhCN.compliance, learned: zhCN.learned },
  'zh-TW': { ...zhTW.compliance, learned: zhTW.learned },
  en: { ...en.compliance, learned: en.learned },
} as const;

/** 「30 秒」「2 minutes」: a wait / duration in the language. */
export function formatDuration(sec: number, lang?: string | null): string {
  const w = coreMessages(lang).wait;
  if (sec < 60) return w.seconds(Math.max(1, Math.round(sec)));
  if (sec < 3600) return w.minutes(Math.round(sec / 60));
  return w.hours(Math.round(sec / 3600));
}
