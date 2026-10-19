import { planRuntime } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { ghostAdapter } from '../../ghost/src/index';
import { hashnodeAdapter } from '../../hashnode/src/index';
import { shareAdapters } from '../../share/src/index';
import { wordpressAdapter } from '../../wordpress/src/index';
import { relayPath } from '../src/index';
import { ASSET_BASE, CANONICAL, json, mockFetch, runPublish } from './helpers';

import type { Adapter } from '@starnote/publish-core';

function relay(adapter: Adapter<any>, form: unknown = {}) {
  const { fetch, calls } = mockFetch({
    [`POST /api/v1/notes/note-1/publish/${adapter.key}`]: () =>
      json({
        code: 0,
        data: { url: 'https://x.test/p', external_id: 'p1', report: [] },
        message: 'ok',
      }),
  });
  return runPublish(
    adapter,
    {
      form,
      common: { title: 'Hello Title', tags: ['TS', 'Web Dev'], cover: `${ASSET_BASE}c.png` },
    },
    { runtime: 'web', fetch }
  ).then((r) => ({ ...r, sent: calls[0]!.body }));
}

describe('relay bodies', () => {
  it('builds the relay path', () => {
    expect(relayPath('/api/v1/', 'n 1', 'devto')).toBe('/api/v1/notes/n%201/publish/devto');
  });

  it('Hashnode: mode + input (publicationId only when the form picked one)', async () => {
    const { sent, result } = await relay(hashnodeAdapter, { mode: 'draft' });
    expect(result).toMatchObject({ ok: true, externalId: 'p1' });
    expect(sent.body.mode).toBe('draft');
    expect(sent.body.input).toMatchObject({ title: 'Hello Title', originalArticleURL: CANONICAL });
    expect(sent.body.input.publicationId).toBeUndefined();
    const picked = await relay(hashnodeAdapter, { publication_id: 'a'.repeat(24) });
    expect(picked.sent.body.input.publicationId).toBe('a'.repeat(24));
  });

  it('Ghost: post + images / cover for the server to upload', async () => {
    const { sent } = await relay(ghostAdapter);
    expect(sent.body.post).toMatchObject({
      title: 'Hello Title',
      status: 'published',
      canonical_url: CANONICAL,
    });
    expect(sent.body.cover).toBe(`${ASSET_BASE}c.png`);
    const linked = await relay(ghostAdapter, { upload_images: false });
    expect(linked.sent.body.images).toEqual([]);
    expect(linked.sent.body.cover).toBeUndefined();
  });

  it('WordPress: post without tags + tag names', async () => {
    const { sent, result } = await relay(wordpressAdapter, { status: 'pending' });
    expect(sent.body.tag_names).toEqual(['TS', 'Web Dev']);
    expect(sent.body.post.tags).toBeUndefined();
    expect(sent.body.post.content).toContain('本文首发于');
    expect(result.state).toBe('pending-review');
  });
});

describe('hand-off', () => {
  it('share adapters return the hand-off on the result and on done', async () => {
    const { result, terminal } = await runPublish(shareAdapters.telegram, {}, { runtime: 'web' });
    expect(result.handoff).toMatchObject({ via: 'share-intent' });
    expect(result.handoff!.openUrl.startsWith('https://t.me/share/url?')).toBe(true);
    expect((terminal[0] as any).handoff).toEqual(result.handoff);
  });

  it('planRuntime never sends hand-off platforms to the desktop download', () => {
    for (const env of [
      { runtime: 'web' as const },
      { runtime: 'electron' as const },
      { runtime: 'node' as const },
    ]) {
      const kinds = planRuntime(shareAdapters.x, env, { contentKind: 'short-text' }).guides.map(
        (g) => g.kind
      );
      expect(kinds).toEqual(['handoff', 'copy']);
    }
  });
});
