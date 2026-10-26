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

  it('not bound: offers the share sheet only on a phone; copy elsewhere', () => {
    // SPEC-r11 §10: the registry lists the API first; without a bound account the hand-off is what can run
    const meta = platformMeta('instagram')!;
    const kinds = (mobile: boolean) =>
      planRuntime(
        meta,
        { runtime: 'web', mobile, accounts: {} },
        { contentKind: 'image-set' }
      ).guides.map((g) => g.kind);
    expect(kinds(true)[0]).toBe('bind-first');
    expect(
      planRuntime(
        meta,
        { runtime: 'web', mobile: true, accounts: {} },
        { contentKind: 'image-set' }
      ).guides
    ).toContainEqual(expect.objectContaining({ kind: 'handoff', via: 'web-share' }));
    expect(kinds(false)).not.toContain('handoff');
    expect(kinds(false).at(-1)).toBe('copy');
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

describe('SPEC-r12 Instagram media limits', () => {
  it('a 3:1 image is an error, a WebP is refused', () => {
    const doc = fixtureDoc();
    const r = renderInstagram(
      doc,
      instagramAdapter.schema.parse({}),
      {},
      {
        kind: 'image-set',
        title: 't',
        caption: 'c',
        images: [
          { url: 'https://starnote.app/a.jpg', width: 1200, height: 400, mime: 'image/jpeg' },
          { url: 'https://starnote.app/b.webp', width: 1080, height: 1080, mime: 'image/webp' },
        ],
      },
      { assetBase: ASSET_BASE }
    );
    const media = r.report.filter((i) => i.kind.startsWith('media.'));
    expect(media).toEqual([
      expect.objectContaining({ kind: 'media.image.aspect', level: 'error' }),
      expect.objectContaining({ kind: 'media.image.format', level: 'error' }),
    ]);
    expect(instagramAdapter.parsePostUrl!('https://www.instagram.com/p/AbC/')?.externalId).toBe(
      'code:AbC'
    );
  });
});
