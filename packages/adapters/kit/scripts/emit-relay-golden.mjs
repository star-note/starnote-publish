/* global console, process, URL */
// Writes the relay golden file for starnote-api (`tests/fixtures/relay_golden.json`): for one note, the request
// body each platform's SDK renderer produces (what the browser posts to `POST /notes/{id}/publish/{platform}`)
// and its exact JSON text. The API test forwards these bodies and checks the bytes it sends to the platform.
//
//   pnpm -r --filter './packages/**' run build
//   node packages/adapters/kit/scripts/emit-relay-golden.mjs ../starnote-api/tests/fixtures/relay_golden.json
import { writeFileSync } from 'node:fs';

const load = (pkg) => import(new URL(`../../${pkg}/dist/index.js`, import.meta.url));
const { convert } = await import(new URL('../../../core/dist/index.js', import.meta.url));
const devto = await load('devto');
const hashnode = await load('hashnode');
const ghost = await load('ghost');
const wordpress = await load('wordpress');
// SPEC-r14 A1
const a1 = {
  convertkit: await load('convertkit'),
  beehiiv: await load('beehiiv'),
  buttondown: await load('buttondown'),
  hatena: await load('hatena'),
  qiita: await load('qiita'),
  zenn: await load('zenn'),
  telegraph: await load('telegraph'),
};

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content) => ({ type: 'paragraph', content });
const json = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('标题 "引号" & <tag>')] },
    { type: 'heading', attrs: { level: 2, variant: 'pill' }, content: [t('第一节')] },
    p(
      t('正文，含 '),
      t('链接', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }]),
      t(' 和 emoji 🚀。')
    ),
    { type: 'card', attrs: { variant: 'tip' }, content: [p(t('提示内容'))] },
    { type: 'divider', attrs: { variant: 'wave' } },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [t('const a = "x";\n\tconsole.log(a);')],
    },
    {
      type: 'imageBlock',
      attrs: { src: 'https://starnote.app/api/v1/assets/abc123def456.png', caption: '图' },
    },
    p(t('公式 '), { type: 'katex', attrs: { text: 'a^2+b^2=c^2' } }),
    { type: 'iframe', attrs: { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } },
  ],
};
const doc = convert(json);
const content = {
  kind: 'article',
  doc,
  canonicalUrl: 'https://starnote.app/@me/8Kq2xA7b',
  shortId: '8Kq2xA7b',
};
const common = {
  title: '标题 "引号" & <tag>',
  summary: '一句话摘要 第二行',
  tags: ['TypeScript', 'Web Dev', '写作'],
  cover: 'https://starnote.app/api/v1/assets/cover0000001.png',
};

function entry(body) {
  return { body, bytes: JSON.stringify(body) };
}

const d = devto.renderDevto(doc, devto.devtoSchema.parse({}), common, content);
const h = hashnode.renderHashnode(
  doc,
  hashnode.hashnodeSchema.parse({ enable_toc: true }),
  common,
  content
);
const gForm = ghost.ghostSchema.parse({});
const g = ghost.renderGhost(doc, gForm, common, content);
const wForm = wordpress.wordpressSchema.parse({});
const w = wordpress.renderWordpress(doc, wForm, common, content);

const golden = {
  generator: '@starnote/publish-kit scripts/emit-relay-golden.mjs',
  devto: entry(devto.devtoRelayBody(d)),
  hashnode: entry(
    hashnode.hashnodeRelayBody(h, hashnode.hashnodeSchema.parse({ enable_toc: true }))
  ),
  ghost: entry(ghost.ghostRelayBody(g, gForm)),
  wordpress: entry(wordpress.wordpressRelayBody(w, wForm)),
};
// SPEC-r14 A1: each platform's default form
const cap = (k) => k[0].toUpperCase() + k.slice(1);
for (const [key, mod] of Object.entries(a1)) {
  const form = mod[`${key}Schema`].parse({});
  const r = mod[`render${cap(key)}`](doc, form, common, content);
  golden[key] = entry(mod[`${key}RelayBody`](r));
}

const out = process.argv[2];
const text = `${JSON.stringify(golden, null, 2)}\n`;
if (out) {
  writeFileSync(out, text);
  console.log(`relay golden → ${out}`);
} else {
  process.stdout.write(text);
}
