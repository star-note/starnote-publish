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

/* ---- shared fixtures for the adapter tests ---- */

import { convert, createPublisher } from '@starnote/publish-core';

import type { Adapter, PublishEvent, PublishJob, TiptapJSON } from '@starnote/publish-core';

const t = (text: string, marks?: TiptapJSON['marks']): TiptapJSON =>
  marks ? { type: 'text', text, marks } : { type: 'text', text };
const p = (...content: TiptapJSON[]): TiptapJSON => ({ type: 'paragraph', content });

/** A note using every custom block the adapters degrade. */
export const FIXTURE: TiptapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Hello Title')] },
    { type: 'heading', attrs: { level: 2, variant: 'pill' }, content: [t('Pill heading')] },
    p(
      t('See '),
      t('the docs', [{ type: 'link', attrs: { href: 'https://example.com/docs' } }]),
      t(' and '),
      t('this', [{ type: 'highlight' }])
    ),
    { type: 'card', attrs: { variant: 'tip' }, content: [p(t('Card body'))] },
    { type: 'callout', attrs: { title: 'Heads up', body: '<b>Careful</b> now' } },
    { type: 'divider', attrs: { variant: 'wave' } },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;')] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [p(t('A'))] },
            { type: 'tableHeader', content: [p(t('B'))] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [p(t('1'))] },
            { type: 'tableCell', content: [p(t('2'))] },
          ],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p(t('merged'))] }],
        },
      ],
    },
    { type: 'imageBlock', attrs: { src: '/assets/a.png', caption: 'A picture' } },
    p(t('Euler: '), { type: 'katex', attrs: { text: 'e^{i\\pi}+1=0' } }),
    { type: 'iframe', attrs: { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } },
    { type: 'iframe', attrs: { src: 'https://player.bilibili.com/player.html?bvid=BV1' } },
    { type: 'heading', attrs: { level: 4 }, content: [t('Deep heading')] },
  ],
};

export const fixtureDoc = () => convert(FIXTURE);

export const ASSET_BASE = 'https://starnote.app/';
export const CANONICAL = 'https://starnote.app/@me/abc123';

/** Runs one platform through a real publisher and collects its events. */
export async function runPublish(
  adapter: Adapter<any>,
  job: Partial<PublishJob> & { form?: unknown },
  opts: { runtime?: 'web' | 'electron' | 'node'; fetch?: typeof fetch } = {}
) {
  const events: PublishEvent[] = [];
  const doc = job.doc ?? fixtureDoc();
  const publisher = createPublisher({
    adapters: [adapter],
    runtime: opts.runtime ?? 'node',
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    onEvent: (_platform, e) => events.push(e),
  });
  const { results } = await publisher.publish({
    noteId: 'note-1',
    doc,
    platforms: [adapter.key],
    common: job.common ?? { title: 'Hello Title', tags: ['TypeScript', 'web dev'] },
    perPlatform: { [adapter.key]: job.form ?? {} },
    content: job.content ?? { kind: 'article', doc, canonicalUrl: CANONICAL },
    ...(job.accounts ? { accounts: job.accounts } : {}),
    ...(job.previous ? { previous: job.previous } : {}),
  });
  const result = results[adapter.key]!;
  const terminal = events.filter((e) => e.type === 'done' || e.type === 'failed');
  return { result, events, terminal };
}
