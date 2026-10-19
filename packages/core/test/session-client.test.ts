import { describe, expect, it, vi } from 'vitest';

import {
  buildSessionRequest,
  classifyResponse,
  convert,
  createPublisher,
  createSessionClient,
  defineAdapter,
  interpretSessionCheck,
  PlatformSessionError,
  sessionPartition,
} from '../src/index';
import { z } from 'zod';

import type { SessionFetch, SiteScript } from '../src/index';

const script: SiteScript = {
  platform: 'demo',
  version: '1.0.0',
  minCore: '0.1.0',
  issuedAt: '2026-10-19T00:00:00.000Z',
  urls: { help: 'https://demo.example/help' },
  selectors: {},
  endpoints: {
    create: {
      method: 'POST',
      url: 'https://api.demo.example/a/{id}?x={+raw}',
      headers: { 'x-token': '{csrf}' },
      csrf: { cookie: '_xsrf', header: 'x-xsrftoken' },
      fields: { title: 'title', draftId: 'data.draft.id' },
      static: { action: 'article', data: { draft: { disabled: 1 } } },
      ok: { path: 'err_no', equals: 0 },
      result: { id: 'data.id' },
    },
    upload: {
      method: 'POST',
      url: 'https://up.example/',
      bodyType: 'multipart',
      result: { url: 'url' },
    },
    signed: { method: 'POST', url: 'https://api.demo.example/s', signed: true },
  },
  errors: {
    relogin: { status: [401], codePath: 'err_no', codes: [403] },
    rateLimit: { status: [429], codePath: 'err_no', codes: [1006] },
  },
};

const res = (status: number, body: unknown) => ({
  ok: status < 300,
  status,
  url: '',
  headers: {},
  text: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('buildSessionRequest', () => {
  it('fills the URL and headers, renames fields into nested paths over a copy of `static`', () => {
    const { url, init } = buildSessionRequest(script.endpoints!.create!, {
      vars: { id: 'a b', raw: 'https://x/y', csrf: 'tok' },
      data: { title: 'T', draftId: '42', ignored: 1 },
    });
    expect(url).toBe('https://api.demo.example/a/a%20b?x=https://x/y');
    expect(init).toEqual({
      method: 'POST',
      headers: { 'x-token': 'tok' },
      csrf: { cookie: '_xsrf', header: 'x-xsrftoken' },
      json: { action: 'article', title: 'T', data: { draft: { disabled: 1, id: '42' } } },
    });
    expect(script.endpoints!.create!.static).toEqual({
      action: 'article',
      data: { draft: { disabled: 1 } },
    });
  });

  it('builds multipart bodies with file parts', () => {
    const { init } = buildSessionRequest(script.endpoints!.upload!, {
      data: { key: 'k', n: 3 },
      files: { file: { kind: 'url', url: 'https://cdn/a.png' } },
    });
    expect(init.form).toEqual({
      key: 'k',
      n: '3',
      file: { kind: 'url', url: 'https://cdn/a.png' },
    });
  });
});

describe('error mapping', () => {
  const e = script.endpoints!.create!;
  it('classifies relogin / retry / help', () => {
    expect(classifyResponse(script, e, res(401, {}))?.kind).toBe('relogin');
    expect(classifyResponse(script, e, res(200, { err_no: 403 }))?.kind).toBe('relogin');
    expect(classifyResponse(script, e, res(429, ''))?.kind).toBe('retry');
    expect(classifyResponse(script, e, res(200, { err_no: 1006 }))?.kind).toBe('retry');
    expect(classifyResponse(script, e, res(500, 'boom'))?.kind).toBe('help');
    expect(classifyResponse(script, e, res(200, { err_no: 7, err_msg: '标题太短' }))).toMatchObject(
      {
        kind: 'help',
        detail: '标题太短',
      }
    );
    expect(classifyResponse(script, e, res(200, { err_no: 0 }))).toBeNull();
  });

  it('client throws PlatformSessionError with the matching actions and never calls signed endpoints', async () => {
    const calls: string[] = [];
    const sessionFetch: SessionFetch = vi.fn(async (_p, url) => {
      calls.push(url);
      return res(401, {});
    });
    const client = createSessionClient({
      script,
      partition: 'persist:pub-demo-a1',
      sessionFetch,
      label: '演示',
    });
    expect(client.has('signed')).toBe(false);
    await expect(client.call('signed')).rejects.toMatchObject({ kind: 'help' });
    const err = await client.call('create', { vars: { id: '1' } }).catch((x) => x);
    expect(err).toBeInstanceOf(PlatformSessionError);
    expect(err).toMatchObject({ kind: 'relogin', code: 'relogin', actions: [{ kind: 'relogin' }] });
    expect(calls).toHaveLength(1);
  });

  it('the publisher forwards code and actions of a PlatformSessionError', async () => {
    const events: any[] = [];
    const adapter = defineAdapter({
      key: 'demo',
      label: '演示',
      runtimes: [{ runtime: 'electron', mode: 'automation' }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      async publish() {
        throw new PlatformSessionError('retry', '太频繁');
      },
    });
    const publisher = createPublisher({
      adapters: [adapter],
      runtime: 'electron',
      onEvent: (_p, e) => events.push(e),
    });
    await publisher.publish({
      noteId: 'n',
      doc: convert({ type: 'doc' }),
      platforms: ['demo'],
      common: {},
      perPlatform: {},
    });
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'rate_limited',
      actions: [{ kind: 'retry' }],
    });
  });

  it('passes sessionFetch through to ctx', async () => {
    const sessionFetch: SessionFetch = async () => res(200, {});
    let seen: unknown;
    const adapter = defineAdapter({
      key: 'demo',
      label: '演示',
      runtimes: [{ runtime: 'electron', mode: 'automation' }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      async publish({ ctx }) {
        seen = ctx.sessionFetch;
        return { url: 'https://demo.example/p/1' };
      },
    });
    await createPublisher({ adapters: [adapter], runtime: 'electron', sessionFetch }).publish({
      noteId: 'n',
      doc: convert({ type: 'doc' }),
      platforms: ['demo'],
      common: {},
      perPlatform: {},
    });
    expect(seen).toBe(sessionFetch);
  });
});

describe('desktop session helpers', () => {
  it('names partitions persist:pub-<platform>-<accountId> and rejects bad ids', () => {
    expect(sessionPartition('zhihu', 'a1b2c3d4')).toBe('persist:pub-zhihu-a1b2c3d4');
    expect(() => sessionPartition('zhihu', '../x')).toThrow();
    expect(() => sessionPartition('Zhihu', 'a1')).toThrow();
  });

  it('interprets the check endpoint', () => {
    const spec = {
      url: 'https://x/me',
      ok: { path: 'err_no', equals: 0 },
      uid: 'data.id',
      nickname: 'data.name',
      avatar: 'data.avatar',
    };
    expect(
      interpretSessionCheck(spec, {
        status: 200,
        text: JSON.stringify({
          err_no: 0,
          data: { id: 7, name: '小明', avatar: 'https://a/b.png' },
        }),
      })
    ).toEqual({
      state: 'ok',
      uid: '7',
      nickname: '小明',
      avatar: 'https://a/b.png',
    });
    expect(interpretSessionCheck(spec, { status: 401, text: '' }).state).toBe('needs-relogin');
    expect(
      interpretSessionCheck(spec, { status: 200, text: JSON.stringify({ err_no: 403 }) }).state
    ).toBe('needs-relogin');
    expect(interpretSessionCheck(spec, { status: 502, text: '<html>' }).state).toBe('error');
  });
});
