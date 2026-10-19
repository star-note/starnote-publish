/* global console, process, URL */
// Writes starnote-api's `tests/fixtures/github_pages_golden.json` from the browser entry (`renderPost`,
// `applySiteSettings`): the Python twin (`app/services/github_publish.py`, which does the server-side publish)
// must produce the same bytes for the same input — see `test_render_and_site_match_the_sdk`.
//
//   pnpm -r --filter './packages/**' run build
//   node packages/adapters/github-pages/scripts/emit-golden.mjs ../starnote-api/tests/fixtures/github_pages_golden.json
import { writeFileSync } from 'node:fs';

const gp = await import(new URL('../dist/index.js', import.meta.url));

const doc = (d) => ({
  json: { type: 'doc' },
  portableHtml: d.html,
  markdown: '',
  text: '',
  images: [],
  ...d,
});
const post = gp.renderPost({
  noteId: '2F1C-ab90-xyz',
  doc: doc({
    title: '标题 "引号"',
    html: '<h2 id="h-0-a">A</h2><p>正文 <img src="https://x.test/a.png?x=1&amp;y=2"></p>',
    toc: [{ id: 'h-0-a', level: 2, text: 'A' }],
    summary: '摘要：冒号 # 井号',
  }),
  form: gp.githubPagesSchema.parse({ repo: 'Me/blog' }),
  common: { title: '覆盖标题', tags: ['AI', '写作'], cover: 'https://x.test/a.png?x=1&y=2' },
  translations: { en: doc({ title: 'Title', html: '<p>Body</p>', toc: [], summary: '' }) },
  canonicalUrl: 'https://starnote.app/@me/8Kq2xA7b',
  starnoteId: '8Kq2xA7b',
  category: { slug: 'tech', name: '技术' },
  publishedAt: '2026-10-18T02:00:00.000Z',
  assets: new Map([['https://x.test/a.png?x=1&y=2', 'assets/abc.png']]),
  now: new Date('2026-10-19T08:00:00Z'),
});
const site = gp.siteConfigText(
  gp.applySiteSettings(
    { title: 'x', starnote: { handle: 'demo' }, adsense: { consent: 'banner' } },
    {
      starnote: { handle: 'me', blogUrl: 'b', appUrl: 'a', apiUrl: 'p', title: 'T' },
      monetize: gp.normalizeMonetize({
        domain: 'example.com',
        adsense: { client: 'ca-pub-1234567890123456', slots: { end: '123456' } },
      }),
    }
  )
);
const text = `${JSON.stringify({ post, site }, null, 2)}\n`;
if (process.argv[2]) {
  writeFileSync(process.argv[2], text);
  console.log(`github-pages golden → ${process.argv[2]}`);
} else process.stdout.write(text);
