import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import {
  createTelegramAdapter,
  renderTelegram,
  telegramAdapter,
  telegramPostUrl,
  telegramTokenForm,
} from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => telegramAdapter.schema.parse(v);

describe('renderTelegram', () => {
  it('a text message with the link preview: bold title, escaped summary, topics, link', () => {
    const r = renderTelegram(
      doc,
      parse(),
      { title: 'A <b> & C', summary: 'One line', tags: ['Type Script', 'AI'] },
      article
    );
    expect(r.body).toEqual({
      method: 'sendMessage',
      text: `<b>A &lt;b&gt; &amp; C</b>\n\nOne line\n\n#TypeScript #AI\n\n${CANONICAL}`,
      parse_mode: 'HTML',
      link_preview_options: { url: CANONICAL, prefer_large_media: true },
    });
    expect(r.text).toBe(`A <b> & C\n\nOne line\n\n#TypeScript #AI\n\n${CANONICAL}`);
  });

  it('a photo message with the cover; caption fitted to 1024', () => {
    const r = renderTelegram(
      doc,
      parse({ silent: true }),
      { title: 'T', summary: 'x'.repeat(3000), cover: '/c.png' },
      article,
      { assetBase: ASSET_BASE }
    );
    expect(r.body).toMatchObject({
      method: 'sendPhoto',
      photo: 'https://starnote.app/c.png',
      disable_notification: true,
    });
    expect([...r.text].length).toBeLessThanOrEqual(1024);
    expect(r.report.map((i) => i.kind)).toContain('share.truncated');
  });

  it('validates the binding form and builds channel links', () => {
    expect(
      telegramTokenForm.safeParse({
        bot_token: '123456789:' + 'A'.repeat(35),
        chat_id: '@my_channel',
      }).success
    ).toBe(true);
    expect(telegramTokenForm.safeParse({ bot_token: 'nope', chat_id: 'x' }).success).toBe(false);
    expect(telegramPostUrl({ username: '@chan' }, 5)).toBe('https://t.me/chan/5');
    expect(telegramPostUrl({}, 5)).toBeNull();
  });
});

describe('telegram adapter', () => {
  it('relays the body with the account; new message on update; preview = publish', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/telegram': () =>
        json({ code: 0, data: { url: 'https://t.me/chan/9', external_id: '@chan:9' } }),
    });
    const account = {
      id: 'acc1',
      platform: 'telegram',
      externalUid: '1:@chan',
      displayName: 'chan',
      store: 'server' as const,
    };
    const { result, terminal } = await runPublish(
      telegramAdapter,
      {
        accounts: { telegram: account },
        previous: { telegram: { platform: 'telegram', externalId: '@chan:1' } },
      },
      { runtime: 'web', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: '@chan:9' });
    expect(calls[0]!.body.account_id).toBe('acc1');
    expect(calls[0]!.body.previous).toBeUndefined();
    expect(calls[0]!.body.body).toEqual(
      renderTelegram(
        doc,
        parse(),
        { title: 'Hello Title', tags: ['TypeScript', 'web dev'] },
        article
      ).body
    );
    expect((terminal[0] as any).report.map((i: any) => i.kind)).toContain('update.unsupported');
  });

  it('maps the relay error to its kind', async () => {
    const { fetch } = mockFetch({
      'POST /api/v1/notes/note-1/publish/telegram': () =>
        json(
          {
            code: 50201,
            message: 'bot was kicked',
            data: { error_code: 'forbidden', error_kind: 'disconnect' },
          },
          400
        ),
    });
    const { result, terminal } = await runPublish(telegramAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: false, kind: 'disconnect' });
    expect(terminal[0]).toMatchObject({ type: 'failed', kind: 'disconnect' });
  });

  it('falls back to t.me/share/url when not bound', () => {
    const a = createTelegramAdapter();
    const h = a.renderHandoff!({ doc, form: parse(), common: { title: 'T' }, content: article });
    expect(h.handoff.openUrl.startsWith('https://t.me/share/url?')).toBe(true);
    expect(
      a.renderRequest!({ doc, form: parse(), common: {}, content: article }).body
    ).toMatchObject({
      method: 'sendMessage',
    });
    expect(a.runtime).toEqual(['web', 'electron', 'server']);
  });
});
