/**
 * 回填作品链接 (SPEC-r12 §1.1): a post link the user pasted back → the platform's id, in the same form the platform's
 * `publish` returns as `externalId` (so `fetchStats` and the server's stats job can use it as is). Pure, no request.
 *
 * Where the platform has no stable id in its links (公众号, DEV, Hashnode, Facebook's `pfbid…` links, Medium,
 * Substack…), the id is the normalized URL; where the id in the link is not the API's id (Threads / Instagram
 * shortcodes), it is `code:{shortcode}`. Stats readers resolve those when they can and skip them otherwise.
 *
 * Adapters expose the same rules as `Adapter.parsePostUrl` (`defineAdapter` adds it for every key below).
 */

export interface ParsedPostUrl {
  externalId: string;
  /** The link, normalized (scheme, host, no tracking parameters or fragment). */
  url: string;
}

type Rule = (u: URL, host: string) => ParsedPostUrl | null;

/** Longer pastes are not post links (and keep the rules' regexes cheap). */
export const POST_URL_MAX = 2048;

/** A pasted link as a URL: `https://` is assumed when the scheme is missing (`x.com/u/status/1`). */
function toUrl(raw: string): URL | null {
  let s = raw.trim();
  if (!s || s.length > POST_URL_MAX || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$|\?)/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u;
  } catch {
    return null;
  }
}

/** The host without `www.` / `m.` / `mobile.`. */
function bareHost(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
}

