import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { convert } from '../src/convert';
import { createPublisher, UNKNOWN_PLATFORM } from '../src/publisher';

import type { Adapter, PublishEvent, PublishJob } from '../src/types';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
});

const okAdapter: Adapter<z.ZodObject<{ name: z.ZodString }>> = {
  key: 'ok',
  label: 'OK',
  runtime: ['web', 'node'],
  capabilities: { supportsUpdate: true, titleMax: 50 },
  schema: z.object({ name: z.string().min(1, '请填名字') }),
  async publish({ ctx, form }) {
    ctx.emit({ type: 'progress', percent: 10, text: 'start' });
    ctx.emit({ type: 'log', level: 'info', text: `name=${form.name}` });
    ctx.emit({ type: 'progress', percent: 100 });
    return { url: 'https://ok.example/1', externalId: 'e1' };
  },
};

const selfDoneAdapter: Adapter = {
  key: 'selfdone',
  label: 'Self',
  runtime: ['web'],
  capabilities: { supportsUpdate: false },
  schema: z.object({}),
  async publish({ ctx }) {
    ctx.emit({ type: 'done', url: 'https://self.example/1' });
    return { url: 'https://self.example/1' };
  },
};

const boomAdapter: Adapter = {
  key: 'boom',
  label: 'Boom',
  runtime: ['web'],
  capabilities: { supportsUpdate: false },
  schema: z.object({}),
  async publish({ ctx }) {
    ctx.emit({ type: 'progress', percent: 5 });
    throw new Error('网络错误');
  },
};

const askAdapter: Adapter = {
  key: 'ask',
  label: 'Ask',
  runtime: ['web'],
  capabilities: { supportsUpdate: false, needsLogin: true },
  schema: z.object({}),
  async publish({ ctx }) {
    const code = await ctx.needInput({ id: 'sms', kind: 'text', title: '验证码' });
    ctx.emit({ type: 'log', level: 'info', text: `code=${code}` });
    return { url: `https://ask.example/${code}` };
  },
};

function job(platforms: string[], perPlatform: Record<string, unknown> = {}): PublishJob {
  return { noteId: 'n1', doc, platforms, common: { title: 'T' }, perPlatform };
}

function recorder() {
  const events: { platform: string; event: PublishEvent }[] = [];
  return {
    events,
    onEvent: (platform: string, event: PublishEvent) => events.push({ platform, event }),
  };
}

