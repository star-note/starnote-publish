import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { convert } from '../src/convert';
import { defineAdapter } from '../src/define';
import { statsRow } from '../src/insights';
import { createPublisher } from '../src/publisher';
import {
  CANONICAL_PLACEHOLDER,
  errorKindOf,
  fillCanonicalPlaceholder,
  finalizeKeyOf,
  idempotencyKeyOf,
  targetKey,
} from '../src/targets';

import type { Adapter, PendingCheck, PublishContext, PublishEvent, PublishJob } from '../src/types';

const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'hi there' }] },
  ],
});

function job(extra: Partial<PublishJob> = {}): PublishJob {
  return { noteId: 'n1', doc, common: { title: 'T' }, perPlatform: {}, ...extra };
}

/** A clock that advances by the slept time, so polling runs instantly. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

function threeStage(script: Array<PendingCheck | Error>, finalize?: () => Promise<PendingCheck>) {
  const calls = { check: 0, finalize: 0 };
  const adapter: Adapter = defineAdapter({
    key: 'ts',
    label: 'Three',
    runtimes: [{ runtime: 'web', mode: 'api' }],
    capabilities: { supportsUpdate: false },
    schema: z.object({}),
    pollIntervalSec: 5,
    pollTimeoutSec: 60,
    publish: async () => ({ url: '', state: 'processing', pending: { container_id: 'c1' } }),
    async checkStatus(pending) {
      expect(pending).toBeTruthy();
      const next = script[Math.min(calls.check, script.length - 1)]!;
      calls.check += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    async finalize(pending) {
      calls.finalize += 1;
      expect(pending).toEqual({ container_id: 'c1', ready: true });
      return finalize
        ? finalize()
        : { status: 'completed', url: 'https://ts/p/1', externalId: 'p1' };
    },
  });
  return { adapter, calls };
}

describe('three-stage publishing (SPEC-r11 §2)', () => {
  it('polls checkStatus, finalizes once on ready, ends done with the post', async () => {
    const { adapter, calls } = threeStage([
      { status: 'pending', pending: { container_id: 'c1' } },
      { status: 'ready', pending: { container_id: 'c1', ready: true } },
    ]);
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [adapter],
      runtime: 'web',
      clock: fakeClock(),
      onEvent: (_k, e) => events.push(e),
    });
    const { results } = await publisher.publish(job({ platforms: ['ts'] }));
    expect(results.ts).toMatchObject({ ok: true, url: 'https://ts/p/1', externalId: 'p1' });
    expect(calls).toEqual({ check: 2, finalize: 1 });
    expect(events.filter((e) => e.type === 'done')).toEqual([
      expect.objectContaining({ url: 'https://ts/p/1', externalId: 'p1', state: 'published' }),
    ]);
  });

  it('a transient status error waits for the next round; a timeout fails as unknown', async () => {
    const transient = Object.assign(new Error('503'), { errorKind: 'retry' });
    const { adapter } = threeStage([
      transient,
      { status: 'pending', pending: { container_id: 'c1' } },
    ]);
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [adapter],
      runtime: 'web',
      clock: fakeClock(),
      onEvent: (_k, e) => events.push(e),
    });
    const { results } = await publisher.publish(job({ platforms: ['ts'] }));
    expect(results.ts).toMatchObject({ ok: false, kind: 'unknown', code: 'timeout' });
    const failed = events.find((e) => e.type === 'failed')!;
    expect(failed).toMatchObject({ kind: 'unknown', code: 'timeout' });
    expect((failed as any).actions.map((a: any) => a.label)).toEqual(['去平台确认', '仍要重发']);
  });

  it('never finalizes twice: ready after finalize fails as unknown', async () => {
    const { adapter, calls } = threeStage(
      [{ status: 'ready', pending: { container_id: 'c1', ready: true } }],
      async () => ({ status: 'pending', pending: { container_id: 'c1', ready: true } })
    );
    const publisher = createPublisher({ adapters: [adapter], runtime: 'web', clock: fakeClock() });
    const { results } = await publisher.publish(job({ platforms: ['ts'] }));
    expect(calls.finalize).toBe(1);
    expect(results.ts).toMatchObject({ ok: false, kind: 'unknown', code: 'finalize_replayed' });
  });

  it('pollProcessing: false hands back the pending state', async () => {
    const { adapter, calls } = threeStage([]);
    const publisher = createPublisher({
      adapters: [adapter],
      runtime: 'web',
      pollProcessing: false,
    });
    const { results } = await publisher.publish(job({ platforms: ['ts'] }));
    expect(results.ts).toMatchObject({
      ok: true,
      state: 'processing',
      pending: { container_id: 'c1' },
    });
    expect(calls.check).toBe(0);
  });
});

describe('failure kinds (SPEC-r11 §1)', () => {
  it('carries the thrown errorKind to failed and the result', async () => {
    const adapter = defineAdapter({
      key: 'bad',
      label: 'Bad',
      runtimes: [{ runtime: 'web', mode: 'api' }],
      capabilities: { supportsUpdate: false },
      schema: z.object({}),
      publish: async () => {
        throw Object.assign(new Error('revoked'), {
          code: 'relogin',
          errorKind: 'disconnect',
          actions: [{ id: 'relogin', label: '重新绑定', kind: 'relogin' }],
        });
      },
    });
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [adapter],
      runtime: 'web',
      onEvent: (_k, e) => events.push(e),
    });
    const { results } = await publisher.publish(job({ platforms: ['bad'] }));
    expect(results.bad).toMatchObject({ ok: false, kind: 'disconnect', code: 'relogin' });
    expect(events.at(-1)).toMatchObject({ type: 'failed', kind: 'disconnect' });
    // invalid forms are bad_body
    const strict = defineAdapter({
      ...adapter,
      key: 'strict',
      schema: z.object({ a: z.string() }),
    });
    const r2 = await createPublisher({ adapters: [strict], runtime: 'web' }).publish(
      job({ platforms: ['strict'] })
    );
    expect(r2.results.strict).toMatchObject({ ok: false, kind: 'bad_body' });
  });

  it('errorKindOf reads errorKind, session errors and codes', () => {
    expect(errorKindOf({ errorKind: 'retry' })).toBe('retry');
    expect(errorKindOf({ name: 'PlatformSessionError', kind: 'relogin' })).toBe('disconnect');
    expect(errorKindOf({ name: 'PlatformSessionError', kind: 'challenge' })).toBeUndefined();
    expect(errorKindOf({ code: 'rate_limited' })).toBe('retry');
    expect(errorKindOf(new Error('x'))).toBeUndefined();
  });
});

describe('targets, accounts and idempotency (SPEC-r11 §3, §5.3)', () => {
  const seen: Array<
    Pick<PublishContext, 'account' | 'accountId' | 'jobId' | 'attempt'> & { key?: string }
  > = [];
  const multi = defineAdapter({
    key: 'm',
    label: 'Multi',
    runtimes: [{ runtime: 'web', mode: 'api' }],
    capabilities: { supportsUpdate: false },
    schema: z.object({ v: z.string().default('x') }),
    async publish({ ctx, form }) {
      seen.push({
        account: ctx.account,
        accountId: ctx.accountId,
        jobId: ctx.jobId,
        attempt: ctx.attempt,
        key: idempotencyKeyOf(ctx, 'm'),
      });
      return { url: `https://m/${ctx.accountId ?? 'default'}/${form.v}` };
    },
  });

  it('one result per account, keyed platform@account, with the derived idempotency key', async () => {
    seen.length = 0;
    const publisher = createPublisher({ adapters: [multi], runtime: 'web' });
    const { results } = await publisher.publish(
      job({
        jobId: 'job1',
        attempt: 2,
        targets: [
          { platform: 'm', accountId: 'a1' },
          { platform: 'm', accountId: 'a2', form: { v: 'y' }, idempotencyKey: 'stored-key' },
        ],
        accounts: {
          m: {
            id: 'a1',
            platform: 'm',
            externalUid: 'u1',
            displayName: 'One',
            store: 'server',
          },
        },
      })
    );
    expect(Object.keys(results)).toEqual(['m@a1', 'm@a2']);
    expect(results['m@a1']).toMatchObject({ ok: true, url: 'https://m/a1/x', accountId: 'a1' });
    expect(results['m@a2']).toMatchObject({ ok: true, url: 'https://m/a2/y', platform: 'm' });
    expect(seen[0]).toMatchObject({
      accountId: 'a1',
      jobId: 'job1',
      attempt: 2,
      key: 'job1:m:a1:2',
    });
    expect(seen[0]!.account?.displayName).toBe('One');
    // the job's account is a1's: a2 gets no AccountRef, only its id
    expect(seen[1]).toMatchObject({ accountId: 'a2', key: 'stored-key' });
    expect(seen[1]!.account).toBeUndefined();
  });

  it('plain platform jobs keep their keys and no idempotency key without a job id', async () => {
    seen.length = 0;
    const { results } = await createPublisher({ adapters: [multi], runtime: 'web' }).publish(
      job({ platforms: ['m'] })
    );
    expect(results).toEqual({ m: { ok: true, url: 'https://m/default/x' } });
    expect(seen[0]!.key).toBeUndefined();
  });

  it('helpers', () => {
    expect(targetKey({ platform: 'x' })).toBe('x');
    expect(targetKey({ platform: 'x', accountId: '9' })).toBe('x@9');
    expect(idempotencyKeyOf({ jobId: 'j' }, 'p')).toBe('j:p:default:1');
    expect(idempotencyKeyOf({ jobId: 'j'.repeat(300) }, 'p')).toHaveLength(200);
    expect(finalizeKeyOf('threads', 'c9')).toBe('finalize:threads:c9');
    expect(
      fillCanonicalPlaceholder(
        { a: `x ${CANONICAL_PLACEHOLDER}`, b: [CANONICAL_PLACEHOLDER] },
        'https://s.app/@me/"q"'
      )
    ).toEqual({ a: 'x https://s.app/@me/"q"', b: ['https://s.app/@me/"q"'] });
    expect(
      statsRow('mastodon', '1', { fetchedAt: 't', source: 'public', reads: 5, likes: 2 })
    ).toEqual({ platform: 'mastodon', external_id: '1', views: 5, likes: 2 });
  });
});

describe('maxConcurrent (SPEC-r11 §6)', () => {
  it('limits one platform while others run alongside', async () => {
    let running = 0;
    let peak = 0;
    const order: string[] = [];
    const slow = (key: string, maxConcurrent?: number) =>
      defineAdapter({
        key,
        label: key,
        runtimes: [{ runtime: 'web', mode: 'api' }],
        capabilities: { supportsUpdate: false },
        schema: z.object({}),
        ...(maxConcurrent ? { maxConcurrent } : {}),
        async publish({ ctx }) {
          if (key === 'one') {
            running += 1;
            peak = Math.max(peak, running);
          }
          order.push(`${key}:${ctx.accountId}`);
          await new Promise((r) => setTimeout(r, 5));
          if (key === 'one') running -= 1;
          return { url: `u:${key}` };
        },
      });
    const publisher = createPublisher({
      adapters: [slow('one', 1), slow('two')],
      runtime: 'web',
      concurrency: 4,
    });
    const { results } = await publisher.publish(
      job({
        targets: [
          { platform: 'one', accountId: 'a' },
          { platform: 'one', accountId: 'b' },
          { platform: 'two', accountId: 'c' },
          { platform: 'one', accountId: 'd' },
        ],
      })
    );
    expect(Object.values(results).every((r) => r.ok)).toBe(true);
    expect(peak).toBe(1);
    // `two` did not wait behind the queued `one`s
    expect(order.indexOf('two:c')).toBeLessThan(order.indexOf('one:b'));
  });
});

describe('publisher.prepare (SPEC-r11 §12)', () => {
  const relayAdapter = defineAdapter({
    key: 'rel',
    label: 'Rel',
    runtimes: [
      { runtime: 'web', mode: 'api', needs: ['token'] },
      { runtime: 'electron', mode: 'api', needs: ['token'] },
      { runtime: 'server', mode: 'api', needs: ['token'], schedulable: true },
      {
        runtime: 'web',
        mode: 'handoff',
        handoff: { via: 'share-intent', url: 'https://rel/share' },
      },
    ],
    contentTypes: ['article', 'short-text'],
    binding: { kind: 'oauth', store: 'desktop' },
    capabilities: { supportsUpdate: false },
    schema: z.object({ tone: z.enum(['a', 'b']).default('a') }),
    renderRequest: ({ content, form, previous }) => ({
      body: {
        link: content?.kind === 'article' ? content.canonicalUrl : undefined,
        tone: form.tone,
      },
      ...(previous ? { previous: { external_id: previous.externalId } } : {}),
      report: [{ kind: 'link.card', text: 'card' }],
    }),
    renderHandoff: ({ content }) => ({
      handoff: {
        via: 'share-intent',
        openUrl: `https://rel/share?u=${content?.kind === 'article' ? content.canonicalUrl : ''}`,
        copyText: 'copy',
      },
    }),
    publish: async () => ({ url: 'x' }),
  });
  const chenji = defineAdapter({
    key: 'chenji',
    label: '辰记',
    runtimes: [{ runtime: 'server', mode: 'api', schedulable: true }],
    binding: { kind: 'session', store: 'none' },
    capabilities: { supportsUpdate: true },
    schema: z.object({}),
    renderRequest: ({ doc: d }) => ({ body: { title: d.title } }),
    publish: async () => ({ url: 'x' }),
  });
  const desk = defineAdapter({
    key: 'zhihu',
    label: '知乎',
    runtimes: [{ runtime: 'electron', mode: 'automation', needs: ['session'] }],
    binding: { kind: 'cookie', store: 'desktop' },
    capabilities: { supportsUpdate: false },
    schema: z.object({}),
    publish: async () => ({ url: 'x' }),
  });
  const publisher = createPublisher({ adapters: [relayAdapter, chenji, desk], runtime: 'web' });

  it('plans every target: server / desktop / handoff, 辰记 first, the placeholder for its link', () => {
    const tasks = publisher.prepare({
      doc,
      common: { title: 'T' },
      targets: [
        { platform: 'rel', accountId: 'cloud1' },
        { platform: 'rel', accountId: 'local1' },
        { platform: 'rel', accountId: 'page1' },
        { platform: 'zhihu' },
        { platform: 'chenji' },
        { platform: 'medium' },
      ],
      perPlatform: { 'rel@local1': { tone: 'b' } },
      accounts: [
        {
          platform: 'rel',
          accountId: 'cloud1',
          cloud: true,
          local: false,
          label: '主号',
          isDefault: true,
        },
        { platform: 'rel', accountId: 'local1', cloud: false, local: true },
        { platform: 'rel', accountId: 'page1', cloud: false, local: false },
        { platform: 'zhihu', accountId: 'z', cloud: false, local: true },
      ],
      previous: { 'rel@cloud1': { platform: 'rel', externalId: 'old1' } },
    });
    expect(tasks.map((t) => [t.platform, t.seq, t.runtime])).toEqual([
      ['chenji', 0, 'server'],
      ['rel', 1, 'server'],
      ['rel', 2, 'desktop'],
      ['rel', 3, 'server'],
      ['zhihu', 4, 'desktop'],
      ['medium', 5, 'handoff'],
    ]);
    const [chenjiTask, cloud, local, page, zhihu, medium] = tasks;
    expect(chenjiTask).toMatchObject({ request: { body: { title: 'Title' } }, label: '辰记' });
    expect(chenjiTask!.dependsOnChenji).toBeUndefined();
    expect(cloud).toMatchObject({
      accountId: 'cloud1',
      label: 'Rel · 主号',
      request: {
        body: { link: CANONICAL_PLACEHOLDER, tone: 'a' },
        previous: { external_id: 'old1' },
      },
      report: [{ kind: 'link.card', text: 'card' }],
      dependsOnChenji: true,
    });
    expect(local!.request!.body).toMatchObject({ tone: 'b' });
    expect(page).toMatchObject({
      problem: { code: 'needs_cloud' },
      handoff: { open_url: `https://rel/share?u=${CANONICAL_PLACEHOLDER}`, copy_text: 'copy' },
    });
    expect(page!.request).toBeDefined();
    // 发布台: no request, the desktop renders it when claiming
    expect(zhihu!.request).toBeUndefined();
    expect(zhihu!.problem).toBeUndefined();
    // not registered, registry only: a copy reminder
    expect(medium!.handoff!.copy_text).toContain(CANONICAL_PLACEHOLDER);
  });

  it('unbound platforms fall back to their hand-off; a known link replaces the placeholder', () => {
    const tasks = publisher.prepare({
      doc,
      common: {},
      targets: [{ platform: 'chenji' }, { platform: 'rel' }, { platform: 'zhihu' }],
      canonicalUrl: 'https://starnote.app/@me/abc',
    });
    const rel = tasks.find((t) => t.platform === 'rel')!;
    expect(rel).toMatchObject({
      runtime: 'handoff',
      handoff: { open_url: 'https://rel/share?u=https://starnote.app/@me/abc' },
    });
    expect(rel.request).toBeUndefined();
    expect(rel.problem).toBeUndefined();
    expect(rel.dependsOnChenji).toBeUndefined();
    expect(tasks.find((t) => t.platform === 'zhihu')).toMatchObject({
      runtime: 'handoff',
      problem: { code: 'needs_binding' },
    });
  });

  it('reports invalid forms and unsupported content without throwing; sends nothing', () => {
    const fetch = vi.fn();
    const p = createPublisher({ adapters: [relayAdapter], runtime: 'web', fetch });
    const [bad, kind] = p.prepare({
      doc,
      common: {},
      targets: [
        { platform: 'rel', form: { tone: 'zzz' } },
        { platform: 'rel', content: { kind: 'video' } as any },
      ],
      accounts: [{ platform: 'rel', accountId: '1', cloud: true, local: false }],
    });
    expect(bad!.problem!.code).toBe('invalid_form');
    expect(kind!.problem!.code).toBe('unsupported');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('registry (SPEC-r11 §10)', () => {
  it('direct platforms list the API first, then the existing hand-off / copy', async () => {
    const { platformMeta } = await import('../src/platforms');
    const { planRuntime } = await import('../src/runtime');
    for (const key of ['telegram', 'linkedin', 'threads', 'facebook', 'pinterest', 'instagram']) {
      const m = platformMeta(key)!;
      expect(m.runtimes[0]!.mode, key).toBe('api');
      expect(
        m.runtimes.at(-1)!.mode === 'handoff' || m.runtimes.at(-1)!.mode === 'manual',
        key
      ).toBe(true);
      expect(m.stage).toBe('implemented');
    }
    for (const key of ['discord', 'slack']) {
      const m = platformMeta(key)!;
      expect(m.binding).toMatchObject({
        kind: 'token',
        store: 'server',
        fields: expect.any(Array),
      });
      expect(m.runtimes.map((r) => r.mode)).toEqual(['api', 'api', 'api', 'manual']);
    }
    // not bound: bind first, the share link is still offered
    const kinds = planRuntime(platformMeta('telegram')!, {
      runtime: 'web',
      accounts: {},
    }).guides.map((g) => g.kind);
    expect(kinds[0]).toBe('bind-first');
    expect(kinds).toContain('handoff');
  });
});

describe('toScheduleTasks', () => {
  it('maps to the API TaskIn shape; blocking problems out, needs_cloud → hand-off', async () => {
    const { toScheduleTasks } = await import('../src/prepare');
    const base = { label: 'L', seq: 0 };
    const tasks = toScheduleTasks([
      { ...base, platform: 'chenji', runtime: 'server', request: { body: { t: 1 } } },
      {
        ...base,
        seq: 1,
        platform: 'rel',
        accountId: 'local-rel-ab',
        runtime: 'desktop',
        request: { body: { l: CANONICAL_PLACEHOLDER }, previous: { external_id: 'o' } },
        report: [{ kind: 'x', text: 'x' }],
        dependsOnChenji: true,
      },
      {
        ...base,
        seq: 2,
        platform: 'bad',
        runtime: 'server',
        problem: { code: 'invalid_form', message: '' },
      },
      {
        ...base,
        seq: 3,
        platform: 'page',
        accountId: '9',
        runtime: 'server',
        request: { body: {} },
        handoff: { open_url: 'https://s', copy_text: 'c' },
        problem: { code: 'needs_cloud', message: '' },
      },
      { ...base, seq: 4, platform: 'zhihu', runtime: 'desktop' },
    ]);
    expect(tasks).toEqual([
      { platform: 'chenji', runtime: 'server', seq: 0, request: { body: { t: 1 } }, label: 'L' },
      {
        platform: 'rel',
        account_id: 'local-rel-ab',
        runtime: 'desktop',
        seq: 1,
        request: { body: { l: CANONICAL_PLACEHOLDER }, previous: { external_id: 'o' } },
        label: 'L',
      },
      {
        platform: 'page',
        account_id: '9',
        runtime: 'handoff',
        seq: 2,
        handoff: { open_url: 'https://s', copy_text: 'c' },
        label: 'L',
      },
      { platform: 'zhihu', runtime: 'desktop', seq: 3, label: 'L' },
    ]);
  });

  it('drops placeholder dependents when 辰记 cannot run; needs_cloud drop / keep', async () => {
    const { toScheduleTasks } = await import('../src/prepare');
    const prepared = [
      {
        platform: 'chenji',
        runtime: 'server' as const,
        seq: 0,
        label: '辰记',
        problem: { code: 'render_failed' as const, message: '' },
      },
      {
        platform: 'a',
        runtime: 'handoff' as const,
        seq: 1,
        label: 'A',
        handoff: { open_url: 'x' },
        dependsOnChenji: true,
      },
      {
        platform: 'b',
        runtime: 'server' as const,
        seq: 2,
        label: 'B',
        request: { body: {} },
        handoff: { open_url: 'y' },
        problem: { code: 'needs_cloud' as const, message: '' },
      },
    ];
    expect(toScheduleTasks(prepared, { needsCloud: 'drop' })).toEqual([]);
    expect(toScheduleTasks(prepared, { needsCloud: 'keep' })).toEqual([
      { platform: 'b', runtime: 'server', seq: 1, request: { body: {} }, label: 'B' },
    ]);
  });
});