/** The path with `%3A` and friends decoded (LinkedIn URNs), `null` when it is not valid percent-encoding. */
function pathOf(u: URL): string | null {
  try {
    return decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
}

const TRACKING_PARAM =
  /^(utm_[a-z]+|spm|fbclid|gclid|igshid|igsh|share_id|si|ref|ref_src|source|s|t)$/i;

/** `https://host/path?query` without the fragment, tracking parameters or a trailing slash. */
export function normalizePostUrl(raw: string): string | null {
  const u = toUrl(raw);
  if (!u) return null;
  return plainUrl(u);
}

function plainUrl(u: URL, keep?: readonly string[]): string {
  const q = new URLSearchParams();
  u.searchParams.forEach((v, k) => {
    if (keep ? keep.includes(k) : !TRACKING_PARAM.test(k)) q.append(k, v);
  });
  const path = u.pathname.replace(/\/+$/, '');
  const query = q.toString();
  return `${u.protocol}//${u.host.toLowerCase()}${path}${query ? `?${query}` : ''}`;
}

const ok = (externalId: string, url: string): ParsedPostUrl => ({ externalId, url });
/** The id is the normalized link itself. */
const asUrl = (url: string): ParsedPostUrl => ({ externalId: url, url });

/** DEV paths that are not `/{user}/{slug}` articles. */
const DEV_RESERVED = new Set([
  't',
  'tags',
  'top',
  'latest',
  'search',
  'settings',
  'dashboard',
  'videos',
  'listings',
  'podcasts',
  'about',
  'enter',
  'new',
  'notifications',
  'readinglist',
  'api',
]);

/** Pinterest's own domains (plus `{cc}.pinterest.com`). */
const PINTEREST_HOSTS = new Set(
  [
    'com',
    'at',
    'ca',
    'ch',
    'cl',
    'co.kr',
    'co.uk',
    'com.au',
    'com.mx',
    'de',
    'dk',
    'es',
    'fr',
    'ie',
    'it',
    'jp',
    'nz',
    'ph',
    'pt',
    'ru',
    'se',
  ].map((tld) => `pinterest.${tld}`)
);

/** Rules per registry key. */
const RULES: Record<string, Rule> = {
  zhihu(u, host) {
    const p = u.pathname;
    let m: RegExpExecArray | null;
    if (host === 'zhuanlan.zhihu.com' && (m = /^\/p\/(\d+)\/?$/.exec(p)))
      return ok(m[1]!, `https://zhuanlan.zhihu.com/p/${m[1]}`);
    if (host !== 'zhihu.com') return null;
    if ((m = /^\/question\/(\d+)\/answer\/(\d+)\/?$/.exec(p)))
      return ok(`answer:${m[2]}`, `https://www.zhihu.com/question/${m[1]}/answer/${m[2]}`);
    if ((m = /^\/answer\/(\d+)\/?$/.exec(p)))
      return ok(`answer:${m[1]}`, `https://www.zhihu.com/answer/${m[1]}`);
    return null;
  },
  juejin(u, host) {
    const m = host === 'juejin.cn' ? /^\/post\/(\d+)\/?$/.exec(u.pathname) : null;
    return m ? ok(m[1]!, `https://juejin.cn/post/${m[1]}`) : null;
  },
  csdn(u, host) {
    let m: RegExpExecArray | null;
    if (
      host === 'blog.csdn.net' &&
      (m = /^\/([^/]+)\/article\/details\/(\d+)\/?$/.exec(u.pathname))
    )
      return ok(m[2]!, `https://blog.csdn.net/${m[1]}/article/details/${m[2]}`);
    // the old `{user}.blog.csdn.net/article/details/{id}` form
    if (host.endsWith('.blog.csdn.net') && (m = /^\/article\/details\/(\d+)\/?$/.exec(u.pathname)))
      return ok(m[1]!, `https://${host}/article/details/${m[1]}`);
    return null;
  },
  wechat(u, host) {
    if (host !== 'mp.weixin.qq.com') return null;
    const m = /^\/s\/([A-Za-z0-9_-]{6,})\/?$/.exec(u.pathname);
    if (m) return asUrl(`https://mp.weixin.qq.com/s/${m[1]}`);
    if (/^\/s\/?$/.test(u.pathname) && u.searchParams.get('__biz') && u.searchParams.get('mid'))
      return asUrl(plainUrl(u, ['__biz', 'mid', 'idx', 'sn']).replace(/^http:/, 'https:'));
    return null;
  },
  devto(u, host) {
    if (host !== 'dev.to') return null;
    const m = /^\/([^/]+)\/([^/]+)\/?$/.exec(u.pathname);
    if (!m || DEV_RESERVED.has(m[1]!.toLowerCase())) return null;
    return asUrl(`https://dev.to/${m[1]}/${m[2]}`);
  },
  hashnode(u) {
    // `{blog}.hashnode.dev/{slug}` or the blog's own domain: any article path
    if (!/^\/[^/]+/.test(u.pathname)) return null;
    return asUrl(plainUrl(u, []).replace(/^http:/, 'https:'));
  },
  // SPEC-r14 A1
  qiita(u, host) {
    // `qiita.com/{user}/items/{20 hex}`: the API's item id
    if (host !== 'qiita.com') return null;
    const m = /^\/([A-Za-z0-9_-]+)\/items\/([0-9a-f]{20})\/?$/.exec(u.pathname);
    return m ? ok(m[2]!, `https://qiita.com/${m[1]}/items/${m[2]}`) : null;
  },
  zenn(u, host) {
    // `zenn.dev/{user}/articles/{slug}`: the slug is the file name in the repository (`publish`'s id)
    if (host !== 'zenn.dev') return null;
    const m = /^\/([A-Za-z0-9_-]+)\/articles\/([0-9a-z_-]{12,50})\/?$/.exec(u.pathname);
    return m ? ok(m[2]!, `https://zenn.dev/${m[1]}/articles/${m[2]}`) : null;
  },
  telegraph(u, host) {
    // `telegra.ph/{path}`: `publish` returns the path percent-encoded (Telegraph keeps non-ASCII titles in it)
    if (host !== 'telegra.ph' && host !== 'graph.org') return null;
    const m = /^\/([^/]+)\/?$/.exec(u.pathname);
    if (!m || m[1] === 'api') return null;
    let path: string;
    try {
      path = encodeURIComponent(decodeURIComponent(m[1]!));
    } catch {
      return null;
    }
    return ok(path, `https://telegra.ph/${path}`);
  },
  hatena(u) {
    // はてなブログ: `{blog}/entry/…` on a hatenablog / hateblo / hatenadiary domain or the blog's own domain
    if (!/^\/entry\/./.test(u.pathname)) return null;
    return asUrl(plainUrl(u, []).replace(/^http:/, 'https:'));
  },
  mastodon(u) {
    const p = u.pathname;
    const m = /^\/@([^/]+)\/(\d+)\/?$/.exec(p) ?? /^\/users\/([^/]+)\/statuses\/(\d+)\/?$/.exec(p);
    if (!m) return null;
    const url = `https://${u.host.toLowerCase()}/@${m[1]}/${m[2]}`;
    // `/@user@remote/{id}`: a remote post seen from this instance — the id is this instance's, not the post's on
    // its author's instance (where `publish` would have put it): kept as the link
    return m[1]!.includes('@') ? asUrl(url) : ok(m[2]!, url);
  },
  bluesky(u, host) {
    // `publish` returns the record key (rkey); stats find the author from the link's handle / DID
    const m =
      host === 'bsky.app' ? /^\/profile\/([^/]+)\/post\/([a-z0-9]+)\/?$/i.exec(u.pathname) : null;
    return m ? ok(m[2]!, `https://bsky.app/profile/${m[1]}/post/${m[2]}`) : null;
  },
  reddit(u, host) {
    let m: RegExpExecArray | null;
    if (host === 'redd.it' && (m = /^\/([a-z0-9]+)\/?$/i.exec(u.pathname)))
      return ok(m[1]!.toLowerCase(), `https://www.reddit.com/comments/${m[1]!.toLowerCase()}/`);
    if (!/^((old|new|np)\.)?reddit\.com$/.test(host)) return null;
    if ((m = /^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(u.pathname))) {
      const id = m[2]!.toLowerCase();
      return ok(id, `https://www.reddit.com/r/${m[1]}/comments/${id}/`);
    }
    if ((m = /^\/comments\/([a-z0-9]+)(?:\/|$)/i.exec(u.pathname))) {
      const id = m[1]!.toLowerCase();
      return ok(id, `https://www.reddit.com/comments/${id}/`);
    }
    return null;
  },
  x(u, host) {
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    let m: RegExpExecArray | null;
    if ((m = /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)(?:\/|$)/.exec(u.pathname)))
      return ok(m[2]!, `https://x.com/${m[1]}/status/${m[2]}`);
    if ((m = /^\/i\/(?:web\/)?status\/(\d+)(?:\/|$)/.exec(u.pathname)))
      return ok(m[1]!, `https://x.com/i/status/${m[1]}`);
    return null;
  },
  threads(u, host) {
    if (host !== 'threads.net' && host !== 'threads.com') return null;
    // the link carries the shortcode, not the media id `publish` returns: `code:` until an API lookup resolves it
    const m = /^\/@([^/]+)\/post\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    return m ? ok(`code:${m[2]}`, `https://www.${host}/@${m[1]}/post/${m[2]}`) : null;
  },
  linkedin(u, host) {
    if (host !== 'linkedin.com') return null;
    const p = pathOf(u);
    if (!p) return null;
    let m: RegExpExecArray | null;
    if ((m = /^\/feed\/update\/(urn:li:(?:share|ugcPost|activity):\d+)\/?$/.exec(p)))
      return ok(m[1]!, `https://www.linkedin.com/feed/update/${m[1]}`);
    // `/posts/{slug}-activity-{id}-{code}`: matched from the end (a lazy scan over the slug is quadratic)
    if (
      /^\/posts\/[^/]+\/?$/.test(p) &&
      (m = /-(share|ugcPost|activity)-(\d+)(?:-[^/-]*)?\/?$/.exec(p))
    ) {
      const urn = `urn:li:${m[1]}:${m[2]}`;
      return ok(urn, `https://www.linkedin.com/feed/update/${urn}`);
    }
    return null;
  },
  facebook(u, host) {
    if (host !== 'facebook.com' && host !== 'web.facebook.com') return null;
    const p = u.pathname;
    // `publish` returns the Graph id `{page-id}_{post-id}`: given when both ids in the link are numeric
    if (/^\/(permalink|story)\.php$/.test(p)) {
      const story = u.searchParams.get('story_fbid');
      const page = u.searchParams.get('id');
      if (!story || !page) return null;
      const url = plainUrl(u, ['story_fbid', 'id']).replace(/^http:/, 'https:');
      return /^\d+$/.test(story) && /^\d+$/.test(page) ? ok(`${page}_${story}`, url) : asUrl(url);
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/([^/]+)\/posts\/([^/]+)\/?$/.exec(p))) {
      const url = `https://www.facebook.com/${m[1]}/posts/${m[2]}`;
      return /^\d+$/.test(m[1]!) && /^\d+$/.test(m[2]!) ? ok(`${m[1]}_${m[2]}`, url) : asUrl(url);
    }
    if ((m = /^\/share\/p\/([A-Za-z0-9]+)\/?$/.exec(p)))
      return asUrl(`https://www.facebook.com/share/p/${m[1]}`);
    return null;
  },
  instagram(u, host) {
    if (host !== 'instagram.com') return null;
    const m = /^\/(?:[^/]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    if (!m) return null;
    const kind = m[1] === 'reels' ? 'reel' : m[1]!;
    return ok(`code:${m[2]}`, `https://www.instagram.com/${kind}/${m[2]}/`);
  },
  pinterest(u, host) {
    if (!PINTEREST_HOSTS.has(host) && !/^[a-z]{2}\.pinterest\.com$/.test(host)) return null;
    const m = /^\/pin\/(\d+)\/?$/.exec(u.pathname);
    return m ? ok(m[1]!, `https://www.pinterest.com/pin/${m[1]}/`) : null;
  },
  telegram(u, host) {
    if (host !== 't.me' && host !== 'telegram.me') return null;
    // `publish` returns `chat_id:message_id`; a private channel's link has the id without its `-100` prefix
    let m: RegExpExecArray | null;
    if ((m = /^\/c\/(\d+)\/(\d+)\/?$/.exec(u.pathname)))
      return ok(`-100${m[1]}:${m[2]}`, `https://t.me/c/${m[1]}/${m[2]}`);
    if ((m = /^\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})\/(\d+)\/?$/.exec(u.pathname)))
      return ok(`@${m[1]}:${m[2]}`, `https://t.me/${m[1]}/${m[2]}`);
    return null;
  },
  tumblr(u, host) {
    let m: RegExpExecArray | null;
    if (
      host === 'tumblr.com' &&
      (m = /^\/(?:blog\/view\/)?([a-z0-9-]+)\/(\d+)(?:\/|$)/i.exec(u.pathname))
    )
      return ok(m[2]!, `https://www.tumblr.com/${m[1]}/${m[2]}`);
    if (host.endsWith('.tumblr.com') && (m = /^\/post\/(\d+)(?:\/|$)/.exec(u.pathname)))
      return ok(m[1]!, `https://${host}/post/${m[1]}`);
    return null;
  },
  xiaohongshu(u, host) {
    if (host === 'xhslink.com') {
      // a share short link: kept as is (resolving it needs a request)
      return /^\/[^/]+/.test(u.pathname)
        ? asUrl(plainUrl(u, []).replace(/^http:/, 'https:'))
        : null;
    }
    if (host !== 'xiaohongshu.com') return null;
    const m =
      /^\/explore\/([0-9a-f]{24})\/?$/i.exec(u.pathname) ??
      /^\/discovery\/item\/([0-9a-f]{24})\/?$/i.exec(u.pathname);
    return m ? ok(m[1]!, `https://www.xiaohongshu.com/explore/${m[1]}`) : null;
  },
};

