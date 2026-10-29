import { adapterSchema, zodFieldMeta } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import { chenjiAdapter } from '../src/index';

describe('辰记 i18n (SPEC-r14 B5)', () => {
  it('form labels and messages follow the language', () => {
    expect(
      zodFieldMeta(adapterSchema(chenjiAdapter, 'en')).find((f) => f.name === 'category')
        ?.description
    ).toBe('Category');
    const r = adapterSchema(chenjiAdapter, 'zh-TW').safeParse({ category: { name: '' } });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('請輸入分類名稱');
  });

  it('progress follows ctx.lang', async () => {
    const texts: string[] = [];
    await chenjiAdapter.publish({
      doc: {
        json: { type: 'doc' },
        html: '',
        portableHtml: '',
        markdown: '',
        text: '',
        title: 't',
        summary: '',
        toc: [],
        images: [],
        links: [],
      } as never,
      form: { category: { id: '1' }, visibility: 'public', show_in_blog: true },
      common: {},
      ctx: {
        lang: 'en',
        emit: (e) => {
          if (e.type === 'progress' && e.text) texts.push(e.text);
        },
        needInput: async () => '',
        fetch: (async () =>
          new Response(
            JSON.stringify({ code: 0, message: 'ok', data: { id: 'p', url: 'u' } })
          )) as typeof fetch,
        signal: new AbortController().signal,
        runtime: 'web',
        noteId: 'n',
        apiBase: '/api/v1',
      },
    });
    expect(texts).toEqual(['Converting the article', 'Uploading to StarNote', 'Published']);
  });
});
