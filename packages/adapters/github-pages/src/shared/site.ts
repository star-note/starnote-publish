/**
 * Site-level settings of a GitHub Pages blog (SPEC-r8-github-template §3, §9): what 辰记 keeps in the
 * repository's `content/site.json` (the `starnote` block, `cname`, `adsense`), the custom domain set on the
 * Pages site, and the DNS records the user adds for it.
 *
 * Why a custom domain: AdSense rarely approves a `*.github.io` address, so 「用自己的域名，开启广告收入」 turns
 * on both at once. The AdSense account is the user's own; the money goes straight to them.
 *
 * Mirrored by `starnote-api/app/services/github_publish.py` (`apply_site_settings`, `dns_records`,
 * `set_pages_domain`, `enforce_https`); keep both in step.
 */
import { github, repoPath } from './github';

import type { GitHubClientOptions } from './github';

/**
 * GitHub Pages addresses for an apex domain. Source: GitHub Docs, "Managing a custom domain for your GitHub
 * Pages site" → "Configuring an apex domain" (docs.github.com/en/pages/configuring-a-custom-domain-for-your-
 * github-pages-site/managing-a-custom-domain-for-your-github-pages-site). Keep in step with the API copy.
 */
export const GITHUB_PAGES_A_RECORDS = [
  '185.199.108.153',
  '185.199.109.153',
  '185.199.110.153',
  '185.199.111.153',
] as const;
/** Same page, optional IPv6 (AAAA) records. */
export const GITHUB_PAGES_AAAA_RECORDS = [
  '2606:50c0:8000::153',
  '2606:50c0:8001::153',
  '2606:50c0:8002::153',
  '2606:50c0:8003::153',
] as const;

/** `ca-pub-` + 16 digits (the template also accepts `pub-…`, we always write the `ca-` form). */
export const ADSENSE_CLIENT_RE = /^ca-pub-\d{16}$/;
/** An ad unit id (`data-ad-slot`): digits only. */
export const ADSENSE_SLOT_RE = /^\d{6,20}$/;

export type AdSlotKey = 'article' | 'end' | 'rail';
export const AD_SLOT_KEYS: readonly AdSlotKey[] = ['article', 'end', 'rail'];

export interface GithubAdsense {
  client: string;
  slots?: Partial<Record<AdSlotKey, string>>;
}

/** 「用自己的域名，开启广告收入」: both or neither (`null` turns them off). */
export interface GithubMonetize {
  domain: string;
  adsense: GithubAdsense;
}

/** The 辰记 side of the blog, written into `site.json` `starnote`. */
export interface StarnoteSiteInfo {
  handle: string;
  blogUrl: string;
  appUrl: string;
  apiUrl: string;
  /** Filled into `title` / `description` / `author.name` the first time only (sample site.json). */
  title?: string;
  description?: string;
  authorName?: string;
}

export interface GithubSiteSettings {
  starnote?: StarnoteSiteInfo;
  /** `undefined` leaves `cname` / `adsense` alone; `null` clears both. */
  monetize?: GithubMonetize | null;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * `https://Blog.Example.com/` → `blog.example.com`; throws on anything that is not a hostname with a dot,
 * and on `*.github.io` (that is the default address, not a custom domain).
 */
export function normalizeDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
  const labels = host.split('.');
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((l) => LABEL.test(l)) ||
    /^\d+$/.test(labels.at(-1)!)
  ) {
    throw new Error('请填写域名，例如 blog.example.com 或 example.com');
  }
  if (host === 'github.io' || host.endsWith('.github.io')) {
    throw new Error('github.io 是默认地址，这里填你自己的域名');
  }
  return host;
}

/** Second-level labels under which a registrable domain has three labels (`example.com.cn`, `example.co.uk`). */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'or', 'ne', 'go']);

/** `example.com` / `example.com.cn` → apex (A records); `blog.example.com` → subdomain (CNAME). */
export function isApexDomain(domain: string): boolean {
  const labels = domain.split('.');
  if (labels.length === 2) return true;
  return labels.length === 3 && labels[2]!.length === 2 && SECOND_LEVEL.has(labels[1]!);
}

export interface DnsRecord {
  type: 'CNAME' | 'A' | 'AAAA';
  /** Host / name as DNS panels ask for it: `@` for the apex, else the subdomain part. */
  host: string;
  value: string;
}

/** The registrable part: `blog.example.com` → `example.com`, `blog.example.com.cn` → `example.com.cn`. */
export function apexOf(domain: string): string {
  const labels = domain.split('.');
  const three = labels.slice(-3).join('.');
  return labels.length >= 3 && isApexDomain(three) ? three : labels.slice(-2).join('.');
}

/** What the user adds at their DNS provider for `domain` to serve `<owner>.github.io`. */
export function dnsRecords(domain: string, owner: string): DnsRecord[] {
  if (isApexDomain(domain)) {
    return GITHUB_PAGES_A_RECORDS.map((ip) => ({ type: 'A' as const, host: '@', value: ip }));
  }
  const host = domain.slice(0, -(apexOf(domain).length + 1));
  return [{ type: 'CNAME', host, value: `${owner.toLowerCase()}.github.io` }];
}

