import type { Doc } from './types';

/**
 * What a platform receives (SPEC-r8 §12.1). Long-form platforms take `article`; 小红书 / 抖音图文
 * take `image-set`; video platforms take `video`; X / Threads / 微博短帖 take `short-text`.
 */
export type ContentKind = 'article' | 'image-set' | 'video' | 'short-text';

export const CONTENT_KINDS: readonly ContentKind[] = [
  'article',
  'image-set',
  'video',
  'short-text',
];

/** An image or video the adapter may have to upload (rehost) to the platform. */
export interface MediaAsset {
  /** 辰记 asset URL (or `file://` on the desktop only). */
  url: string;
  /** Asset hash in the 辰记 library: dedupe / rehost cache key. */
  hash?: string;
  mime?: string;
  width?: number;
  height?: number;
  bytes?: number;
  alt?: string;
}

export interface ArticleContent {
  kind: 'article';
  doc: Doc;
  /** Language of `doc`, e.g. `zh-CN`. */
  lang?: string;
  /** Translated versions of the same note, keyed by language (`{ en: Doc }`). */
  translations?: Record<string, Doc>;
  /** The note's canonical URL on 辰记 (`https://starnote.app/@<handle>/<short_id>`). */
  canonicalUrl?: string;
  /** The 辰记 post's `short_id`, when the note is published there. */
  shortId?: string;
  /** The 辰记 post's blog category (`slug` is the URL segment, `name` the display name). */
  category?: { slug: string; name: string };
  /** When the 辰记 post was first published (ISO 8601); republishing keeps the date. */
  publishedAt?: string;
}

export interface ImageSetContent {
  kind: 'image-set';
  title: string;
  /** Body text (小红书 ≤ 1000 chars). */
  caption: string;
  /** The first image is the cover. */
  images: MediaAsset[];
  topics?: string[];
  /** Kept when derived from an article. */
  from?: ArticleContent;
}

export interface VideoContent {
  kind: 'video';
  title: string;
  description: string;
  video: MediaAsset & { durationSec: number };
  cover?: MediaAsset;
  topics?: string[];
  subtitles?: { lang: string; url: string }[];
  orientation?: 'landscape' | 'portrait' | 'square';
}

export interface ShortTextContent {
  kind: 'short-text';
  text: string;
  /** Link back to the article (may be replaced by a tracking short link). */
  link?: string;
  images?: MediaAsset[];
  /** X / Threads thread, one entry per post. */
  thread?: string[];
}

export type PublishContent = ArticleContent | ImageSetContent | VideoContent | ShortTextContent;

/** Wraps a converted `Doc` as article content; what `PublishJob.doc` means when `content` is absent. */
export function articleContent(
  doc: Doc,
  extra: Omit<ArticleContent, 'kind' | 'doc'> = {}
): ArticleContent {
  return { kind: 'article', doc, ...extra };
}
