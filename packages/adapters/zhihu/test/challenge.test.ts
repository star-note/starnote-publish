/** 风控与真人化：验证码 / 风控页交给用户，发文闸门告诉用户何时再发。 */
import { CHALLENGE_PROMPT, convert, createPublisher } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { mockPage, mockSession } from '../../../core/test/session-helpers';
import { createZhihuAdapter } from '../src/index';

import type { AccountRef, PublishEvent, Publisher } from '@starnote/publish-core';

const doc = convert({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }],
});
const account: AccountRef = {
  id: 'a1',
  platform: 'zhihu',
  externalUid: 'u',
  displayName: 'me',
  store: 'desktop',
};

function start(sessionFetch: any, page: any, answer = true) {
  const events: PublishEvent[] = [];
  const publisher: Publisher = createPublisher({
    adapters: [createZhihuAdapter({ remoteScript: false })],
    runtime: 'electron',
    sessionFetch,
    ...(page ? { page: async () => page } : {}),
    onEvent: (p, e) => {
      events.push(e);
      // the user finishes the captcha in the window, then confirms
      if (e.type === 'needInput' && answer) queueMicrotask(() => publisher.answer(p, e.id, 'done'));
    },
  });
  return publisher
    .publish({
      noteId: 'n',
      doc,
      platforms: ['zhihu'],
      common: { title: '标题' },
      perPlatform: { zhihu: { mode: 'review' } },
      accounts: { zhihu: account },
    })
    .then((r) => ({ result: r.results.zhihu!, events }));
}

describe('captcha / risk-control pages are handed to the user', () => {
  it('pauses with needInput「请在窗口中完成验证」, shows the platform page, then continues', async () => {
    const { sessionFetch, calls } = mockSession({
      'POST https://zhuanlan.zhihu.com/api/articles/drafts': (_c, n) =>
        n === 1
          ? { status: 403, body: { error: { code: 40362, message: '您当前请求存在异常' } } }
          : { body: { id: 1 } },
      'PATCH https://zhuanlan.zhihu.com/api/articles/1/draft': () => ({ status: 204 }),
    });
    const page = mockPage();
    const { result, events } = await start(sessionFetch, page);
    expect(result).toMatchObject({ ok: true, state: 'handoff' });
    const ask = events.find((e) => e.type === 'needInput');
    expect(ask).toMatchObject({ kind: 'confirm', title: CHALLENGE_PROMPT });
    // the verification page first, then (hand-off) the editor
    expect(page.log.slice(0, 2)).toEqual([
      ['goto', 'https://www.zhihu.com/account/unhuman?type=unhuman&need_login=true'],
      ['show'],
    ]);
    expect(calls.filter((c) => c.url.endsWith('/drafts'))).toHaveLength(2);
    // nothing tries to solve it: no extra requests between the two attempts
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'PATCH']);
  });

  it('without a window to show, stops with a help action instead of guessing', async () => {
    const { sessionFetch } = mockSession({
      'POST https://zhuanlan.zhihu.com/api/articles/drafts': () => ({
        status: 403,
        body: { error: { code: 40362 } },
      }),
    });
    const { result, events } = await start(sessionFetch, null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('验证');
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'platform_error' });
  });
});

describe('post gate (minimum interval / daily cap)', () => {
  it('turns the desktop gate into a retry with the time to wait', async () => {
    const { sessionFetch } = mockSession({
      'POST https://zhuanlan.zhihu.com/api/articles/drafts': () => ({
        status: 429,
        headers: { 'x-starnote-gate': 'daily', 'retry-after': '14400' },
        body: {
          starnote_gate: {
            reason: 'daily',
            retryAfterSec: 14400,
            text: '24 小时内已在知乎发了 5 篇，达到上限 5 篇',
          },
        },
      }),
    });
    const { result, events } = await start(sessionFetch, mockPage());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('达到上限 5 篇');
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      code: 'rate_limited',
      actions: [{ kind: 'retry', label: '4 小时后重试' }],
    });
  });
});
