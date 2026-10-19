import { describe, expect, it } from 'vitest';

import {
  ASSET_BASE,
  CANONICAL,
  fixtureDoc,
  json,
  mockFetch,
  runPublish,
} from '../../kit/test/helpers';
import { redditAdapter, renderReddit } from '../src/index';

describe('renderReddit', () => {
  const doc = fixtureDoc();
  const content = { kind: 'article' as const, doc, canonicalUrl: CANONICAL };

  it('link post to the 辰记 original by default', () => {
    const r = renderReddit(
      doc,
      redditAdapter.schema.parse({ subreddit: 'r/typescript' }),
      { title: 'Hello Title' },
      content
    );
    expect(r.body).toEqual({
      sr: 'typescript',
      kind: 'link',
      title: 'Hello Title',
      url: CANONICAL,
      sendreplies: true,
    });
    expect(r.report.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['link.post', 'subreddit.rules'])
    );
  });

  it('text post: Reddit Markdown with the link at the end, flair and flags', () => {
    const r = renderReddit(
      doc,
      redditAdapter.schema.parse({
        subreddit: 'typescript',
        kind: 'self',
        nsfw: true,
        flair_id: 'abc-1',
        flair_text: 'Tutorial',
      }),
      { title: 'Hello Title' },
      content,
      { assetBase: ASSET_BASE }
    );
    expect(r.body.kind).toBe('self');
    expect(r.body.text).toContain('```ts');
    expect(r.body.text).toContain('$e^{i\\pi}+1=0$');
    expect(r.body.text!.endsWith(`*Originally published at [${CANONICAL}](${CANONICAL})*`)).toBe(
      true
    );
    expect(r.body).toMatchObject({ nsfw: true, flair_id: 'abc-1', flair_text: 'Tutorial' });
    expect(r.body.url).toBeUndefined();
  });

  it('cuts long titles to 300 and needs a link for link posts', () => {
    const long = 'x'.repeat(400);
    const r = renderReddit(
      doc,
      redditAdapter.schema.parse({ subreddit: 'abc' }),
      { title: long },
      content
    );
    expect([...r.title]).toHaveLength(300);
    expect(() =>
      renderReddit(
        doc,
        redditAdapter.schema.parse({ subreddit: 'abc' }),
        {},
        { kind: 'article', doc }
      )
    ).toThrow(/链接/);
  });

  it('rejects bad subreddit names', () => {
    expect(redditAdapter.schema.safeParse({ subreddit: 'a b' }).success).toBe(false);
  });
});

describe('reddit adapter', () => {
  it('relays the submit body; a link post cannot be updated', async () => {
    const { fetch, calls } = mockFetch({
      'POST /api/v1/notes/note-1/publish/reddit': () =>
        json({
          code: 0,
          data: { url: 'https://www.reddit.com/r/abc/comments/x1/hello/', external_id: 'x1' },
          message: 'ok',
        }),
    });
    const { result } = await runPublish(
      redditAdapter,
      { form: { subreddit: 'abc' } },
      { runtime: 'electron', fetch }
    );
    expect(result).toMatchObject({ ok: true, externalId: 'x1' });
    expect(calls[0]!.body.body).toMatchObject({ sr: 'abc', kind: 'link' });
    const again = await runPublish(
      redditAdapter,
      {
        form: { subreddit: 'abc' },
        previous: { reddit: { platform: 'reddit', externalId: 'x1', url: '' } },
      },
      { runtime: 'electron', fetch }
    );
    expect(again.terminal[0]).toMatchObject({ type: 'failed', code: 'invalid' });
    expect(calls).toHaveLength(1);
    expect(redditAdapter.runtime).toEqual(['electron', 'web', 'server']);
  });
});
