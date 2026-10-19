import { planRuntime, platformMeta } from '@starnote/publish-core';
import { describe, expect, it, vi } from 'vitest';

import { ASSET_BASE, CANONICAL, fixtureDoc, runPublish } from '../../kit/test/helpers';
import {
  createInstagramAdapter,
  instagramAdapter,
  prepareInstagramFiles,
  renderInstagram,
  shareToInstagram,
} from '../src/index';

describe('renderInstagram', () => {
  const doc = fixtureDoc();
  it('cover + body images as files, caption with hashtags and the link as text', () => {
    const r = renderInstagram(
      doc,
      instagramAdapter.schema.parse({}),
      {
        title: 'Hello Title',
        summary: 'One line',
        tags: ['Type Script', 'AI'],
        cover: '/covers/c.png',
      },
      { kind: 'article', doc, canonicalUrl: CANONICAL },
      { assetBase: ASSET_BASE }
    );
    expect(r.files).toEqual([
      { url: 'https://starnote.app/covers/c.png', filename: 'starnote-01.png' },
      { url: 'https://starnote.app/assets/a.png', filename: 'starnote-02.png' },
    ]);
    expect(r.caption).toBe(`Hello Title\n\nOne line\n\n#TypeScript #AI\n\n原文：${CANONICAL}`);
    expect(r.handoff).toMatchObject({
      via: 'web-share',
      openUrl: 'https://www.instagram.com/',
      copyText: r.caption,
    });
    expect(r.report.find((i) => i.kind === 'handoff.pending')!.text).toContain('Instagram App');
  });

  it('image sets: up to max_images, caption and topics from the set', () => {
    const images = Array.from({ length: 12 }, (_, i) => ({
      url: `https://cdn.example/${i}.jpg`,
      mime: 'image/jpeg',
    }));
    const r = renderInstagram(
      doc,
      instagramAdapter.schema.parse({ max_images: 10 }),
      {},
      { kind: 'image-set', title: 'T', caption: '图集说明', images, topics: ['旅行'] }
    );
    expect(r.files).toHaveLength(10);
    expect(r.files[0]!.filename).toBe('starnote-01.jpg');
    expect(r.caption).toBe('图集说明\n\n#旅行');
    expect(r.report.map((i) => i.kind)).toContain('image.trimmed');
  });
});

describe('instagram adapter', () => {
  it('ends in a hand-off with the files; fails without images', async () => {
    const adapter = createInstagramAdapter({ assetBase: ASSET_BASE });
    const { result } = await runPublish(adapter, {}, { runtime: 'web' });
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
    expect(result.handoff!.files!.length).toBe(1);
    const empty = await runPublish(
      adapter,
      { doc: { ...fixtureDoc(), images: [] } },
      { runtime: 'web' }
    );
    expect(empty.terminal[0]).toMatchObject({ type: 'failed', code: 'invalid' });
  });

  it('offers the share sheet only on a phone; copy elsewhere', () => {
    const meta = platformMeta('instagram')!;
    expect(
      planRuntime(meta, { runtime: 'web', mobile: true }, { contentKind: 'image-set' }).primary
    ).toMatchObject({
      kind: 'handoff',
      via: 'web-share',
    });
    expect(planRuntime(meta, { runtime: 'web' }, { contentKind: 'image-set' }).primary.kind).toBe(
      'copy'
    );
  });

  it('shares files + caption through navigator.share, copying the caption first', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    ) as unknown as typeof fetch;
    const files = await prepareInstagramFiles(
      [{ url: 'https://starnote.app/a.png', filename: 'starnote-01.png' }],
      fetchImpl
    );
    expect(files[0]!.name).toBe('starnote-01.png');
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    expect(
      await shareToInstagram(files, 'cap', {
        share,
        canShare: () => true,
        clipboard: { writeText },
      })
    ).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files, text: 'cap' });
    expect(writeText).toHaveBeenCalledWith('cap');
    expect(await shareToInstagram(files, 'cap', { share, canShare: () => false })).toBe(
      'unsupported'
    );
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(
      await shareToInstagram(files, 'cap', {
        share: async () => Promise.reject(abort),
        canShare: () => true,
      })
    ).toBe('cancelled');
  });
});
