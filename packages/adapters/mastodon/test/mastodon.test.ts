import { MemoryCredentialStore } from '@starnote/publish-kit';
import { describe, expect, it } from 'vitest';

import { CANONICAL, fixtureDoc, json, mockFetch, runPublish } from '../../kit/test/helpers';
import {
  createMastodonAdapter,
  mastodonAdapter,
  mastodonBinding,
  mastodonLength,
  normalizeInstance,
  renderMastodon,
} from '../src/index';

describe('renderMastodon', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL, lang: 'zh-CN' };

  it('title + summary + hashtags + link, language from the article', () => {
    const r = renderMastodon(
      doc,
      mastodonAdapter.schema.parse({}),
      {
        title: 'Hello Title',
        summary: 'One line',
        tags: ['TypeScript', 'web dev', '2026'],
      },
      content
    );
    expect(r.body).toEqual({
      status: `Hello Title\n\nOne line\n\n#TypeScript #webdev\n\n${CANONICAL}`,
      visibility: 'public',
      language: 'zh',
    });
    expect(r.report.map((i) => i.kind)).toContain('link.card');
  });

  it('fits the instance limit (URLs count 23)', () => {
    expect(mastodonLength(`ab ${CANONICAL}`)).toBe(3 + 23);
    const r = renderMastodon(
      doc,
      mastodonAdapter.schema.parse({ visibility: 'unlisted', spoiler_text: 'CW', sensitive: true }),
      { title: 'T', summary: '长'.repeat(600), tags: ['a1', 'b2'] },
      content,
      { maxCharacters: 100 }
    );
    expect(mastodonLength(r.body.status)).toBeLessThanOrEqual(100);
    expect(r.body.status.endsWith(CANONICAL)).toBe(true);
    expect(r.body).toMatchObject({ visibility: 'unlisted', spoiler_text: 'CW', sensitive: true });
    expect(r.report.map((i) => i.kind)).toContain('share.truncated');
  });

  it('normalizes instance hosts', () => {
    expect(normalizeInstance('https://Mastodon.Social/@me')).toBe('mastodon.social');
    expect(normalizeInstance('127.0.0.1')).toBeNull();
    expect(normalizeInstance('localhost')).toBeNull();
    expect(mastodonBinding.form!.parse({ instance: 'https://fosstodon.org/' })).toEqual({
      instance: 'fosstodon.org',
    });
  });
});

describe('mastodon adapter', () => {
  it('uses the account limit and sends the page-memory token with the instance', async () => {
    const store = new MemoryCredentialStore();
    store.set(
      'mastodon',
      { access_token: 'tok', expires_at: null },
      { instance: 'mastodon.social' }
    );
    const adapter = createMastodonAdapter({ credential: store.credentialFor });
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/mastodon': () =>
        json({
          code: 0,
          data: { url: 'https://mastodon.social/@me/1', external_id: '1' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      adapter,
      {
        common: { title: 'x'.repeat(300) },
        accounts: {
          mastodon: {
            id: 'a',
            platform: 'mastodon',
            externalUid: '1',
            displayName: 'me',
            store: 'desktop',
            meta: { max_characters: 120 },
          },
        },
      },
      { runtime: 'web', fetch }
    );
    expect(result.ok).toBe(true);
    expect(calls[0]!.body.credential).toEqual({ access_token: 'tok', instance: 'mastodon.social' });
    expect(mastodonLength(calls[0]!.body.body.status)).toBeLessThanOrEqual(120);
  });
});
