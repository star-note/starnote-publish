import type { SessionFetch, SessionFetchInit, SessionPage, SessionResponse } from '../src/index';

export interface SessionCall {
  partition: string;
  method: string;
  url: string;
  init: SessionFetchInit;
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (call: SessionCall, n: number) => Reply | Promise<Reply>;

/**
 * A `sessionFetch` mock routed by `"METHOD https://host/path"` (prefix match on the URL, longest wins);
 * records every call. Unrouted calls answer 599 so a test notices them.
 */
export function mockSession(routes: Record<string, Handler>) {
  const calls: SessionCall[] = [];
  const counts = new Map<string, number>();
  const sessionFetch: SessionFetch = async (partition, url, init = {}) => {
    const method = init.method ?? 'GET';
    const call = { partition, method, url, init };
    calls.push(call);
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, prefix] = k.split(' ');
        return m === method && url.startsWith(prefix!);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!key)
      return { ok: false, status: 599, url, headers: {}, text: `no route ${method} ${url}` };
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const r = await routes[key]!(call, n);
    const status = r.status ?? 200;
    const res: SessionResponse = {
      ok: status >= 200 && status < 300,
      status,
      url,
      headers: r.headers ?? {},
      text:
        r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
    };
    return res;
  };
  return { sessionFetch, calls };
}

/** A fake desktop page that records what the adapter did to it (account pages have no evaluate / click). */
export function mockPage(opts: { failPaste?: boolean; failTitle?: boolean } = {}) {
  const log: Array<[string, ...unknown[]]> = [];
  const page: SessionPage & { log: typeof log } = {
    log,
    async goto(url) {
      log.push(['goto', url]);
    },
    async url() {
      return '';
    },
    async waitForSelector(sel) {
      log.push(['waitForSelector', sel]);
      return true;
    },
    async show() {
      log.push(['show']);
    },
    async close() {
      log.push(['close']);
    },
    async read(spec) {
      log.push(['read', spec]);
      return null;
    },
    async insertText(selector, text) {
      log.push(['insertText', selector, text]);
      if (opts.failTitle) throw new Error('页面上找不到要填写的位置');
    },
    async pasteHtml(selector, content) {
      log.push(['pasteHtml', selector, content]);
      if (opts.failPaste) throw new Error('页面上找不到要填写的位置');
    },
  };
  return page;
}
