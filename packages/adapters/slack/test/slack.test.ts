import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { renderSlack, slackAdapter, slackEscape, slackWebhookForm } from '../src/index';

const doc = fixtureDoc();
const article = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };
const parse = (v: unknown = {}) => slackAdapter.schema.parse(v);

describe('renderSlack', () => {
  it('a section with the linked title, summary and the cover as accessory', () => {
    const r = renderSlack(
      doc,
      parse(),
      { title: 'A & <B>', summary: 'Sum', cover: '/c.png' },
      article,
      { assetBase: ASSET_BASE }
    );
    expect(r.body.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*<${CANONICAL}|A &amp; &lt;B&gt;>*\nSum` },
        accessory: { type: 'image', image_url: 'https://starnote.app/c.png', alt_text: 'A & <B>' },
      },
    ]);
    expect(r.body).toMatchObject({ text: `A & <B> ${CANONICAL}`, unfurl_links: false });
    expect(r.report.map((i) => i.kind)).toContain('link.unavailable');
    expect(slackEscape('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('validates the webhook and asks for a name', () => {
    // assembled so secret scanners do not take the fake webhook for a real one
    const url = ['https://hooks.slack.com/services', 'T0001ABCD', 'B0002EFGH', 'x'.repeat(24)].join('/');
    expect(slackWebhookForm.safeParse({ webhook_url: url, label: '#公告' }).success).toBe(true);
    expect(slackWebhookForm.safeParse({ webhook_url: url, label: '' }).success).toBe(false);
    expect(
      slackWebhookForm.safeParse({ webhook_url: 'https://example.com/services/a/b/c', label: 'x' })
        .success
    ).toBe(false);
  });
});

describe('slack adapter', () => {
  it('relays; the empty url is fine; copy hand-off when not bound', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/slack': () =>
        json({ code: 0, data: { url: '', external_id: 'abcd1234abcd1234' } }),
    });
    const { result } = await runPublish(slackAdapter, {}, { runtime: 'web', fetch });
    expect(result).toMatchObject({ ok: true, url: '', externalId: 'abcd1234abcd1234' });
    expect(calls[0]!.body.body.blocks).toHaveLength(1);
    const h = slackAdapter.renderHandoff!({ doc, form: parse(), common: {}, content: article });
    expect(h.handoff.via).toBe('copy');
  });
});

describe('review fixes', () => {
  it('the notification text and the card keep the placeholder whole', async () => {
    const { CANONICAL_PLACEHOLDER } = await import('@starnote/publish-core');
    const r = renderSlack(
      doc,
      parse({ text: 'y'.repeat(2990) }),
      { title: 'T'.repeat(400), summary: '<&>'.repeat(200) },
      { kind: 'article', doc, canonicalUrl: CANONICAL_PLACEHOLDER }
    );
    expect(r.body.text.endsWith(` ${CANONICAL_PLACEHOLDER}`)).toBe(true);
    expect([...r.body.text].length - CANONICAL_PLACEHOLDER.length + 64).toBeLessThanOrEqual(3000);
    const card = r.body.blocks.at(-1) as { text: { text: string } };
    expect(card.text.text).toContain(`<${CANONICAL_PLACEHOLDER}|`);
    expect([...card.text.text].length - CANONICAL_PLACEHOLDER.length + 64).toBeLessThanOrEqual(
      3000
    );
  });

  it('webhook URL rule', () => {
    const ok = (u: string) => slackWebhookForm.safeParse({ webhook_url: u, label: 'x' }).success;
    expect(ok('https://hooks.slack.com/services/T0001ABCD/B0002EFGH/abcdefgh')).toBe(true);
    expect(ok('https://hooks.slack.com/services/T0001/B0002EFGH/abcdefgh')).toBe(false);
    expect(ok('https://hooks.slack.com/services/t0001abcd/B0002EFGH/abcdefgh')).toBe(false);
    expect(ok(`https://hooks.slack.com/services/T0001ABCD/B0002EFGH/${'a'.repeat(65)}`)).toBe(
      false
    );
  });
});
