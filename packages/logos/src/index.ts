/**
 * @starnote/platform-logos — the single source of platform logos for web, mobile and desktop.
 * Browser-safe, no runtime dependencies besides the platform registry from @starnote/publish-core.
 * Every logo is a self-contained data URI, so no bundler asset config and no hard-coded paths.
 */
import { PLATFORMS } from '@starnote/publish-core';

import { LOGOS } from './generated';
import { placeholderSvg } from './placeholder';

import type { Logo, LogoData } from './types';
import type { PlatformKey, PlatformMeta } from '@starnote/publish-core';

export type { Logo, LogoData, LogoKind, LogoOrigin } from './types';
export { placeholderSvg } from './placeholder';
export { sanitizeSvg, looksDangerous } from './sanitize';
export type { SanitizeSvgOptions } from './sanitize';

/**
 * `data:image/svg+xml,…` (URL-encoded, smaller than base64). Attribute quotes become `'`, so an apostrophe in
 * the markup (`font-family="'PingFang SC'"`) is written as `&#39;` first — it would otherwise end the attribute.
 */
export function svgDataUri(svg: string): string {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(svg.replace(/'/g, '&#39;').replace(/"/g, "'"))
      .replace(/%20/g, ' ')
      .replace(/%3D/g, '=')
      .replace(/%3A/g, ':')
      .replace(/%2F/g, '/')
  );
}

const cache = new Map<string, Logo>();

function build(key: string, d: LogoData): Logo {
  const src = d.kind === 'svg' ? svgDataUri(d.svg ?? '') : (d.src ?? '');
  return {
    key,
    kind: d.kind,
    src,
    src64: d.src64 ?? src,
    ...(d.svg ? { svg: d.svg } : {}),
    color: d.color,
    source: d.source,
    license: d.license,
    origin: d.origin,
    fetchedAt: d.fetchedAt,
    file: d.file,
  };
}

/** True when the package ships a logo (real or placeholder) for `key`. */
export function hasLogo(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOGOS, key);
}

/**
 * Logo for a platform key. Unknown keys get a generated placeholder (first glyph on grey, or on
 * `fallback.color` / with `fallback.label` when given), so callers never need their own fallback.
 */
export function logoOf(key: string, fallback?: { label?: string; color?: string }): Logo {
  const hit = cache.get(key);
  if (hit) return hit;
  const d = hasLogo(key) ? LOGOS[key] : undefined;
  if (d) {
    const logo = build(key, d);
    cache.set(key, logo);
    return logo;
  }
  const color = fallback?.color ?? '#8c8c8c';
  const svg = placeholderSvg(fallback?.label || key || '?', color);
  return build(key, {
    kind: 'svg',
    file: '',
    svg,
    color,
    source: '—',
    license: '占位（辰记生成）',
    origin: 'placeholder',
    fetchedAt: '',
  });
}

/** All shipped logos, in registry order. */
export function allLogos(): Logo[] {
  return Object.keys(LOGOS).map((k) => logoOf(k));
}

export type PlatformWithLogo = PlatformMeta & { logo: Logo };

const byKey = new Map<string, PlatformMeta>(PLATFORMS.map((p) => [p.key, p]));

/**
 * Registry entry merged with its logo — one call gives name, colour, region, runtimes… and the logo.
 * Returns undefined for keys that are not in the registry.
 */
export function platformMeta(key: PlatformKey | (string & {})): PlatformWithLogo | undefined {
  const p = byKey.get(key);
  return p
    ? { ...p, logo: logoOf(p.key, { label: p.short || p.label, color: p.color }) }
    : undefined;
}

/** Every registry platform with its logo, in registry order. */
export function platformsWithLogos(): PlatformWithLogo[] {
  return PLATFORMS.map((p) => ({
    ...p,
    logo: logoOf(p.key, { label: p.short || p.label, color: p.color }),
  }));
}
