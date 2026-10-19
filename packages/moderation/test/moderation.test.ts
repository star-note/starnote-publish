import { describe, expect, it } from 'vitest';

import { builtinWords, CATEGORIES, createMasker, maskHtml, maskText } from '../src/index';

// Custom words keep the tests independent of the bundled lexicon.
const ONLY = { words: ['敏感词', '违禁品', 'badword'] };

describe('maskText', () => {
  it('replaces hits with ** by default and reports them', () => {
    const r = maskText('这里有敏感词，还有违禁品。', ONLY);
    expect(r.text).toBe('这里有**，还有**。');
    expect(r.hits).toEqual([
      { word: '敏感词', text: '敏感词', index: 3 },
      { word: '违禁品', text: '违禁品', index: 9 },
    ]);
  });

  it('length mode masks with equal-length *', () => {
    expect(maskText('含敏感词的句子', { ...ONLY, mode: 'length' }).text).toBe('含***的句子');
    expect(maskText('含敏感词', { ...ONLY, mode: 'length', maskChar: '×' }).text).toBe('含×××');
  });

  it('no hits leaves text untouched', () => {
    const r = maskText('一段正常的文字', ONLY);
    expect(r).toEqual({ text: '一段正常的文字', hits: [] });
  });

  it('empty dictionary is allowed', () => {
    const m = createMasker({ words: [] });
    expect(m.size).toBe(0);
    expect(m.maskText('敏感词').text).toBe('敏感词');
  });

  it('extra words carry a category; longest match wins', () => {
    const r = maskText('甲乙丙丁', {
      words: ['甲乙'],
      extraWords: [{ word: '甲乙丙', category: 'brand' }],
    });
    expect(r.text).toBe('**丁');
    expect(r.hits[0]).toMatchObject({ word: '甲乙丙', category: 'brand' });
  });

  it('ASCII words need word boundaries', () => {
    expect(maskText('a badword here', ONLY).text).toBe('a ** here');
    expect(maskText('notbadwordy', ONLY).text).toBe('notbadwordy');
    expect(maskText('中文badword中文', ONLY).text).toBe('中文**中文');
  });

  it('preview wraps hits in <mark> and escapes the rest', () => {
    const r = maskText('<b>敏感词</b>', { ...ONLY, preview: true });
    expect(r.text).toBe('&lt;b&gt;<mark class="sn-masked" title="已自动打码">**</mark>&lt;/b&gt;');
  });
});

describe('normalization', () => {
  it('full-width and case', () => {
    expect(maskText('ＢａｄＷｏｒｄ!', ONLY).text).toBe('**!');
    expect(maskText('BADWORD', ONLY).text).toBe('**');
  });

  it('spaces and symbols inside a word', () => {
    const r = maskText('看看 敏 感-词 吧，敏*感*词', ONLY);
    expect(r.text).toBe('看看 ** 吧，**');
    expect(r.hits.map((h) => h.text)).toEqual(['敏 感-词', '敏*感*词']);
    expect(maskText('敏\u200b感\u200b词', ONLY).text).toBe('**');
  });

  it('can be switched off', () => {
    expect(maskText('敏 感 词', { ...ONLY, normalize: { symbols: false } }).text).toBe('敏 感 词');
    expect(maskText('BADWORD', { ...ONLY, normalize: { case: false } }).text).toBe('BADWORD');
    expect(maskText('ｂａｄｗｏｒｄ', { ...ONLY, normalize: false }).text).toBe('ｂａｄｗｏｒｄ');
  });

  it('does not bridge long runs of symbols, structural punctuation or ASCII/CJK spacing', () => {
    expect(maskText('敏.....感词', ONLY).text).toBe('敏.....感词');
    expect(maskText('敏、感、词', ONLY).text).toBe('敏、感、词');
    expect(maskText('| 敏 | 感词 |', ONLY).text).toBe('| 敏 | 感词 |');
    expect(maskText('敏\n感词', ONLY).text).toBe('敏\n感词');
    expect(maskText('svg 点', { words: ['g点'] }).text).toBe('svg 点');
    expect(maskText('svg点', { words: ['g点'] }).text).toBe('svg点');
    expect(maskText('看g点', { words: ['g点'] }).text).toBe('看**');
  });
});

describe('whitelist', () => {
  it('removes a word from the dictionary', () => {
    expect(maskText('敏感词', { ...ONLY, whitelist: ['敏感词'] }).text).toBe('敏感词');
  });

  it('protects a longer phrase that contains a word', () => {
    const r = maskText('讨论敏感词库的设计，但敏感词要打码', { ...ONLY, whitelist: ['敏感词库'] });
    expect(r.text).toBe('讨论敏感词库的设计，但**要打码');
  });
});

describe('maskHtml', () => {
  const html =
    '<p class="敏感词" data-x="违禁品">正文敏感词<a href="/敏感词" title="违禁品">链接违禁品</a></p>' +
    '<pre><code>敏感词</code></pre><p>行内 <code>违禁品</code> 和 &lt;敏感词&gt;</p>' +
    '<!-- 敏感词 --><script>var a="敏感词"</script><style>.敏感词{}</style>';

  it('masks only text nodes and keeps tags, attributes, comments byte-for-byte', () => {
    const r = maskHtml(html, ONLY);
    expect(r.html).toBe(
      '<p class="敏感词" data-x="违禁品">正文**<a href="/敏感词" title="违禁品">链接**</a></p>' +
        '<pre><code>敏感词</code></pre><p>行内 <code>违禁品</code> 和 &lt;**&gt;</p>' +
        '<!-- 敏感词 --><script>var a="敏感词"</script><style>.敏感词{}</style>'
    );
    expect(r.hits).toHaveLength(3);
    expect(html.slice(r.hits[0]!.index, r.hits[0]!.index + 3)).toBe('敏感词');
  });

  it('decodes entities for matching', () => {
    expect(maskHtml('<p>&#25935;感词 &amp; 敏&nbsp;感词</p>', ONLY).html).toBe(
      '<p>** &amp; **</p>'
    );
  });

  it('preview output marks hits; publish output has only **', () => {
    const preview = maskHtml('<p>敏感词</p>', { ...ONLY, preview: true }).html;
    expect(preview).toBe('<p><mark class="sn-masked" title="已自动打码">**</mark></p>');
    const publish = maskHtml('<p>敏感词</p>', ONLY).html;
    expect(publish).toBe('<p>**</p>');
    expect(publish).not.toContain('mark');
  });

  it('handles > inside attribute values and unclosed markup', () => {
    expect(maskHtml('<img alt="a>b 敏感词">敏感词<p>违禁品', ONLY).html).toBe(
      '<img alt="a>b 敏感词">**<p>**'
    );
  });
});

describe('bundled lexicon', () => {
  it('has a few thousand default words in categories', () => {
    const m = createMasker();
    expect(m.size).toBeGreaterThan(2000);
    expect(CATEGORIES.find((c) => c.id === 'porn')?.default).toBe(true);
    expect(CATEGORIES.find((c) => c.id === 'ad')?.default).toBe(false);
  });

  it('masks a built-in word with its category', () => {
    const w = builtinWords('violence').find((x) => /^[一-鿿]{3,}$/.test(x))!;
    const r = maskText(`前文${w}后文`);
    expect(r.text).toBe('前文**后文');
    expect(r.hits[0]?.category).toBe('violence');
  });

  it('leaves ordinary prose alone', () => {
    const prose =
      '今天在北京参加了一个技术分享会，讨论了网络招聘、写真集排版和高潮迭起的剧情设计。';
    expect(maskText(prose).hits).toEqual([]);
  });
});
