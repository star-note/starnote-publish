/**
 * Helpers shared by the logged-in (desktop session) adapters — 知乎、掘金、CSDN and later 头条号、百家号…:
 * resolve the site script and the account's partition, rehost images one by one with a report, prefill a
 * platform editor for hand-off, and the read-only `verify`. Stable logic only; everything volatile is in
 * the site script.
 */
import { interpretSessionCheck, sessionPartition } from './desktop-session';
import { loadSiteScript, peekSiteScript } from './site-script';
import { createSessionClient, PlatformSessionError } from './session-client';

import type { AccountRef } from './binding';
import type { SessionCheckResult, SessionFetch, SessionPage } from './desktop-session';
import type { ReportItem } from './report';
import type { SignedSiteScript, SiteScript } from './site-script';
import type { SessionClient } from './session-client';
import type { PublishContext } from './types';

export interface SessionAdapterOptions {
  /** Overrides the site script (tests, or a host that already loaded and verified one). */
  siteScript?: (ctx: PublishContext) => Promise<SiteScript>;
  /** Try `GET {apiBase}/publish/site-scripts/{platform}` first. Default true. */
  remoteScript?: boolean;
  /** Public keys for site scripts (default `SITE_SCRIPT_KEYS`). */
  publicKeys?: Record<string, string | CryptoKey>;
  /** Base for relative image URLs (the 辰记 asset origin). */
  assetBase?: string;
  /** @deprecated pacing moved to the desktop's sessionFetch (`script.pacing`); ignored. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SessionRun {
  script: SiteScript;
  client: SessionClient;
  partition: string;
  account: AccountRef;
}

export const CHALLENGE_PROMPT = '请在窗口中完成验证';

/**
 * Hands captcha / slider / SMS / risk-control pages to the user: shows the platform's own page in the account's
 * window, pauses with `needInput`「请在窗口中完成验证」, then repeats the call once the user says done. Nothing is
 * recognised or solved automatically. Without a window to show (no desktop page) the error goes up as is.
 */
export function withChallengeHandover(
  client: SessionClient,
  ctx: Pick<PublishContext, 'page' | 'needInput' | 'emit'>,
  label: string,
  maxHandovers = 2
): SessionClient {
  let seq = 0;
  return {
    partition: client.partition,
    has: (name) => client.has(name),
    async call(name, args) {
      for (let handed = 0; ; handed++) {
        try {
          return await client.call(name, args);
        } catch (e) {
          if (!(e instanceof PlatformSessionError) || e.kind !== 'challenge') throw e;
          const page = ctx.page ? asSessionPage(await ctx.page(client.partition)) : null;
          if (!page || handed >= maxHandovers)
            throw new PlatformSessionError(
              'help',
              `${label}要求完成验证，请在${label}网页上完成后重试`,
              {
                ...(e.challengeUrl ? { helpUrl: e.challengeUrl } : {}),
              }
            );
          if (e.challengeUrl) await page.goto(e.challengeUrl);
          await page.show();
          ctx.emit({
            type: 'log',
            level: 'warn',
            text: `${label}要求验证，已暂停，等你在窗口中完成`,
          });
          await ctx.needInput({ id: `verify-${++seq}`, kind: 'confirm', title: CHALLENGE_PROMPT });
        }
      }
    },
  };
}

/**
 * Loads the site script (remote → bundled), checks the remote kill switch, and builds the session client
 * for the account in `ctx.account`. Throws `PlatformSessionError` when the host cannot run it.
 */
export async function openSessionRun(
  ctx: PublishContext,
  platform: string,
  label: string,
  bundled: SignedSiteScript,
  opts: SessionAdapterOptions = {}
): Promise<SessionRun> {
  let script: SiteScript;
  if (opts.siteScript) script = await opts.siteScript(ctx);
  else {
    const loaded = await loadSiteScript(platform, {
      bundled,
      fetch: ctx.fetch,
      apiBase: ctx.apiBase,
      remote: opts.remoteScript !== false,
      ...(opts.publicKeys ? { publicKeys: opts.publicKeys } : {}),
    });
    for (const w of loaded.warnings) ctx.emit({ type: 'log', level: 'warn', text: w });
    script = loaded.script;
  }
  const helpUrl = script.urls.help ?? script.urls.home;
  if (script.flags?.disabled)
    throw new PlatformSessionError(
      'help',
      `${label}的自动发布暂时停用（平台改版处理中），请复制后手动发布`,
      {
        helpUrl,
      }
    );
  if (!ctx.sessionFetch)
    throw new PlatformSessionError('help', `${label}只能在辰记桌面端发布`, { helpUrl });
  const account = ctx.account;
  if (!account || account.platform !== platform)
    throw new PlatformSessionError('relogin', `还没有在桌面端登录${label}`, { helpUrl });
  const partition = sessionPartition(platform, account.id);
  // Pacing (serial per account, natural gaps, post gate, back-off) is enforced by the desktop's sessionFetch.
  const client = withChallengeHandover(
    createSessionClient({ script, partition, sessionFetch: ctx.sessionFetch, label }),
    ctx,
    label
  );
  return { script, client, partition, account };
}

/** The bundled script without verification — only for previews (nothing is sent anywhere). */
export function bundledScript(bundled: SignedSiteScript): SiteScript {
  return peekSiteScript(bundled);
}

export interface RehostOptions {
  label: string;
  /** Images already on the platform (its CDN, formula images): skipped. */
  skip?: (url: string) => boolean;
  assetBase?: string;
  onProgress?: (done: number, total: number) => void;
}

/** Absolute https/http URL, or null (data: URLs, unresolvable relatives). */
export function absoluteImageUrl(src: string, base?: string): string | null {
  if (!src || src.startsWith('data:') || src.startsWith('blob:')) return null;
  try {
    const fallback = (globalThis as { location?: { href?: string } }).location?.href;
    const u = new URL(src, base ?? fallback);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Uploads every image through `upload` (one at a time, so a platform's rate limit is respected). A failed
 * image keeps its original link; relogin / rate-limit errors still abort (they would fail everything).
 */
export async function rehostImages(
  srcs: readonly string[],
  upload: (absoluteUrl: string) => Promise<string | undefined>,
  opts: RehostOptions
): Promise<{ map: Map<string, string>; report: ReportItem[] }> {
  const map = new Map<string, string>();
  const failed: string[] = [];
  let rehosted = 0;
  const todo = srcs.filter((s) => !opts.skip?.(s));
  let done = 0;
  for (const src of todo) {
    const abs = absoluteImageUrl(src, opts.assetBase);
    try {
      if (!abs) throw new Error('不是可访问的图片地址');
      const url = await upload(abs);
      if (!url) throw new Error('平台没有返回图片地址');
      map.set(src, url);
      rehosted++;
    } catch (e) {
      if (e instanceof PlatformSessionError && e.kind !== 'help') throw e;
      failed.push(src);
    }
    opts.onProgress?.(++done, todo.length);
  }
  const report: ReportItem[] = [];
  if (rehosted)
    report.push({
      kind: 'image.rehosted',
      text: `${rehosted} 张图片已上传到${opts.label}`,
      count: rehosted,
      level: 'info',
    });
  if (failed.length)
    report.push({
      kind: 'image.failed',
      text: `${failed.length} 张图片转存到${opts.label}失败，已保留原图链接（原图失效或被防盗链时会显示不出来）`,
      count: failed.length,
      level: 'warn',
      samples: failed.slice(0, 3),
    });
  return { map, report };
}

export interface EditorHandoff {
  editorUrl: string;
  /** Title for `insertText`, body for the clipboard paste (`html` for rich editors, `text` for Markdown ones). */
  prefill?: { title?: string; html?: string; text?: string };
}

export interface EditorHandoffResult {
  /** `desk`: queued on the desktop's 发布台; `page`: a single window; `none`: no desktop window available. */
  via: 'desk' | 'page' | 'none';
  /** Only known for `page` (the desk reports problems itself). */
  filled?: { title: boolean; body: boolean };
}

/**
 * Layer 3 (预填加交接): opens the platform's own editor in the account's session and fills it like a person
 * would — the title with `insertText`, the body pasted from the clipboard — then leaves「发布」to the user.
 * Prefers the desktop's 发布台 (`ctx.handoff`); falls back to one window (`ctx.page`). Selectors come from the
 * signed site script (`selectors.title` / `selectors.editor`).
 */
export async function handOffEditor(
  ctx: PublishContext,
  run: SessionRun,
  label: string,
  h: EditorHandoff
): Promise<EditorHandoffResult> {
  if (ctx.handoff) {
    await ctx.handoff({
      taskId: `${ctx.noteId}:${run.script.platform}:${run.account.id}`,
      platform: run.script.platform,
      accountId: run.account.id,
      editorUrl: h.editorUrl,
      label,
      ...(h.prefill ? { prefill: h.prefill } : {}),
    });
    return { via: 'desk' };
  }
  const page = ctx.page ? asSessionPage(await ctx.page(run.partition)) : null;
  if (!page) return { via: 'none' };
  await page.goto(h.editorUrl);
  await page.show();
  if (!h.prefill) return { via: 'page' };
  const filled = { title: false, body: false };
  const editor = run.script.selectors.editor;
  const ready = editor
    ? await page.waitForSelector(editor, run.script.waits?.editor?.timeoutMs ?? 20_000)
    : false;
  if (ready) {
    if (h.prefill.title && run.script.selectors.title && page.insertText) {
      try {
        await page.insertText(run.script.selectors.title, h.prefill.title);
        filled.title = true;
      } catch {
        /* reported by the caller */
      }
    }
    if ((h.prefill.text || h.prefill.html) && page.pasteHtml) {
      try {
        await page.pasteHtml(editor!, {
          text: h.prefill.text ?? '',
          ...(h.prefill.html ? { html: h.prefill.html } : {}),
        });
        filled.body = true;
      } catch {
        /* reported by the caller */
      }
    }
  }
  return { via: 'page', filled };
}

/** The report line for a prefill hand-off. */
export function handoffReport(res: EditorHandoffResult, label: string): ReportItem[] {
  const items: ReportItem[] = [];
  if (res.via === 'none')
    items.push({
      kind: 'prefill.failed',
      text: `没有可用的桌面窗口，请复制内容到${label}编辑器里粘贴`,
      level: 'warn',
    });
  else if (res.filled && (!res.filled.title || !res.filled.body))
    items.push({
      kind: 'prefill.failed',
      text: `没能自动填入${res.filled.body ? '标题' : res.filled.title ? '正文' : '标题和正文'}，请从辰记复制后粘贴到${label}编辑器`,
      level: 'warn',
    });
  return items;
}

export const HANDOFF_FILLED_TEXT = '已填好，请在窗口中检查后点发布';

export function asSessionPage(page: unknown): SessionPage | null {
  const p = page as Partial<SessionPage> | null;
  return p && typeof p.goto === 'function' && typeof p.show === 'function'
    ? (p as SessionPage)
    : null;
}

/** Read-only: who is logged in on this partition, via the script's check endpoint. */
export async function verifySession(
  script: SiteScript,
  sessionFetch: SessionFetch,
  partition: string
): Promise<SessionCheckResult> {
  const check = script.session?.check;
  if (!check) return { state: 'error', detail: '站点脚本没有检查接口' };
  try {
    const res = await sessionFetch(partition, check.url, {
      method: 'GET',
      ...(check.csrf ? { csrf: check.csrf } : {}),
    });
    return interpretSessionCheck(check, res);
  } catch (e) {
    return { state: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}
