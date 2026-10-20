const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Picks black or white text for a `#rrggbb` background. */
function ink(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#1f1f1f' : '#ffffff';
}

/** Rounded square in the brand colour with the platform's first glyph — used when no logo exists. */
export function placeholderSvg(name: string, color: string): string {
  const glyph = Array.from(name.trim())[0] ?? '?';
  const bg = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#8c8c8c';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${esc(name)}">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="32" dy=".35em" text-anchor="middle" font-size="34" font-weight="600" ` +
    `font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" fill="${ink(bg)}">${esc(glyph)}</text>` +
    `</svg>`
  );
}
