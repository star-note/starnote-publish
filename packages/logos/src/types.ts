export type LogoKind = 'svg' | 'png';

/** Where a logo came from (see SOURCES.md). */
export type LogoOrigin = 'simple-icons' | 'official' | 'own' | 'placeholder';

/** Stored form (src/generated.ts). */
export interface LogoData {
  kind: LogoKind;
  /** File name under the package's `assets/` (also exported as `@starnote/platform-logos/assets/*`). */
  file: string;
  /** Sanitized SVG markup (SVG logos). */
  svg?: string;
  /** 128×128 PNG data URI (PNG logos). */
  src?: string;
  /** 64×64 PNG data URI (PNG logos). */
  src64?: string;
  /** Brand colour (`#rrggbb`). */
  color: string;
  /** Source URL (or description) of the original file. */
  source: string;
  license: string;
  origin: LogoOrigin;
  /** YYYY-MM-DD. */
  fetchedAt: string;
}

export interface Logo {
  key: string;
  kind: LogoKind;
  /** Self-contained data URI for `<img src>` / CSS `url()` — 128×128 for PNG logos. */
  src: string;
  /** 64×64 variant for PNG logos; same as `src` for SVG. */
  src64: string;
  /** Sanitized SVG markup (SVG logos only), e.g. for inline rendering. */
  svg?: string;
  color: string;
  source: string;
  license: string;
  origin: LogoOrigin;
  fetchedAt: string;
  /** File name under `assets/`. */
  file: string;
}
