import type { z } from 'zod';

import type { DesktopSessionSpec } from './desktop-session';
import type { SdkLang } from './i18n/lang';
import type { NeedInputRequest, PublishEventInput, Runtime } from './types';

/** How an account is linked (SPEC-r8 §12.3). */
export type CredentialKind =
  /** 辰记's own login; nothing to bind. */
  | 'session'
  /** OAuth user authorization (微博 / WordPress.com / LinkedIn / X / Threads / Google …); see `provider`. */
  | 'oauth'
  /**
   * A token the user creates on the platform and pastes into 辰记: GitHub fine-grained PAT, 语雀 /
   * Dev.to / Hashnode / Medium legacy token / Ghost admin key.
   */
  | 'token'
  /** 公众号 AppID + AppSecret (+ IP whitelist). */
  | 'app-secret'
  /** 公众号 authorised to our WeChat Open Platform third-party app. */
  | 'wx-component'
  /** QR-code login state, kept only in a desktop partition. */
  | 'cookie'
  /** No account: hand-off / copy only platforms. */
  | 'none';

/** Where the credential lives. */
export type CredentialStore = 'server' | 'desktop' | 'none';

/** What each store means; shown in the settings page and kept in sync with the API docs. */
export const CREDENTIAL_STORES: Record<
  CredentialStore,
  { location: string; encryption: string; readers: string }
> = {
  server: {
    location: 'platform_accounts.secret_ciphertext',
    encryption:
      '信封加密：每条记录一把 DEK（AES-256-GCM），DEK 由 KEK（KMS / 环境变量）加密，secret_key_id 支持轮换',
    readers:
      '令牌类平台（GitHub Pages / DEV / Hashnode / Ghost / WordPress）只在用户打开「云端代发」后才存这里，关闭即删除（DELETE /me/platform-accounts/{id}/cloud）；只有服务器的代发接口读取，浏览器端不持有第三方 token',
  },
  desktop: {
    location:
      'Electron 会话分区 persist:pub-<platform>-<accountId>（cookie，只在本机）；令牌类平台默认也只存本机（safeStorage 加密写入 userData，SPEC-r8 §12.3.1）；账号元数据（不含凭据）经 safeStorage 加密写入 userData',
    encryption: '系统钥匙串（safeStorage）',
    readers:
      '只有本机主进程解密，直接调用平台官方接口（请求体与服务器代发同一份）；服务器只存展示信息（PUT /me/platform-accounts/{platform}/local）',
  },
  none: { location: '—', encryption: '—', readers: '—' },
};

/** Declares how a platform binds accounts; plain data, safe to ship to the browser. */
export interface BindingSpec {
  kind: CredentialKind;
  store: CredentialStore;
  /** Who issues the credential, e.g. `github`. */
  provider?: string;
  /** `token` / `app-secret`: the fields the user fills in, in order (e.g. `['repo', 'token']`). */
  fields?: string[];
  /** Validation of those fields (rendered with the zod → antd helpers). */
  form?: z.ZodObject<any>;
  /** SPEC-r14 B5: `form` with labels and messages in `lang` (read with `bindingForm(spec, lang)`). */
  formFor?(lang: SdkLang): z.ZodObject<any>;
  /** `oauth`: scopes requested. */
  scopes?: string[];
  /** `token`: the permissions to grant when creating it, as shown to the user. */
  permissions?: string[];
  /** SPEC-r14 B5: `permissions` in `lang` (`bindingPermissions(spec, lang)`). */
  permissionsFor?(lang: SdkLang): string[];
  /** Where the credential is created (token page, developer settings…). */
  createUrl?: string;
  /** Step-by-step help shown next to the form (`zh-CN`). */
  instructions?: string[];
  /** SPEC-r14 B5: `instructions` in `lang` (`bindingInstructions(spec, lang)`). */
  instructionsFor?(lang: SdkLang): string[];
  helpUrl?: string;
  /** Things to pick after binding: 知识库、专栏、仓库、Page… */
  selects?: Array<{ id: string; title: string }>;
  /** SPEC-r14 B5: `selects` with titles in `lang` (`bindingSelects(spec, lang)`). */
  selectsFor?(lang: SdkLang): Array<{ id: string; title: string }>;
  /** Health check period in seconds; the host calls `status()` this often. */
  checkEvery?: number;
  /**
   * `kind: 'cookie'` (desktop login state): the login page, success rule and read-only check of the bundled
   * site script. The signed site script's `session` wins at run time; this is the default the UI can show.
   */
  desktopSession?: DesktopSessionSpec;
}

/** A bound account as the host and adapters see it; never carries the secret. */
export interface AccountRef {
  /** `platform_accounts.id` */
  id: string;
  platform: string;
  externalUid: string;
  displayName: string;
  avatarUrl?: string;
  store: CredentialStore;
  /** `store: 'desktop'`: which desktop holds the login state. */
  deviceId?: string;
  /** `repo_full_name`, `installation_id`, `book_id`, `page_id` … */
  meta?: Record<string, unknown>;
}

export type AccountState =
  'ok' | 'expiring' | 'expired' | 'needs-relogin' | 'revoked' | 'limited' | 'unknown';

export interface AccountStatus {
  state: AccountState;
  checkedAt: string;
  expiresAt?: string;
  /** 「IP 不在白名单：x.x.x.x」「发表接口无权限（48001）」 */
  detail?: string;
  quota?: { remaining: number; resetAt?: string };
}

export interface UnbindResult {
  /** True when the credential was revoked on the platform too (OAuth revoke…). */
  revoked: boolean;
  /** A step left to the user, e.g. uninstalling the GitHub App from their settings. */
  followUp?: { label: string; href: string };
}

/** The only door to stored secrets; adapters never see where they are kept. */
export interface SecretVault {
  get(accountId: string): Promise<Record<string, string> | null>;
  put(accountId: string, secret: Record<string, string>): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export interface BindContext {
  runtime: Runtime;
  emit(e: PublishEventInput): void;
  needInput(req: NeedInputRequest): Promise<string>;
  /** Web: `window.open`; desktop: `shell.openExternal`. */
  openExternal(url: string): Promise<void>;
  page?(partition: string): Promise<unknown>;
  /** Fetch with the 辰记 login, for our own API. */
  api: typeof fetch;
  /** Server / desktop only. */
  vault?: SecretVault;
}

/** bind / status / unbind for one platform. */
export interface BindingDriver {
  bind(ctx: BindContext, input?: Record<string, unknown>): Promise<AccountRef>;
  status(account: AccountRef, ctx: BindContext): Promise<AccountStatus>;
  /** Clears the credential; revokes it on the platform where possible. */
  unbind(account: AccountRef, ctx: BindContext): Promise<UnbindResult>;
  refresh?(account: AccountRef, ctx: BindContext): Promise<AccountStatus>;
}

/** True when publishing needs a bound account first. */
export function needsBinding(spec: Pick<BindingSpec, 'kind'> | undefined): boolean {
  return !!spec && spec.kind !== 'session' && spec.kind !== 'none';
}
