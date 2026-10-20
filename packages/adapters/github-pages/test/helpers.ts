import { vi } from 'vitest';

export interface Call {
  method: string;
  url: string;
  body: any;
  headers: Headers;
  credentials?: RequestCredentials;
}

type Handler = (call: Call) => Response | Promise<Response>;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch mock routed by `"METHOD path-prefix"`; records every call. Longest matching route wins. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const call: Call = {
      method,
      url,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      headers: new Headers(init.headers),
      credentials: init.credentials,
    };
    calls.push(call);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const match = Object.keys(routes)
      .filter((k) => {
        const [m, p] = k.split(' ');
        return m === method && (path === p || path.startsWith(p!));
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!match) return json({ message: `no route for ${method} ${path}` }, 599);
    return routes[match]!(call);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