/** Platforms with their own link rules (`parsePostUrl` returns `null` for links that are not their posts). */
export const POST_URL_PLATFORMS: readonly string[] = Object.keys(RULES);

/**
 * SPEC-r12 §1.1: a pasted post link → `{ externalId, url }` for `platform` (registry key). `null` when the text is
 * not an http(s) link, or not a post link of a platform that has rules (`POST_URL_PLATFORMS`). Platforms without
 * rules (Medium, Substack, Ghost, WordPress…) take any http(s) link, with the normalized link as the id.
 */
export function parsePostUrl(platform: string, url: string): ParsedPostUrl | null {
  const u = toUrl(url);
  if (!u) return null;
  const rule = RULES[platform];
  if (!rule) return asUrl(plainUrl(u));
  return rule(u, bareHost(u));
}

/** True when an external id is a link (a pasted post the stats reader could not turn into an id). */
export function isUrlExternalId(externalId: string): boolean {
  return /^https?:\/\//i.test(externalId);
}

/** The shortcode of a `code:{shortcode}` external id (Threads, Instagram), else `undefined`. */
export function shortcodeOf(externalId: string): string | undefined {
  const m = /^code:([A-Za-z0-9_-]+)$/.exec(externalId);
  return m ? m[1] : undefined;
}
