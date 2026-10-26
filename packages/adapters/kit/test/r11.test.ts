import { CANONICAL_PLACEHOLDER } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  containerIdOf,
  errorFromStatus,
  fitPost,
  hashtagWord,
  linkCost,
  networkError,
  rateLimitError,
  readJson,
  relayCheck,
  relayFinalize,
  relayPublish,
  reloginError,
  threadsLength,
} from '../src/index';
import { json, mockFetch } from './helpers';

import type { RelayContext } from '../src/index';

const P = { key: 'threads', label: 'Threads' };
const PATH = '/api/v1/notes/note-1/publish/threads';

function ctx(fetch: typeof globalThis.fetch, extra: Partial<RelayContext> = {}): RelayContext {
  return {
    fetch,
    signal: new AbortController().signal,
    noteId: 'note-1',
    apiBase: '/api/v1',
    ...extra,
  };
}

describe('relay (SPEC-r11 §1–§5)', () => {
  it('sends Idempotency-Key and account_id; a stored key wins', async () => {
    const { fetch, calls } = mockFetch({
      [`POST ${PATH}`]: () =>
        json({ code: 0, data: { url: 'u', external_id: 'e', state: 'published' } }),
    });
    await relayPublish(ctx(fetch, { jobId: 'j1', attempt: 3, accountId: '42' }), P, { a: 1 });
    expect(calls[0]!.headers.get('Idempotency-Key')).toBe('j1:threads:42:3');
    expect(calls[0]!.body).toEqual({ body: { a: 1 }, account_id: '42' });
    await relayPublish(ctx(fetch, { jobId: 'j1', idempotencyKey: 'task-7' }), P, {});
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe('task-7');
    await relayPublish(ctx(fetch), P, {});
    expect(calls[2]!.headers.get('Idempotency-Key')).toBeNull();
  });

  it('returns processing with pending', async () => {
    const { fetch } = mockFetch({
      [`POST ${PATH}`]: () =>
        json({
          code: 0,
          data: { url: '', external_id: '', state: 'processing', pending: { container_id: 'c1' } },
        }),
    });
    expect(await relayPublish(ctx(fetch), P, {})).toMatchObject({
      state: 'processing',
      pending: { container_id: 'c1' },
    });
  });

  it("prefers the envelope's error_kind and maps actions by kind", async () => {
    const reply = (status: number, data: Record<string, unknown>) =>
      mockFetch({ [`POST ${PATH}`]: () => json({ code: 50201, message: 'nope', data }, status) })
        .fetch;
    const disc = await relayPublish(
      ctx(reply(400, { error_code: 'invalid', error_kind: 'disconnect' })),
      P,
      {}
    ).catch((e) => e);
    expect(disc).toMatchObject({ errorKind: 'disconnect' });
    expect(disc.actions.map((a: any) => a.kind)).toEqual(['relogin', 'help']);

    const bad = await relayPublish(ctx(reply(400, { error_code: 'too_large' })), P, {}).catch(
      (e) => e
    );
    expect(bad).toMatchObject({ errorKind: 'bad_body', code: 'too_large' });

    const limited = await relayPublish(
      ctx(reply(429, { error_code: 'rate_limited', error_kind: 'retry', retry_after: 30 })),
      P,
      {}
    ).catch((e) => e);
    expect(limited).toMatchObject({ errorKind: 'retry', retryAfterSec: 30 });

    const busy = await relayPublish(ctx(reply(409, { error_code: 'in_progress' })), P, {}).catch(
      (e) => e
    );
    expect(busy).toMatchObject({ errorKind: 'unknown' });
    expect(busy.actions.map((a: any) => a.label)).toEqual(['去平台确认', '仍要重发']);
  });

  it('a write that lost its connection is unknown, a read retries', async () => {
    const broken = (async () => {
      throw new TypeError('socket hang up');
    }) as unknown as typeof globalThis.fetch;
    const e = await relayPublish(ctx(broken), P, {}).catch((x) => x);
    expect(e).toMatchObject({ errorKind: 'unknown', code: 'network' });
    expect(networkError(P, new Error('x')).errorKind).toBe('retry');
  });

  it('check retries 5xx; finalize is keyed by the container and never retried', async () => {
    let n = 0;
    const { fetch, calls } = mockFetch({
      [`POST ${PATH}/check`]: () =>
        ++n === 1
          ? json({ code: 50301, message: 'busy', data: {} }, 503)
          : json({ code: 0, data: { status: 'ready', pending: { container_id: 'c1' } } }),
      [`POST ${PATH}/finalize`]: () =>
        json({ code: 0, data: { status: 'completed', url: 'https://t/p', external_id: 'p1' } }),
    });
    const c = ctx(fetch, { accountId: '7' });
    expect(await relayCheck(c, P, { container_id: 'c1' }, { backoffMs: 0 })).toEqual({
      status: 'ready',
      pending: { container_id: 'c1' },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual({ pending: { container_id: 'c1' }, account_id: '7' });
    expect(await relayFinalize(c, P, { container_id: 'c1' })).toEqual({
      status: 'completed',
      url: 'https://t/p',
      externalId: 'p1',
    });
    expect(calls[2]!.headers.get('Idempotency-Key')).toBe('finalize:threads:c1');
    expect(containerIdOf({ creation_id: 9 })).toBe('9');
  });
});

describe('error kinds', () => {
  it('constructors carry their kind', () => {
    expect(reloginError(P).errorKind).toBe('disconnect');
    expect(rateLimitError(P, 5).errorKind).toBe('retry');
    expect(errorFromStatus(P, 502, new Headers()).errorKind).toBe('retry');
    expect(errorFromStatus(P, 404, new Headers()).errorKind).toBe('bad_body');
  });
});

describe('readJson', () => {
  it('retries a 503, returns null on 404', async () => {
    let n = 0;
    const { fetch } = mockFetch({
      'GET /a': () => (++n === 1 ? json({}, 503) : json({ ok: 1 })),
      'GET /gone': () => json({}, 404),
    });
    const c = { fetch, signal: new AbortController().signal };
    expect(await readJson(c, P, 'https://x.test/a', { backoffMs: 0 })).toEqual({ ok: 1 });
    expect(await readJson(c, P, 'https://x.test/gone')).toBeNull();
  });
});

describe('fitPost', () => {
  it('shortens the summary, then drops topics, then the head; never the link', () => {
    const link = 'https://starnote.app/@me/abc';
    const r = fitPost({
      head: 'Title',
      summary: 'x'.repeat(100),
      tags: ['a', 'b'],
      link,
      limit: 80,
    });
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith(link)).toBe(true);
    expect([...r.text].length).toBeLessThanOrEqual(80);
    const tight = fitPost({ head: 'Title '.repeat(20), tags: ['a'], link, limit: 50 });
    expect(tight.droppedTags).toEqual(['a']);
    expect([...tight.text].length).toBeLessThanOrEqual(50);
    expect(fitPost({ head: 'hi', limit: 10 })).toMatchObject({ text: 'hi', truncated: false });
  });

  it('reserves room for the canonical placeholder; counts with the given measure', () => {
    expect(linkCost(CANONICAL_PLACEHOLDER)).toBe(64);
    const r = fitPost({ head: 'x'.repeat(100), link: CANONICAL_PLACEHOLDER, limit: 100 });
    expect([...r.head].length).toBeLessThanOrEqual(100 - 64 - 2);
    const emoji = fitPost({ head: '👍'.repeat(10), limit: 20, count: threadsLength });
    expect(threadsLength(emoji.text)).toBeLessThanOrEqual(20);
    expect(hashtagWord('Type Script!')).toBe('TypeScript');
    expect(hashtagWord('2026')).toBeNull();
  });
});

describe('review fixes: writes never look retryable when the result is unknown', () => {
  const html = (status: number) =>
    new Response('<html>Bad Gateway</html>', { status, headers: { 'Content-Type': 'text/html' } });

  it('a 5xx without error_kind on a write is unknown; on a read it is retry', async () => {
    const { fetch } = mockFetch({
      [`POST ${PATH}/check`]: () => html(504),
      [`POST ${PATH}/finalize`]: () => json({ code: 50000, message: 'oops', data: {} }, 500),
      [`POST ${PATH}`]: () => html(502),
    });
    const pub = await relayPublish(ctx(fetch), P, {}).catch((e) => e);
    expect(pub).toMatchObject({ errorKind: 'unknown', code: 'http_502' });
    expect(pub.actions.map((a: any) => a.label)).toEqual(['去平台确认', '仍要重发']);
    const fin = await relayFinalize(ctx(fetch), P, { container_id: 'c' }).catch((e) => e);
    expect(fin).toMatchObject({ errorKind: 'unknown' });
    const chk = await relayCheck(ctx(fetch), P, {}, { retries: 0 }).catch((e) => e);
    expect(chk).toMatchObject({ errorKind: 'retry' });
  });

  it('a 2xx write with an unreadable body is unknown', async () => {
    for (const reply of [
      () => new Response('{"code":0,"data":{"url":"htt', { status: 200 }),
      () => json({ code: 0, message: 'ok' }),
      () => new Response('', { status: 201 }),
    ]) {
      const { fetch } = mockFetch({ [`POST ${PATH}`]: reply, [`POST ${PATH}/finalize`]: reply });
      expect(await relayPublish(ctx(fetch), P, {}).catch((e) => e)).toMatchObject({
        errorKind: 'unknown',
        code: 'bad_response',
      });
      expect(
        await relayFinalize(ctx(fetch), P, { container_id: 'c' }).catch((e) => e)
      ).toMatchObject({ errorKind: 'unknown' });
    }
  });

  it('passes retry_after through whatever the code', async () => {
    const { fetch } = mockFetch({
      [`POST ${PATH}`]: () =>
        json(
          {
            code: 50301,
            message: 'busy',
            data: { error_code: 'upstream', error_kind: 'retry', retry_after: 90 },
          },
          503
        ),
    });
    const e = await relayPublish(ctx(fetch), P, {}).catch((x) => x);
    expect(e).toMatchObject({ errorKind: 'retry', retryAfterSec: 90, code: 'upstream' });
    expect(e.actions.at(-1).label).toBe('2 分钟后重试');
    const limited = mockFetch({
      [`POST ${PATH}`]: () =>
        json({ code: 42901, message: 'slow', data: { retry_after: 12 } }, 429),
    });
    expect(await relayPublish(ctx(limited.fetch), P, {}).catch((x) => x)).toMatchObject({
      errorKind: 'retry',
      retryAfterSec: 12,
    });
  });

  it('appendLink keeps the link (and the placeholder budget) whole', async () => {
    const { appendLink } = await import('../src/index');
    const out = appendLink('x'.repeat(200), CANONICAL_PLACEHOLDER, 100);
    expect(out.endsWith(`\n\n${CANONICAL_PLACEHOLDER}`)).toBe(true);
    expect([...out].length - CANONICAL_PLACEHOLDER.length + 64).toBeLessThanOrEqual(100);
    expect(appendLink('short', 'https://a.b/c', 100)).toBe('short\n\nhttps://a.b/c');
  });
});