describe('createPublisher', () => {
  it('emits progress… then a single done, and returns the url', async () => {
    const { events, onEvent } = recorder();
    const publisher = createPublisher({ adapters: [okAdapter], runtime: 'web', onEvent });
    const result = await publisher.publish(job(['ok'], { ok: { name: 'A' } }));
    expect(events.map((e) => e.event.type)).toEqual(['progress', 'log', 'progress', 'done']);
    expect(events.every((e) => e.platform === 'ok' && typeof e.event.at === 'string')).toBe(true);
    expect(events.at(-1)?.event).toMatchObject({
      type: 'done',
      url: 'https://ok.example/1',
      externalId: 'e1',
    });
    expect(result).toEqual({
      results: { ok: { ok: true, url: 'https://ok.example/1', externalId: 'e1' } },
    });
  });

  it('does not duplicate done when the adapter emitted it', async () => {
    const { events, onEvent } = recorder();
    const publisher = createPublisher({ adapters: [selfDoneAdapter], runtime: 'web', onEvent });
    await publisher.publish(job(['selfdone']));
    expect(events.map((e) => e.event.type)).toEqual(['done']);
  });

  it('wraps adapter errors into failed with a retry action', async () => {
    const { events, onEvent } = recorder();
    const publisher = createPublisher({ adapters: [boomAdapter], runtime: 'web', onEvent });
    const result = await publisher.publish(job(['boom']));
    expect(events.map((e) => e.event.type)).toEqual(['progress', 'failed']);
    expect(events[1]?.event).toMatchObject({
      type: 'failed',
      reason: '网络错误',
      actions: [{ id: 'retry', label: '重试', kind: 'retry' }],
    });
    expect(result.results.boom).toEqual({ ok: false, error: '网络错误' });
  });

  it('fails an unknown platform with the standard reason', async () => {
    const { events, onEvent } = recorder();
    const publisher = createPublisher({ adapters: [okAdapter], runtime: 'web', onEvent });
    const result = await publisher.publish(job(['zhihu', 'ok'], { ok: { name: 'A' } }));
    expect(events[0]).toMatchObject({
      platform: 'zhihu',
      event: { type: 'failed', reason: UNKNOWN_PLATFORM },
    });
    expect(result.results.zhihu).toEqual({ ok: false, error: UNKNOWN_PLATFORM });
    expect(result.results.ok?.ok).toBe(true);
    expect(Object.keys(result.results)).toEqual(['zhihu', 'ok']);
  });

  it('fails when the platform form is invalid', async () => {
    const { events, onEvent } = recorder();
    const publisher = createPublisher({ adapters: [okAdapter], runtime: 'web', onEvent });
    const result = await publisher.publish(job(['ok'], { ok: { name: '' } }));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toMatchObject({ type: 'failed', code: 'invalid_form' });
    expect(result.results.ok?.error).toContain('请填名字');
  });

  it('fails when the adapter does not support the runtime', async () => {
    const publisher = createPublisher({ adapters: [okAdapter, boomAdapter], runtime: 'node' });
    const result = await publisher.publish(job(['boom']));
    expect(result.results.boom?.ok).toBe(false);
    expect(result.results.boom?.error).toBe('Boom 不能在服务器发布'); // 'node' is read as 'server'
  });

  it('needInput round-trips through answer()', async () => {
    const { events, onEvent } = recorder();
    const publisher = createPublisher({ adapters: [askAdapter], runtime: 'web', onEvent });
    const pending = publisher.publish(job(['ask']));
    await vi.waitFor(() => expect(events.some((e) => e.event.type === 'needInput')).toBe(true));
    expect(events[0]?.event).toMatchObject({
      type: 'needInput',
      id: 'sms',
      kind: 'text',
      title: '验证码',
    });
    expect(publisher.answer('ask', 'nope', 'x')).toBe(false);
    expect(publisher.answer('ask', 'sms', '1234')).toBe(true);
    const result = await pending;
    expect(events.map((e) => e.event.type)).toEqual(['needInput', 'log', 'done']);
    expect(result.results.ask).toEqual({
      ok: true,
      url: 'https://ask.example/1234',
      externalId: undefined,
    });
    expect(publisher.answer('ask', 'sms', 'again')).toBe(false);
  });

  it('cancelling fails the running needInput and never starts the platforms still queued', async () => {
    const { events, onEvent } = recorder();
    let started = 0;
    const ignoresSignal: Adapter = {
      key: 'later',
      label: 'Later',
      runtime: ['web'],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      async publish() {
        started++;
        return { url: 'https://later.example/1' };
      },
    };
    const publisher = createPublisher({
      adapters: [askAdapter, ignoresSignal],
      runtime: 'web',
      onEvent,
    });
    const controller = new AbortController();
    const pending = publisher.publish(job(['ask', 'later']), { signal: controller.signal });
    await vi.waitFor(() => expect(events.some((e) => e.event.type === 'needInput')).toBe(true));
    controller.abort();
    const result = await pending;
    expect(result.results.ask).toMatchObject({ ok: false, error: '已取消' });
    expect(result.results.later).toMatchObject({ ok: false, error: '已取消', code: 'aborted' });
    expect(started).toBe(0);
    expect(events.map((e) => `${e.platform}:${e.event.type}`)).toEqual([
      'ask:needInput',
      'ask:failed',
      'later:failed',
    ]);
    expect(events[1]?.event).toMatchObject({ type: 'failed', code: 'aborted' });
    expect(publisher.answer('ask', 'sms', 'late')).toBe(false);
  });

  it('runs platforms sequentially by default and in parallel with concurrency', async () => {
    const order: string[] = [];
    const slow = (key: string, ms: number): Adapter => ({
      key,
      label: key,
      runtime: ['web'],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      async publish() {
        order.push(`${key}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${key}:end`);
        return { url: key };
      },
    });
    const sequential = createPublisher({ adapters: [slow('a', 20), slow('b', 1)], runtime: 'web' });
    await sequential.publish(job(['a', 'b']));
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    order.length = 0;
    const parallel = createPublisher({
      adapters: [slow('a', 20), slow('b', 1)],
      runtime: 'web',
      concurrency: 2,
    });
    await parallel.publish(job(['a', 'b']));
    expect(order).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
  });

  it('exposes capabilities, adapters and passes fetch/apiBase/noteId to the context', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    let seen: { apiBase: string; noteId: string; runtime: string } | null = null;
    const probe: Adapter = {
      key: 'probe',
      label: 'Probe',
      runtime: ['node'],
      capabilities: { supportsUpdate: true },
      schema: z.object({}),
      async publish({ ctx }) {
        seen = { apiBase: ctx.apiBase, noteId: ctx.noteId, runtime: ctx.runtime };
        await ctx.fetch('/x');
        return { url: 'u' };
      },
    };
    const publisher = createPublisher({
      adapters: [probe],
      runtime: 'node',
      fetch: fetchMock,
      apiBase: 'http://h/api/v1/',
    });
    expect(publisher.capabilities('probe')).toEqual({ supportsUpdate: true });
    expect(publisher.capabilities('none')).toBeUndefined();
    expect(publisher.adapters).toEqual([probe]);
    await publisher.publish(job(['probe']));
    expect(seen).toEqual({ apiBase: 'http://h/api/v1', noteId: 'n1', runtime: 'server' });
    expect(fetchMock).toHaveBeenCalledWith('/x');
  });
});
