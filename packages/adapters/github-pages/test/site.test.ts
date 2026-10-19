import { describe, expect, it } from 'vitest';

import {
  applySiteSettings,
  createGithubPagesAdapter,
  dnsRecords,
  enforceHttps,
  GITHUB_PAGES_A_RECORDS,
  GITHUB_PAGES_LAYOUT,
  isApexDomain,
  normalizeDomain,
  normalizeMonetize,
  readRepoText,
  setPagesDomain,
  siteConfigText,
} from '../src/index';
import { json, mockFetch } from './helpers';

import { convert, createPublisher } from '@starnote/publish-core';

const R = '/repos/me/me.github.io';
const sample = {
  title: { zh: '辰记示例博客' },
  author: { name: '辰记示例作者', avatar: 'assets/avatar.svg' },
  cname: '',
  starnote: {
    handle: 'demo',
    blog_url: 'https://starnote.app/@demo',
    app_url: 'https://starnote.app',
    api_url: '',
  },
  adsense: {
    client: '',
    slots: { article: '', end: '', rail: '' },
    consent: 'cmp',
    ads_txt_lines: [],
  },
  robots: { ai_search: true },
};
const starnote = {
  handle: 'ludejun',
  blogUrl: 'https://starnote.app/@ludejun',
  appUrl: 'https://starnote.app',
  apiUrl: 'https://starnote.app/api/v1',
  title: '陆的博客',
  authorName: '陆德俊',
};
const monetize = {
  domain: 'Blog.Example.com',
  adsense: { client: 'ca-pub-1234567890123456', slots: { article: '1234567890', end: '' } },
};

