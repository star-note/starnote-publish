import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PLATFORMS } from '@starnote/publish-core';
import { describe, expect, it } from 'vitest';

import {
  allLogos,
  hasLogo,
  logoOf,
  looksDangerous,
  platformMeta,
  platformsWithLogos,
  sanitizeSvg,
  svgDataUri,
} from '../src/index';

const assets = (f: string) => fileURLToPath(new URL(`../assets/${f}`, import.meta.url));

describe('logo coverage', () => {
  it('every registry key has a logo with source and license', () => {
    for (const p of PLATFORMS) {
      expect(hasLogo(p.key), p.key).toBe(true);
      const l = logoOf(p.key);
      expect(['svg', 'png']).toContain(l.kind);
      expect(l.src).toMatch(/^data:image\/(svg\+xml|png)[,;]/);
      expect(l.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(l.source).toBeTruthy();
      expect(l.license).toBeTruthy();
      expect(existsSync(assets(l.file)), l.file).toBe(true);
      if (l.kind === 'png') expect(existsSync(assets(`${p.key}-64.png`))).toBe(true);
    }
    expect(allLogos()).toHaveLength(PLATFORMS.length);
  });

  it('shipped SVGs are clean', () => {
    for (const l of allLogos()) {
      if (l.kind !== 'svg' || l.origin === 'placeholder') continue;
      expect(looksDangerous(l.svg!), l.key).toBe(false);
      expect(readFileSync(assets(l.file), 'utf8')).toBe(l.svg);
    }
  });

  it('SOURCES.md lists every key', () => {
    const md = readFileSync(fileURLToPath(new URL('../SOURCES.md', import.meta.url)), 'utf8');
    const keys = new Set(
      md
        .split('\n')
        .map((l) => /^\|\s*([\w-]+)\s*\|/.exec(l)?.[1])
        .filter(Boolean)
    );
    for (const p of PLATFORMS) expect(keys.has(p.key), p.key).toBe(true);
  });

  it('keeps apostrophes in the markup when building the data URI', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text font-family="'PingFang SC',sans-serif">it's</text></svg>`;
    const uri = svgDataUri(svg);
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    const decoded = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    // every attribute is still delimited by one pair of quotes; the apostrophes are entities
    expect(decoded).toBe(
      `<svg xmlns='http://www.w3.org/2000/svg'><text font-family='&#39;PingFang SC&#39;,sans-serif'>it&#39;s</text></svg>`
    );
    expect(decoded.match(/'/g)?.length).toBe(4);
    // the shipped logo with an apostrophe in font-family renders the same way
    expect(decodeURIComponent(logoOf('segmentfault').src)).not.toMatch(/font-family='[^']*'[^ >]/);
  });

  it('unknown keys get a placeholder', () => {
    const l = logoOf('nope', { label: '某', color: '#123456' });
    expect(l.origin).toBe('placeholder');
    expect(l.kind).toBe('svg');
    expect(l.svg).toContain('某');
    expect(l.svg).toContain('#123456');
  });

  it('platformMeta merges registry fields and logo', () => {
    const m = platformMeta('wechat')!;
    expect(m.label).toBe('微信公众号');
    expect(m.region).toBe('cn');
    expect(m.logo.key).toBe('wechat');
    expect(m.logo.origin).toBe('simple-icons');
    expect(platformMeta('nope')).toBeUndefined();
    expect(platformsWithLogos().map((p) => p.key)).toEqual(PLATFORMS.map((p) => p.key));
  });
});

describe('sanitizeSvg', () => {
  const evil = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(1)</script>
  <script type="text/javascript"><![CDATA[ alert(2) ]]></script>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(3)></body></foreignObject>
  <style>@import url(https://evil.test/x.css); path{fill:url(https://evil.test/a)}</style>
  <a href="javascript:alert(4)"><path d="M0 0h1"/></a>
  <image href="https://evil.test/track.png" width="1" height="1"/>
  <use xlink:href="https://evil.test/sprite.svg#a"/>
  <use href="#ok"/>
  <path id="ok" d="M0 0h10v10z" fill="url(#g)" onclick="alert(5)" style="fill:url('https://evil.test/b');stroke:red;background:url(#g)"/>
  <rect width="1" height="1" fill="url(https://evil.test/c)" filter="url(#f)"/>
  <circle r="1" fill="&#106;avascript:alert(6)"/>
  <linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>
  <title>Hi &lt;b&gt;</title>
</svg>`;

  const out = sanitizeSvg(evil);

  it('removes script, foreignObject, style, image, a and DOCTYPE', () => {
    expect(out).not.toMatch(/<script|<foreignObject|<style|<image|<a[\s>]|DOCTYPE|ENTITY|alert\(/i);
    expect(out).not.toMatch(/<body|<img/i);
  });

  it('removes event handlers', () => {
    expect(out).not.toMatch(/\son[a-z]+=/i);
  });

  it('removes external href and url() but keeps local references', () => {
    expect(out).not.toContain('evil.test');
    expect(out).toContain('<use href="#ok"/>');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('filter="url(#f)"');
    expect(out).toContain('stroke:red');
    expect(out).not.toMatch(/javascript/i);
  });

  it('keeps geometry and escapes text', () => {
    expect(out).toContain('d="M0 0h10v10z"');
    expect(out).toContain('<linearGradient id="g">');
    expect(out).toContain('<title>Hi &lt;b&gt;</title>');
    expect(looksDangerous(out)).toBe(false);
  });

  it('can set a root fill and rejects non-SVG input', () => {
    expect(
      sanitizeSvg('<svg viewBox="0 0 1 1" fill="red"><path d="M0 0"/></svg>', { fill: '#07c160' })
    ).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" fill="#07c160"><path d="M0 0"/></svg>'
    );
    expect(() => sanitizeSvg('<html><script>1</script></html>')).toThrow();
  });
});