/** Checks the monetize input; throws a user-facing message on the first problem. */
export function normalizeMonetize(input: GithubMonetize): GithubMonetize {
  const domain = normalizeDomain(input.domain);
  const client = input.adsense.client.trim();
  if (!ADSENSE_CLIENT_RE.test(client)) {
    throw new Error('AdSense 发布商 ID 格式是 ca-pub- 加 16 位数字');
  }
  const slots: Partial<Record<AdSlotKey, string>> = {};
  for (const key of AD_SLOT_KEYS) {
    const v = (input.adsense.slots?.[key] ?? '').trim();
    if (!v) continue;
    if (!ADSENSE_SLOT_RE.test(v)) throw new Error('广告位 ID 只能是数字');
    slots[key] = v;
  }
  return { domain, adsense: { client, slots } };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};

/** The template's sample `site.json` (or an empty one): fill in the blog's own name the first time. */
function isSample(site: Json): boolean {
  const handle = obj(site.starnote).handle;
  return !handle || handle === 'demo';
}

/**
 * Pure: `site.json` with 辰记's settings applied. Only `starnote`, `cname`, `adsense` (and, the first time,
 * `title` / `description` / `author.name`) are touched; everything else the user edited stays as it is.
 * `adsense.consent` / `ads_txt_lines` are kept; the template writes `ads.txt` from `adsense.client`.
 */
export function applySiteSettings(site: Json, settings: GithubSiteSettings): Json {
  const out: Json = { ...site };
  const sn = settings.starnote;
  if (sn) {
    if (isSample(site)) {
      if (sn.title) out.title = sn.title;
      if (sn.description) out.description = sn.description;
      if (sn.authorName) out.author = { ...obj(site.author), name: sn.authorName };
    }
    out.starnote = {
      ...obj(site.starnote),
      handle: sn.handle,
      blog_url: sn.blogUrl,
      app_url: sn.appUrl,
      api_url: sn.apiUrl,
    };
  }
  if (settings.monetize !== undefined) {
    const m = settings.monetize;
    const prev = obj(site.adsense);
    out.cname = m ? m.domain : '';
    out.adsense = {
      ...prev,
      client: m ? m.adsense.client : '',
      slots: Object.fromEntries(AD_SLOT_KEYS.map((k) => [k, m?.adsense.slots?.[k] ?? ''])),
      consent: typeof prev.consent === 'string' && prev.consent ? prev.consent : 'cmp',
      ads_txt_lines: Array.isArray(prev.ads_txt_lines) ? prev.ads_txt_lines : [],
    };
  }
  return out;
}

/** `site.json` as committed: 2-space JSON + newline (Python: `json.dumps(indent=2, ensure_ascii=False)`). */
export function siteConfigText(site: Json): string {
  return `${JSON.stringify(site, null, 2)}\n`;
}

/** A text file at `path` on `branch` through the Contents API, or `null` when it does not exist. */
export async function readRepoText(
  opts: GitHubClientOptions & { repo: string; path: string; branch: string }
): Promise<string | null> {
  const path = opts.path.split('/').map(encodeURIComponent).join('/');
  const res = await github<{ content?: string; encoding?: string }>(
    opts,
    'GET',
    `${repoPath(opts.repo)}/contents/${path}?ref=${encodeURIComponent(opts.branch)}`,
    undefined,
    [404]
  );
  if (res.status === 404 || typeof res.data?.content !== 'string') return null;
  const bin = atob(res.data.content.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

interface PagesInfo {
  cname?: string | null;
  html_url?: string;
  https_enforced?: boolean;
  https_certificate?: { state?: string } | null;
}

/**
 * Sets (or with `null` clears) the Pages custom domain: `PUT /repos/{o}/{r}/pages {cname}`. Needs Pages: write.
 * ⚠️ 待真机核实: that a fine-grained token with Pages: Read and write may set `cname` (the docs list the
 * endpoint under that permission). Returns whether anything changed.
 */
export async function setPagesDomain(
  opts: GitHubClientOptions & { repo: string; domain: string | null }
): Promise<{ changed: boolean }> {
  const path = `${repoPath(opts.repo)}/pages`;
  const current = await github<PagesInfo>(opts, 'GET', path, undefined, [404]);
  const now = current.status === 404 ? null : (current.data.cname ?? null);
  if ((now ?? null) === (opts.domain ?? null)) return { changed: false };
  await github(opts, 'PUT', path, { cname: opts.domain });
  return { changed: true };
}

export type HttpsState = 'enforced' | 'pending' | 'failed';

/**
 * Turns on 「Enforce HTTPS」 once GitHub has issued the certificate for the custom domain (minutes to an hour
 * after DNS is right). Never throws: `pending` = try again later, `failed` = tell the user to tick it on GitHub.
 */
export async function enforceHttps(
  opts: GitHubClientOptions & { repo: string }
): Promise<{ state: HttpsState; detail?: string }> {
  const path = `${repoPath(opts.repo)}/pages`;
  try {
    const info = await github<PagesInfo>(opts, 'GET', path);
    if (info.data.https_enforced) return { state: 'enforced' };
    const cert = info.data.https_certificate?.state;
    if (cert !== 'approved' && cert !== 'issued') {
      return { state: 'pending', detail: cert ? `证书状态：${cert}` : '证书还没有签发' };
    }
    await github(opts, 'PUT', path, { https_enforced: true });
    return { state: 'enforced' };
  } catch (e) {
    return { state: 'failed', detail: (e as Error).message };
  }
}
