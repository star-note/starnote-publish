/**
 * Dev-time generator for @starnote/platform-logos (not part of `pnpm build`; the outputs are committed).
 *
 *   node --experimental-strip-types packages/logos/scripts/build-logos.mts \
 *     --si   <dir of the unpacked simple-icons npm package> \
 *     --official <download root>[,<download root>...]   # each has <key>/manifest.json + cand-* files
 *     --own  <path to the StarNote mark SVG> \
 *     --sharp <path to an installed sharp package (e.g. starnote-web/node_modules/sharp)>
 *
 * Every downloaded file is untrusted: SVGs go through `sanitizeSvg` (allow-list), bitmaps (PNG / ICO)
 * are decoded and re-encoded by sharp to 64×64 and 128×128 PNG. Nothing downloaded is executed.
 * Writes: assets/*, src/generated.ts, SOURCES.md.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORMS } from '../../core/src/platforms.ts';
import { looksDangerous, sanitizeSvg } from '../src/sanitize.ts';
import { placeholderSvg } from '../src/placeholder.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const SI = args.get('si')!;
const OFFICIAL = (args.get('official') ?? '').split(',').filter(Boolean);
const OWN = args.get('own')!;
const sharp = createRequire(import.meta.url)(resolve(args.get('sharp')!)) as any; // sharp is resolved from another project (dev-time only)
const TODAY = new Date().toISOString().slice(0, 10);

/** Registry key → simple-icons slug. */
const SIMPLE: Record<string, string> = {
  wechat: 'wechat',
  zhihu: 'zhihu',
  juejin: 'juejin',
  csdn: 'csdn',
  xiaohongshu: 'xiaohongshu',
  // 长文、头条文章、抖音文章是同一品牌的另一个发布对象，用同一个图形。
  'xiaohongshu-article': 'xiaohongshu',
  weibo: 'sinaweibo',
  'weibo-article': 'sinaweibo',
  bilibili: 'bilibili',
  // 抖音与 TikTok 同一图形（字节跳动同一品牌标识）。
  douyin: 'tiktok',
  'douyin-article': 'tiktok',
  kuaishou: 'kuaishou',
  // simple-icons 的 githubpages 是文字标，小尺寸不可读；用 GitHub 图形。
  'github-pages': 'github',
  medium: 'medium',
  substack: 'substack',
  ghost: 'ghost',
  wordpress: 'wordpress',
  // WordPress.com 与自建 WordPress 同一品牌图形。
  'wordpress-com': 'wordpress',
  devto: 'devdotto',
  hashnode: 'hashnode',
  blogger: 'blogger',
  x: 'x',
  facebook: 'facebook',
  threads: 'threads',
  reddit: 'reddit',
  telegram: 'telegram',
  discord: 'discord',
  slack: 'slack',
  quora: 'quora',
  patreon: 'patreon',
  buymeacoffee: 'buymeacoffee',
  pinterest: 'pinterest',
  youtube: 'youtube',
  instagram: 'instagram',
  bluesky: 'bluesky',
  mastodon: 'mastodon',
  tumblr: 'tumblr',
};

/**
 * Hand-picked official candidates (path suffix under a download root), after reviewing a contact sheet:
 * yuque 的 SVG 带滤镜阴影、裁切异常；newsbreak 的 favicon.ico 是框架默认三角；
 * baijiahao 的 author.baidu.com 跳转到了百度主站 favicon（不是百家号）。
 */
const PICK: Record<string, string> = {
  yuque: 'yuque/cand-1.png',
  newsbreak: 'newsbreak/cand-4.png',
  baijiahao: 'official/baijiahao/cand-0.ico',
};

const LICENSE_SI = 'CC0-1.0（simple-icons）；品牌商标归其所有者，仅用于指示平台';
const LICENSE_OFFICIAL = '品牌商标，仅用于指示平台';
const LICENSE_OWN = '辰记自有品牌';
const LICENSE_PLACEHOLDER = '占位（辰记生成）';

type Origin = 'simple-icons' | 'official' | 'own' | 'placeholder';
interface Out {
  key: string;
  kind: 'svg' | 'png';
  file: string;
  file64?: string;
  color: string;
  source: string;
  license: string;
  origin: Origin;
  fetchedAt: string;
  note?: string;
}

