import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { discordAdapter, discordMessageUrl, discordWebhookForm, renderDiscord } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => discordAdapter.schema.parse(v);

describe('renderDiscord', () => {
  it('one embed card: title linked, summary, cover; the user line as content', () => {
    const r = renderDiscord(
      doc,
      parse({ text: '新文章 👇' }),
      { title: 'Hello', summary: 'Sum', cover: '/c.png' },
      article,
      { assetBase: ASSET_BASE }
    );
    expect(r.body).toEqual({
      content: '新文章 👇',
      embeds: [
        {
          title: 'Hello',
          description: 'Sum',
          url: CANONICAL,
          image: { url: 'https://starnote.app/c.png' },
        },
      ],
    });
    expect(r.text).toBe(`新文章 👇\n\nHello\n\nSum\n\n${CANONICAL}`);
  });

  it('caps the title at 256 and the card summary', () => {
    const r = renderDiscord(
      doc,
      parse(),
      { title: 't'.repeat(300), summary: 's'.repeat(1000) },
      article
    );
    expect([...r.body.embeds[0]!.title]).toHaveLength(256);
    expect([...r.body.embeds[0]!.description!].length).toBeLessThanOrEqual(350);
    expect(r.body.content).toBeUndefined();
  });

  it('accepts only Discord webhook URLs', () => {
    const ok = `https://discord.com/api/webhooks/123456789012/${'a'.repeat(60)}`;
    expect(discordWebhookForm.safeParse({ webhook_url: ok }).success).toBe(true);
    expect(
      discordWebhookForm.safeParse({ webhook_url: ok.replace('discord.com', 'evil.com') }).success
    ).toBe(false);
    expect(discordMessageUrl('g', 'c', 'm')).toBe('https://discord.com/channels/g/c/m');
  });
});

describe('discord adapter', () => {
  it('relays the webhook body; errors carry their kind', async () => {
    const ok = mockFetch({
      'POST /api/v1/notes/note-1/publish/discord': () =>
        json({ code: 0, data: { url: 'https://discord.com/channels/g/c/1', external_id: '1' } }),
    });
    const { result } = await runPublish(discordAdapter, {}, { runtime: 'web', fetch: ok.fetch });
    expect(result).toMatchObject({ ok: true, externalId: '1' });
    expect(ok.calls[0]!.body.body.embeds[0].url).toBe(CANONICAL);
    const gone = mockFetch({
      'POST /api/v1/notes/note-1/publish/discord': () =>
        json(
          {
            code: 40401,
            message: 'Unknown Webhook',
            data: { error_code: 'not_found', error_kind: 'disconnect' },
          },
          404
        ),
    });
    const failed = await runPublish(discordAdapter, {}, { runtime: 'web', fetch: gone.fetch });
    expect(failed.result).toMatchObject({ ok: false, kind: 'disconnect' });
  });

  it('copy-paste hand-off when not bound', () => {
    const h = discordAdapter.renderHandoff!({
      doc,
      form: parse(),
      common: { title: 'Hi' },
      content: article,
    });
    expect(h.handoff).toMatchObject({ via: 'copy', openUrl: 'https://discord.com/channels/@me' });
    expect(h.handoff.copyText).toContain(CANONICAL);
  });
});

describe('review fixes', () => {
  it('the copy text is cut before the link, never through the placeholder', async () => {
    const { CANONICAL_PLACEHOLDER } = await import('@starnote/publish-core');
    const r = renderDiscord(
      doc,
      parse({ text: 'y'.repeat(1990) }),
      { title: 'T', summary: 's'.repeat(300) },
      { kind: 'article', doc, canonicalUrl: CANONICAL_PLACEHOLDER }
    );
    expect(r.text.endsWith(CANONICAL_PLACEHOLDER)).toBe(true);
    expect([...r.text].length - CANONICAL_PLACEHOLDER.length + 64).toBeLessThanOrEqual(2000);
  });

  it('webhook URLs: discord / discordapp, canary / ptb, optional API version', () => {
    const tok = 'a'.repeat(68);
    for (const host of [
      'discord.com',
      'discordapp.com',
      'canary.discord.com',
      'ptb.discordapp.com',
    ])
      for (const api of ['/api', '/api/v10'])
        expect(
          discordWebhookForm.safeParse({
            webhook_url: `https://${host}${api}/webhooks/1234567890/${tok}`,
          }).success,
          `${host}${api}`
        ).toBe(true);
    for (const bad of [
      `https://evil.discord.com/api/webhooks/1234567890/${tok}`,
      `https://discord.com/api/webhooks/1234/${tok}`,
      `https://discord.com/api/webhooks/1234567890/${'a'.repeat(129)}`,
      `http://discord.com/api/webhooks/1234567890/${tok}`,
    ])
      expect(discordWebhookForm.safeParse({ webhook_url: bad }).success, bad).toBe(false);
  });
});