describe('site settings', () => {
  it('site.json lives under content/', () => {
    expect(GITHUB_PAGES_LAYOUT.siteConfigFile).toBe('content/site.json');
  });

  it('validates the domain and the AdSense ids', () => {
    expect(normalizeDomain(' https://Blog.Example.com/x ')).toBe('blog.example.com');
    for (const bad of ['', 'localhost', 'me.github.io', 'a..b', '1.2.3.4', 'exa mple.com']) {
      expect(() => normalizeDomain(bad)).toThrow();
    }
    expect(normalizeMonetize(monetize)).toEqual({
      domain: 'blog.example.com',
      adsense: { client: 'ca-pub-1234567890123456', slots: { article: '1234567890' } },
    });
    expect(() =>
      normalizeMonetize({ ...monetize, adsense: { client: 'pub-1234567890123456' } })
    ).toThrow(/ca-pub-/);
    expect(() => normalizeMonetize({ ...monetize, adsense: { client: 'ca-pub-123' } })).toThrow(
      /16/
    );
    expect(() =>
      normalizeMonetize({
        ...monetize,
        adsense: { client: 'ca-pub-1234567890123456', slots: { rail: 'x1' } },
      })
    ).toThrow(/数字/);
  });

  it('DNS: a CNAME for a subdomain, the four GitHub A records for an apex', () => {
    expect(isApexDomain('example.com')).toBe(true);
    expect(isApexDomain('example.com.cn')).toBe(true);
    expect(isApexDomain('blog.example.com')).toBe(false);
    expect(dnsRecords('blog.example.com', 'Me')).toEqual([
      { type: 'CNAME', host: 'blog', value: 'me.github.io' },
    ]);
    expect(dnsRecords('a.b.example.com.cn', 'me')).toEqual([
      { type: 'CNAME', host: 'a.b', value: 'me.github.io' },
    ]);
    expect(dnsRecords('example.com', 'me').map((r) => `${r.type} ${r.host} ${r.value}`)).toEqual(
      GITHUB_PAGES_A_RECORDS.map((ip) => `A @ ${ip}`)
    );
  });

  it('applies 辰记 info (names only on the sample), domain and AdSense; clearing empties them', () => {
    const on = applySiteSettings(sample, { starnote, monetize: normalizeMonetize(monetize) });
    expect(on).toMatchObject({
      title: '陆的博客',
      author: { name: '陆德俊', avatar: 'assets/avatar.svg' },
      cname: 'blog.example.com',
      starnote: {
        handle: 'ludejun',
        blog_url: 'https://starnote.app/@ludejun',
        api_url: 'https://starnote.app/api/v1',
      },
      adsense: {
        client: 'ca-pub-1234567890123456',
        slots: { article: '1234567890', end: '', rail: '' },
        consent: 'cmp',
        ads_txt_lines: [],
      },
      robots: { ai_search: true },
    });
    // a user-edited title is not overwritten later
    const again = applySiteSettings({ ...on, title: '我改过的名字' }, { starnote });
    expect(again.title).toBe('我改过的名字');
    expect(again.cname).toBe('blog.example.com');
    const off = applySiteSettings(on, { monetize: null });
    expect(off.cname).toBe('');
    expect(off.adsense).toEqual({
      client: '',
      slots: { article: '', end: '', rail: '' },
      consent: 'cmp',
      ads_txt_lines: [],
    });
    expect(siteConfigText({ a: [], b: { c: 1 } })).toBe(
      '{\n  "a": [],\n  "b": {\n    "c": 1\n  }\n}\n'
    );
  });

  it('reads a file, sets / clears the Pages domain, enforces HTTPS only with a certificate', async () => {
    const text = '{"title":"标题"}';
    const b64 = Buffer.from(text).toString('base64');
    let pages: Record<string, unknown> = { cname: null, https_certificate: null };
    const { fetch, calls } = mockFetch({
      [`GET ${R}/contents/content/site.json`]: () => json({ content: b64, encoding: 'base64' }),
      [`GET ${R}/contents/missing`]: () => json({ message: 'Not Found' }, 404),
      [`GET ${R}/pages`]: () => json(pages),
      [`PUT ${R}/pages`]: (c) => {
        pages = { ...pages, ...c.body };
        return new Response(null, { status: 204 });
      },
    });
    const gh = { fetch, token: 't', repo: 'me/me.github.io' };
    expect(await readRepoText({ ...gh, path: 'content/site.json', branch: 'main' })).toBe(text);
    expect(calls[0]!.url).toContain('/contents/content/site.json?ref=main');
    expect(await readRepoText({ ...gh, path: 'missing', branch: 'main' })).toBeNull();

    expect(await setPagesDomain({ ...gh, domain: 'blog.example.com' })).toEqual({ changed: true });
    expect(calls.at(-1)!.body).toEqual({ cname: 'blog.example.com' });
    expect(await setPagesDomain({ ...gh, domain: 'blog.example.com' })).toEqual({ changed: false });

    expect((await enforceHttps(gh)).state).toBe('pending');
    pages = { ...pages, https_certificate: { state: 'approved' } };
    expect(await enforceHttps(gh)).toEqual({ state: 'enforced' });
    expect(calls.at(-1)!.body).toEqual({ https_enforced: true });

    expect(await setPagesDomain({ ...gh, domain: null })).toEqual({ changed: true });
    expect(calls.at(-1)!.body).toEqual({ cname: null });
    const broken = mockFetch({ [`GET ${R}/pages`]: () => json({ message: 'nope' }, 403) });
    expect((await enforceHttps({ ...gh, fetch: broken.fetch })).state).toBe('failed');
  });

  it('publish: site.json in the same commit, then the custom domain and the DNS report', async () => {
    const tree: Array<{ path: string; type: string; sha: string }> = [];
    let n = 0;
    const { fetch, calls } = mockFetch({
      [`GET ${R}/git/ref/heads/main`]: () => json({ object: { sha: 'head1' } }),
      [`GET ${R}/git/commits/head1`]: () => json({ tree: { sha: 'tree1' } }),
      [`GET ${R}/git/trees/tree1`]: () => json({ tree }),
      [`GET ${R}/contents/content/site.json`]: () =>
        json({ content: Buffer.from(JSON.stringify(sample)).toString('base64') }),
      [`POST ${R}/git/blobs`]: () => json({ sha: `b${++n}` }, 201),
      [`POST ${R}/git/trees`]: () => json({ sha: 'tree2' }, 201),
      [`POST ${R}/git/commits`]: () => json({ sha: 'commit2' }, 201),
      [`PATCH ${R}/git/refs/heads/main`]: () => json({}),
      [`GET ${R}/pages`]: () => json({ cname: null, https_certificate: null }),
      [`PUT ${R}/pages`]: () => new Response(null, { status: 204 }),
    });
    const adapter = createGithubPagesAdapter({
      runtimes: [{ runtime: 'web', mode: 'api' }],
      token: async () => 'tok',
      site: async () => ({ starnote, monetize: normalizeMonetize(monetize) }),
      now: () => new Date('2026-10-19T08:00:00Z'),
    });
    const publisher = createPublisher({ adapters: [adapter], runtime: 'web', fetch });
    const doc = convert({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }],
    });
    const res = await publisher.publish({
      noteId: 'note-1',
      doc,
      platforms: ['github-pages'],
      common: { title: 'T' },
      perPlatform: { 'github-pages': { repo: 'me/me.github.io', post_id: 'p1' } },
    });
    const r = res.results['github-pages']!;
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://blog.example.com/p1/');
    const treeBody = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!.body;
    expect(treeBody.tree.map((t: { path: string }) => t.path)).toEqual([
      'content/posts/p1/index.zh-CN.html',
      'content/site.json',
    ]);
    expect(calls.find((c) => c.method === 'PUT' && c.url.endsWith('/pages'))!.body).toEqual({
      cname: 'blog.example.com',
    });
    const blobs = calls
      .filter((c) => c.url.endsWith('/git/blobs'))
      .map((c) => c.body.content as string);
    expect(JSON.parse(blobs[1]!)).toMatchObject({
      cname: 'blog.example.com',
      adsense: { client: 'ca-pub-1234567890123456' },
    });
  });
});
