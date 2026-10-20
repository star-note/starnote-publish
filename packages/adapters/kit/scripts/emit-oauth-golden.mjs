/* global console, process, URL */
// Writes the golden relay bodies of the official-API platforms (Blogger, WordPress.com, Tumblr, Reddit, Mastodon,
// Bluesky) for one note — what the SDK renders and the senders (starnote-api `platform_api_publish`, the desktop
// main process `platform-oauth`) must accept against their whitelists.
//
//   pnpm -r --filter './packages/**' run build
//   node packages/adapters/kit/scripts/emit-oauth-golden.mjs ../starnote-api/tests/fixtures/oauth_golden.json
import { writeFileSync } from 'node:fs';

const load = (pkg) => import(new URL(`../../${pkg}/dist/index.js`, import.meta.url));
const { convert } = await import(new URL('../../../core/dist/index.js', import.meta.url));
const blogger = await load('blogger');
const wpcom = await load('wordpress-com');
const tumblr = await load('tumblr');
const reddit = await load('reddit');
const mastodon = await load('mastodon');
const bluesky = await load('bluesky');

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content) => ({ type: 'paragraph', content });
const doc = convert({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('标题 "引号" & <tag>')] },
    { type: 'heading', attrs: { level: 2 }, content: [t('第一节')] },
    p(t('正文 '), t('粗体', [{ type: 'bold' }]), t(' '), t('链接', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }]), t(' 🚀')),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('一'))] }, { type: 'listItem', content: [p(t('二'))] }] },
    { type: 'card', attrs: { variant: 'tip' }, content: [p(t('提示内容'))] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1;\nconsole.log(a);')] },
    { type: 'imageBlock', attrs: { src: '/api/v1/assets/abc123def456.png', caption: '图' } },
    { type: 'divider', attrs: { variant: 'wave' } },
  ],
});
const content = { kind: 'article', doc, canonicalUrl: 'https://starnote.app/@demo/Ab3dE5gH', lang: 'zh-CN' };
const common = { title: '标题 "引号" & <tag>', summary: '一句话摘要', tags: ['TypeScript', 'web dev', '前端'], cover: '/api/v1/assets/cover0000.png' };
const opts = { assetBase: 'https://starnote.app/' };
const form = (a, v = {}) => a.schema.parse(v);

const out = {
  blogger: blogger.renderBlogger(doc, form(blogger.bloggerAdapter, { blog_id: '123' }), common, content, opts).body,
  'wordpress-com': wpcom.renderWordpressCom(doc, form(wpcom.wordpressComAdapter, { site_id: '42', categories: ['技术'] }), common, content, opts).body,
  tumblr: tumblr.renderTumblr(doc, form(tumblr.tumblrAdapter, { blog: 'demo' }), common, content, opts).body,
  'reddit-link': reddit.renderReddit(doc, form(reddit.redditAdapter, { subreddit: 'typescript' }), common, content, opts).body,
  'reddit-self': reddit.renderReddit(doc, form(reddit.redditAdapter, { subreddit: 'typescript', kind: 'self', flair_id: 'abc-1' }), common, content, opts).body,
  mastodon: mastodon.renderMastodon(doc, form(mastodon.mastodonAdapter, { spoiler_text: 'CW' }), common, content).body,
  bluesky: bluesky.renderBluesky(doc, form(bluesky.blueskyAdapter), common, content, { ...opts, now: () => new Date('2026-10-19T00:00:00Z') }).body,
};
const target = process.argv[2];
if (!target) {
  console.log(JSON.stringify(out, null, 2));
} else {
  writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${target}`);
}
