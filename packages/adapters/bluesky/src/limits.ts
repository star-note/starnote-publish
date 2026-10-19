/** Bluesky limits and URLs, shared by the renderer and the direct (web) sender. */
export const BLUESKY_LIMITS = {
  /** ✅ 300 个字素（grapheme）。 */
  graphemes: 300,
  /** ⚠️ 待核实：链接卡片缩略图 ≤ 1,000,000 字节（lexicon）。 */
  thumbBytes: 1_000_000,
  maxTags: 3,
  cardTitle: 300,
  cardDescription: 1000,
} as const;

/** `at://did/app.bsky.feed.post/rkey` → the bsky.app URL. */
export function postUrl(uri: string, handleOrDid?: string): string {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri);
  if (!m) return '';
  return `https://bsky.app/profile/${handleOrDid || m[1]}/post/${m[2]}`;
}
