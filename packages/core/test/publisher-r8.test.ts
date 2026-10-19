import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { convert } from '../src/convert';
import { defineAdapter } from '../src/define';
import { createPublisher } from '../src/publisher';

import type { Adapter, PublishEvent, PublishJob } from '../src/types';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
});

function job(platforms: string[], extra: Partial<PublishJob> = {}): PublishJob {
  return { noteId: 'n1', doc, platforms, common: { title: 'T' }, perPlatform: {}, ...extra };
}

const reporter = defineAdapter({
  key: 'rep',
  label: 'Rep',
  runtimes: [{ runtime: 'web', mode: 'api' }],
  capabilities: { supportsUpdate: false },
  schema: z.object({ n: z.number().default(2) }),
  preview: (d, form) => ({ format: 'html', title: d.title, body: `n=${form.n}`, report: [] }),
  async publish({ ctx, content }) {
    ctx.emit({ type: 'report', items: [{ kind: 'image.rehosted', text: '1 张', count: 1 }] });
    ctx.emit({ type: 'report', items: [{ kind: 'image.rehosted', text: '2 张', count: 2 }] });
    ctx.emit({
      type: 'log',
      level: 'info',
      text: `kind=${content?.kind} account=${ctx.account?.id ?? '-'}`,
    });
    return {
      url: 'https://rep/1',
      state: 'draft',
      report: [{ kind: 'draft.only', text: '只存了草稿', level: 'notice' }],
    };
  },
});

const imageOnly: Adapter = defineAdapter({
  key: 'img',
  label: 'Img',
  runtimes: [{ runtime: 'web', mode: 'api' }],
  contentTypes: ['image-set'],
  capabilities: { supportsUpdate: false },
  schema: z.object({}),
  publish: async () => ({ url: 'https://img/1' }),
});

describe('createPublisher (SPEC-r8 increments)', () => {
  it('collects report events and the returned report into the result and the done event', async () => {
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [reporter],
      runtime: 'web',
      onEvent: (_p, e) => events.push(e),
    });
    const { results } = await publisher.publish(
      job(['rep'], {
        accounts: {
          rep: { id: 'a1', platform: 'rep', externalUid: 'u', displayName: 'U', store: 'server' },
        },
      })
    );
    expect(results.rep).toEqual({
      ok: true,
      url: 'https://rep/1',
      externalId: undefined,
      state: 'draft',
      report: [
        { kind: 'image.rehosted', text: '2 张', count: 2 },
        { kind: 'draft.only', text: '只存了草稿', level: 'notice' },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['report', 'report', 'log', 'done']);
    expect(events[2]).toMatchObject({ text: 'kind=article account=a1' });
    expect(events[3]).toMatchObject({ type: 'done', state: 'draft', report: results.rep?.report });
  });

  it('checks the runtime through `runtimes` and returns guides on a runtime failure', async () => {
    const publisher = createPublisher({ adapters: [reporter], runtime: 'electron' });
    const { results } = await publisher.publish(job(['rep']));
    expect(results.rep).toMatchObject({ ok: false, error: 'Rep 不能在桌面端发布' });
    expect(results.rep?.guides?.at(-1)?.kind).toBe('copy');
  });

  it('fails a platform that does not take the content kind', async () => {
    const events: PublishEvent[] = [];
    const publisher = createPublisher({
      adapters: [imageOnly],
      runtime: 'web',
      onEvent: (_p, e) => events.push(e),
    });
    const { results } = await publisher.publish(job(['img']));
    expect(results.img?.ok).toBe(false);
    expect(events).toEqual([expect.objectContaining({ type: 'failed', code: 'kind_unsupported' })]);
    const ok = await publisher.publish(
      job(['img'], {
        perPlatformContent: { img: { kind: 'image-set', title: 't', caption: 'c', images: [] } },
      })
    );
    expect(ok.results.img?.ok).toBe(true);
  });

  it('plans with the adapter when registered and with the registry otherwise', () => {
    const publisher = createPublisher({
      adapters: [reporter],
      runtime: 'web',
      env: { serverRelay: true },
    });
    expect(publisher.plan('rep')[0]?.kind).toBe('run-here');
    expect(publisher.plan('wechat').map((g) => g.kind)).toEqual([
      'server',
      'download-desktop',
      'desktop',
      'copy',
    ]);
    expect(
      publisher.plan('wechat', { env: { serverRelay: false, desktopOnline: true } })[0]
    ).toMatchObject({
      kind: 'desktop',
      online: true,
    });
    expect(publisher.plan('nope').map((g) => g.kind)).toEqual(['copy']);
  });

  it('previews with the validated form', async () => {
    const publisher = createPublisher({ adapters: [reporter, imageOnly], runtime: 'web' });
    expect(await publisher.preview('rep', { doc })).toMatchObject({ body: 'n=2' });
    expect(await publisher.preview('img', { doc })).toBeUndefined();
    await expect(publisher.preview('rep', { doc, form: { n: 'x' } })).rejects.toThrow();
  });
});