/* ---------------- ICO decoding (PNG entries and 32/24/8/4/1-bit DIB entries) ---------------- */

function decodeIco(
  buf: Buffer
): { png?: Buffer; raw?: { data: Buffer; width: number; height: number } } | null {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  let best: { w: number; bpp: number; size: number; off: number } | null = null;
  for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i++) {
    const e = 6 + i * 16;
    const w = buf[e] || 256;
    const bpp = buf.readUInt16LE(e + 6);
    const size = buf.readUInt32LE(e + 8);
    const off = buf.readUInt32LE(e + 12);
    if (off + size > buf.length) continue;
    if (!best || w > best.w || (w === best.w && bpp > best.bpp)) best = { w, bpp, size, off };
  }
  if (!best) return null;
  const img = buf.subarray(best.off, best.off + best.size);
  if (img.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { png: img };
  return { raw: decodeDib(img) };
}

function decodeDib(d: Buffer): { data: Buffer; width: number; height: number } {
  const hs = d.readUInt32LE(0);
  const width = d.readInt32LE(4);
  const height = Math.abs(d.readInt32LE(8)) / 2;
  const bpp = d.readUInt16LE(14);
  if (width <= 0 || width > 512 || height <= 0 || height > 512) throw new Error('bad DIB size');
  let colors = d.readUInt32LE(32);
  if (bpp <= 8 && !colors) colors = 1 << bpp;
  const palOff = hs;
  const xorOff = palOff + (bpp <= 8 ? colors * 4 : 0);
  const xorStride = Math.ceil((width * bpp) / 32) * 4;
  const andOff = xorOff + xorStride * height;
  const andStride = Math.ceil(width / 32) * 4;
  const out = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = xorOff + (height - 1 - y) * xorStride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r = 0,
        g = 0,
        b = 0,
        a = 255;
      if (bpp === 32) {
        b = d[row + x * 4]!;
        g = d[row + x * 4 + 1]!;
        r = d[row + x * 4 + 2]!;
        a = d[row + x * 4 + 3]!;
        if (a) anyAlpha = true;
      } else if (bpp === 24) {
        b = d[row + x * 3]!;
        g = d[row + x * 3 + 1]!;
        r = d[row + x * 3 + 2]!;
      } else if (bpp <= 8) {
        const bitPos = x * bpp;
        const byte = d[row + (bitPos >> 3)]!;
        const idx = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        const p = palOff + idx * 4;
        b = d[p]!;
        g = d[p + 1]!;
        r = d[p + 2]!;
      } else throw new Error(`unsupported bpp ${bpp}`);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  // AND mask gives transparency when there is no alpha channel.
  if (bpp !== 32 || !anyAlpha) {
    for (let y = 0; y < height; y++) {
      const row = andOff + (height - 1 - y) * andStride;
      for (let x = 0; x < width; x++) {
        const bit = row + (x >> 3) < d.length ? (d[row + (x >> 3)]! >> (7 - (x & 7))) & 1 : 0;
        out[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  }
  return { data: out, width, height };
}

/* ---------------- candidates ---------------- */

interface Cand {
  file: string;
  url: string;
  fetchedAt: string;
  kind: 'svg' | 'raster';
  size: number;
}

async function candidates(key: string): Promise<Cand[]> {
  const list: Cand[] = [];
  for (const root of OFFICIAL) {
    const dir = join(root, key);
    if (!existsSync(join(dir, 'manifest.json'))) continue;
    const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    for (const f of man.files as Array<{ file?: string; final?: string; url: string }>) {
      if (!f.file) continue;
      const path = join(dir, f.file);
      const buf = readFileSync(path);
      const head = buf.subarray(0, 512).toString('utf8');
      if (/<svg[\s>]/i.test(head) || /\.svg$/.test(f.file)) {
        list.push({
          file: path,
          url: f.final ?? f.url,
          fetchedAt: man.fetchedAt,
          kind: 'svg',
          size: 1e6,
        });
        continue;
      }
      try {
        const r = await rasterInput(buf);
        const meta = await sharp(r.input, r.opts).metadata();
        list.push({
          file: path,
          url: f.final ?? f.url,
          fetchedAt: man.fetchedAt,
          kind: 'raster',
          size: Math.min(meta.width!, meta.height!),
        });
      } catch {
        /* not an image we can decode */
      }
    }
  }
  const pick = PICK[key];
  return (pick ? list.filter((c) => c.file.endsWith(pick)) : list).sort((a, b) => b.size - a.size);
}

async function rasterInput(
  buf: Buffer
): Promise<{ input: Buffer; opts?: Record<string, unknown> }> {
  const ico = decodeIco(buf);
  if (ico?.png) return { input: ico.png };
  if (ico?.raw)
    return {
      input: ico.raw.data,
      opts: { raw: { width: ico.raw.width, height: ico.raw.height, channels: 4 } },
    };
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    // Bare BMP served as .ico: wrap its DIB (no AND mask; height not doubled).
    const dib = buf.subarray(14);
    const fake = Buffer.from(dib);
    fake.writeInt32LE(dib.readInt32LE(8) * 2, 8);
    const raw = decodeDib(fake);
    return {
      input: raw.data,
      opts: { raw: { width: raw.width, height: raw.height, channels: 4 } },
    };
  }
  return { input: buf };
}

async function writeRaster(key: string, file: string): Promise<{ file: string; file64: string }> {
  const r = await rasterInput(readFileSync(file));
  for (const s of [64, 128]) {
    const out = await sharp(r.input, { ...r.opts, limitInputPixels: 4096 * 4096 })
      .ensureAlpha()
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
      .toBuffer();
    writeFileSync(join(ROOT, 'assets', `${key}-${s}.png`), out);
  }
  return { file: `${key}-128.png`, file64: `${key}-64.png` };
}

/* ---------------- main ---------------- */

const siData = JSON.parse(readFileSync(join(SI, 'data/simple-icons.json'), 'utf8'));
const siIcons: Array<{ title: string; slug: string; hex: string; source: string }> = Array.isArray(
  siData
)
  ? siData
  : siData.icons;
const siVersion = JSON.parse(readFileSync(join(SI, 'package.json'), 'utf8')).version as string;

rmSync(join(ROOT, 'assets'), { recursive: true, force: true });
mkdirSync(join(ROOT, 'assets'), { recursive: true });

const outs: Out[] = [];
for (const p of PLATFORMS) {
  const key = p.key;
  if (key === 'chenji') {
    const svg = sanitizeSvg(readFileSync(OWN, 'utf8'));
    writeFileSync(join(ROOT, 'assets', `${key}.svg`), svg);
    outs.push({
      key,
      kind: 'svg',
      file: `${key}.svg`,
      color: p.color,
      source: 'starnote-web/public/brand/mark-gradient.svg',
      license: LICENSE_OWN,
      origin: 'own',
      fetchedAt: TODAY,
    });
    continue;
  }
  const slug = SIMPLE[key];
  if (slug) {
    const meta = siIcons.find((i) => i.slug === slug);
    if (!meta) throw new Error(`simple-icons has no ${slug}`);
    const color = `#${meta.hex.toLowerCase()}`;
    const svg = sanitizeSvg(readFileSync(join(SI, 'icons', `${slug}.svg`), 'utf8'), {
      fill: color,
    });
    writeFileSync(join(ROOT, 'assets', `${key}.svg`), svg);
    outs.push({
      key,
      kind: 'svg',
      file: `${key}.svg`,
      color,
      source: `https://github.com/simple-icons/simple-icons/blob/${siVersion}/icons/${slug}.svg（simple-icons@${siVersion}；上游：${meta.source}）`,
      license: LICENSE_SI,
      origin: 'simple-icons',
      fetchedAt: TODAY,
      ...(key === 'douyin' ? { note: '抖音与 TikTok 共用图形' } : {}),
    });
    continue;
  }
  const cands = await candidates(key);
  const svgCand = cands.find((c) => c.kind === 'svg');
  const raster = cands.find((c) => c.kind === 'raster');
  let done = false;
  if (svgCand) {
    try {
      const svg = sanitizeSvg(readFileSync(svgCand.file, 'utf8'), { dropTitle: true });
      if (looksDangerous(svg)) throw new Error('still dangerous after sanitize');
      writeFileSync(join(ROOT, 'assets', `${key}.svg`), svg);
      outs.push({
        key,
        kind: 'svg',
        file: `${key}.svg`,
        color: p.color,
        source: svgCand.url,
        license: LICENSE_OFFICIAL,
        origin: 'official',
        fetchedAt: svgCand.fetchedAt.slice(0, 10),
      });
      done = true;
    } catch (e) {
      console.warn(key, 'svg rejected:', String(e));
    }
  }
  if (!done && raster) {
    const files = await writeRaster(key, raster.file);
    outs.push({
      key,
      kind: 'png',
      ...files,
      color: p.color,
      source: raster.url,
      license: LICENSE_OFFICIAL,
      origin: 'official',
      fetchedAt: raster.fetchedAt.slice(0, 10),
      ...(raster.size < 64 ? { note: `原图仅 ${raster.size}px，已放大` } : {}),
    });
    done = true;
  }
  if (!done) {
    writeFileSync(join(ROOT, 'assets', `${key}.svg`), placeholderSvg(p.short || p.label, p.color));
    outs.push({
      key,
      kind: 'svg',
      file: `${key}.svg`,
      color: p.color,
      source: '—',
      license: LICENSE_PLACEHOLDER,
      origin: 'placeholder',
      fetchedAt: TODAY,
      note: '官网图标无法下载（403 / 无图标）',
    });
  }
}

/* ---------------- emit src/generated.ts ---------------- */

const pngUri = (f: string) =>
  `data:image/png;base64,${readFileSync(join(ROOT, 'assets', f)).toString('base64')}`;

// SVG logos carry only `svg` (the data URI is built at runtime by `svgDataUri`), PNG logos carry `src`.
const lines = outs.map((o) => {
  const rec: Record<string, unknown> = {
    kind: o.kind,
    file: o.file,
    ...(o.kind === 'svg'
      ? { svg: readFileSync(join(ROOT, 'assets', o.file), 'utf8') }
      : { src: pngUri(o.file) }),
    ...(o.file64 ? { src64: pngUri(o.file64) } : {}),
    color: o.color,
    source: o.source,
    license: o.license,
    origin: o.origin,
    fetchedAt: o.fetchedAt,
  };
  return `  ${JSON.stringify(o.key)}: ${JSON.stringify(rec)},`;
});
writeFileSync(
  join(ROOT, 'src/generated.ts'),
  `// GENERATED by scripts/build-logos.mts — do not edit. Sources: ../SOURCES.md\nimport type { LogoData } from './types';\n\nexport const LOGOS: Record<string, LogoData> = {\n${lines.join('\n')}\n};\n`
);

/* ---------------- emit SOURCES.md ---------------- */

const count = (o: Origin) => outs.filter((x) => x.origin === o).length;
const md = [
  '# 平台 logo 来源',
  '',
  `由 \`scripts/build-logos.mts\` 生成（${TODAY}）。下载文件一律视为不可信：SVG 经白名单清洗（\`src/sanitize.ts\`），位图经 sharp 解码后重新编码为 64×64 / 128×128 PNG。`,
  '',
  `合计 ${outs.length} 个：simple-icons ${count('simple-icons')}，官网 ${count('official')}，自有 ${count('own')}，占位 ${count('placeholder')}。`,
  '',
  '所有平台名称与 logo 均为其各自所有者的商标，此处仅用于指示发布目标平台，不表示任何合作或背书。',
  '',
  '| key | 文件 | 来源 | 许可 | 获取日期 | 备注 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...outs.map(
    (o) =>
      `| ${o.key} | ${o.file64 ? `${o.file64}, ${o.file}` : o.file} | ${o.origin === 'placeholder' ? '占位' : o.source} | ${o.license} | ${o.fetchedAt} | ${o.note ?? ''} |`
  ),
  '',
].join('\n');
writeFileSync(join(ROOT, 'SOURCES.md'), md);
console.log(
  `simple-icons ${count('simple-icons')}, official ${count('official')}, own ${count('own')}, placeholder ${count('placeholder')}`
);
for (const o of outs)
  if (o.origin !== 'simple-icons') console.log(o.key, o.origin, o.kind, o.note ?? '', o.source);
