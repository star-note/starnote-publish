/**
 * SPEC-r14 B5: the SDK speaks 简体中文 (the source), 繁體中文 (Taiwan wording) and English. Every function that
 * produces text a user reads takes a `lang` (an option, or `PublishContext.lang`); without one it answers in
 * `zh-CN`, as before. Not translated: platform names in `label`, the compliance lexicons, what is sent to the
 * platforms (titles, bodies, the 「参考链接」 heading…) and AI prompts.
 */

/** The SDK's languages (SPEC-r14 B1 `Lang`). */
export type SdkLang = 'zh-CN' | 'zh-TW' | 'en';

export const SDK_LANGS: readonly SdkLang[] = ['zh-CN', 'zh-TW', 'en'];

/** What every function falls back to when no language is given. */
export const DEFAULT_SDK_LANG: SdkLang = 'zh-CN';

/**
 * Any language tag → an `SdkLang` (SPEC-r14 B1): `zh-TW` / `zh-HK` / `zh-MO` / `zh-Hant*` → `zh-TW`, other `zh*` →
 * `zh-CN`, anything else → `en`. Empty / absent → `zh-CN` (the SDK's default, not the browser's).
 */
export function normalizeLang(input?: string | null): SdkLang {
  if (!input) return DEFAULT_SDK_LANG;
  const tag = input.trim().replace(/_/g, '-').toLowerCase();
  if (!tag) return DEFAULT_SDK_LANG;
  if (tag.startsWith('zh')) {
    if (/^zh-(?:tw|hk|mo)\b/.test(tag) || /^zh-hant\b/.test(tag)) return 'zh-TW';
    return 'zh-CN';
  }
  return 'en';
}

export function isSdkLang(value: unknown): value is SdkLang {
  return value === 'zh-CN' || value === 'zh-TW' || value === 'en';
}

/** A text in several languages; the plain field next to it keeps the source (`zh-CN` or the original name). */
export type I18nText = Partial<Record<SdkLang, string>>;

/** `i18n[lang]`, else `base` (the source text). */
export function pickText(base: string, i18n: I18nText | undefined, lang?: string | null): string {
  if (!lang || !i18n) return base;
  return i18n[normalizeLang(lang)] ?? base;
}

/** The same thing in all three languages (the type makes a missing language a compile error). */
export type LangTable<T> = Record<SdkLang, T>;

/**
 * A dictionary getter: `msg(lang)` → the messages of that language (any tag, see `normalizeLang`; default
 * `zh-CN`). Write the `zh-CN` object first and type the others with it, so a missing key fails to compile:
 *
 * ```ts
 * const zhCN = { saved: '已保存', count: (n: number) => `${n} 篇` };
 * export const msg = defineMessages<typeof zhCN>({ 'zh-CN': zhCN, 'zh-TW': { … }, en: { … } });
 * msg(ctx.lang).count(3);
 * ```
 */
export function defineMessages<T>(table: LangTable<T>): ((lang?: string | null) => T) & {
  table: LangTable<T>;
} {
  const get = (lang?: string | null) => table[normalizeLang(lang)];
  return Object.assign(get, { table });
}

/**
 * Something built per language and kept (a zod schema with translated labels…): `byLang(build)(lang)` builds once
 * per language.
 */
export function byLang<T>(build: (lang: SdkLang) => T): (lang?: string | null) => T {
  const cache = new Map<SdkLang, T>();
  return (lang) => {
    const l = normalizeLang(lang);
    let v = cache.get(l);
    if (v === undefined) {
      v = build(l);
      cache.set(l, v);
    }
    return v;
  };
}

/**
 * Fills `{name}` placeholders: `fmt('标签 {n} 个', { n: 3 })`. Used by the messages that are also exported as data
 * (compliance → `platforms.json` → the Python port, which fills the same placeholders with `str.format`).
 */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in params ? String(params[name]) : all
  );
}
