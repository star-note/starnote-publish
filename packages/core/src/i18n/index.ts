/**
 * `@starnote/publish-core/i18n` (SPEC-r14 B5): the SDK's languages, the core dictionaries and the helpers adapters
 * use for their own. Also re-exported from the package root.
 *
 * How callers pass the language: `createPublisher({ lang })` / `PublishJob.lang` (→ `PublishContext.lang` for the
 * adapters), `publisher.preview(platform, { lang })`, `PrepareInput.lang`, `checkCompliance({ …, lang })`,
 * `planRuntime(target, env, { lang })`, `checkMedia(…, { lang })`, `zodToAntdRules(schema, { lang })`,
 * `adapterSchema(adapter, lang)` / `bindingForm` / `bindingInstructions` / `bindingPermissions` / `bindingSelects`
 * `(spec, lang)` for forms, and
 * `platformLabel(key, lang)` for names. Every `lang` is optional (default `zh-CN`) and accepts any tag
 * (`normalizeLang`).
 */
export {
  byLang,
  DEFAULT_SDK_LANG,
  defineMessages,
  fmt,
  isSdkLang,
  normalizeLang,
  pickText,
  SDK_LANGS,
  type I18nText,
  type LangTable,
  type SdkLang,
} from './lang';
export { COMPLIANCE_MESSAGES, coreMessages, formatDuration, type CoreMessages } from './messages';
export { localizedLabel, PLATFORM_LABELS } from './labels';
export { platformLabel } from '../platforms';
