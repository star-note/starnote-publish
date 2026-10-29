/**
 * Instagram API mode (Instagram API with Instagram Login ✅ developers.facebook.com/docs/instagram-platform, SPEC-r11
 * §10): professional (business / creator) accounts only, Meta App Review ⚠️. Scopes `instagram_business_basic,
 * instagram_business_content_publish`; a 60-day token renewed with `ig_refresh_token`.
 *
 * Three stages (SPEC-r11 §2), run by 辰记's API or the desktop's local relay:
 *
 * 1. one container per image (`POST /{ig-user-id}/media { image_url, is_carousel_item }`), then — for 2–10 images —
 *    the carousel container (`media_type: 'CAROUSEL', children, caption`); one image: a single `IMAGE` container;
 * 2. `GET /{container-id}?fields=status_code` until `FINISHED`;
 * 3. `POST /{ig-user-id}/media_publish { creation_id }`; the link is the media's `permalink`.
 *
 * Meta fetches the images itself: **every image must be a public HTTPS URL** ⚠️ — a development `localhost` asset
 * fails, so it is refused here up front as `bad_body`. Caption ≤ 2200 characters, 30 hashtags (shared with the
 * hand-off renderer).
 *
 * Not bound: the hand-off mode of `./instagram` (Web Share on a phone, download + copy on a computer).
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  credentialOf,
  guard,
  helpError,
  newPostReport,
  refIn,
  relayCheck,
  relayFinalize,
  relayPublish,
  relayRequestOf,
} from '@starnote/publish-kit';

import { msg } from './i18n';
import { instagramRef, instagramSchema, instagramSchemaFor, renderInstagram } from './instagram';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
  SdkLang,
} from '@starnote/publish-core';
import type { CredentialSource, ErrorLinks, RequestDescription } from '@starnote/publish-kit';
import type { InstagramForm } from './instagram';

export const INSTAGRAM_GRAPH = 'https://graph.instagram.com';

/** ⚠️ 轮播 2–10 张（内容发布 API）；单图帖 1 张。 */
export const INSTAGRAM_API_LIMITS = { carouselMin: 2, carouselMax: 10 } as const;

export const INSTAGRAM_POLL = { intervalSec: 5, timeoutSec: 600 } as const;

export const instagramApiBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'instagram',
  scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  helpUrl: 'https://help.instagram.com/502981923235522',
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
};

/** Hosts Meta cannot reach: loopback, private ranges, development names. */
export function isPublicHttpsUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.test') ||
    h.endsWith('.internal') ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^0\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe80:/.test(h)
  )
    return false;
  return true;
}

/** What the relay builds the containers from: one image → a single `IMAGE` container, 2–10 → a carousel. */
export interface InstagramMediaBody {
  caption: string;
  images: Array<{ image_url: string; alt_text?: string }>;
}

export interface InstagramApiRendered {
  caption: string;
  body: InstagramMediaBody;
  report: ReportItem[];
}

/** Pure: the media request. Throws on no image or a non-public image URL (Meta could not fetch it). */
export function renderInstagramApi(
  doc: Doc,
  form: InstagramForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string; lang?: SdkLang } = {}
): InstagramApiRendered {
  const t = msg(opts.lang);
  const r = renderInstagram(doc, form, common, content, opts);
  if (!r.files.length) throw new Error(t.needsImage);
  const local = r.files.filter((f) => !isPublicHttpsUrl(f.url));
  if (local.length)
    throw new Error(
      t.unreachable(
        local
          .slice(0, 2)
          .map((f) => f.url)
          .join(t.listSeparator)
      )
    );
  const images = r.files
    .slice(0, INSTAGRAM_API_LIMITS.carouselMax)
    .map((f) => ({ image_url: f.url }));
  const report = r.report.filter((i) => i.kind !== 'handoff.pending');
  report.push({
    kind: 'processing',
    text: images.length > 1 ? t.carousel(images.length) : t.single,
  });
  return {
    caption: r.caption,
    body: { caption: r.caption, images },
    report,
  };
}

export const INSTAGRAM_REQUESTS = {
  me: {
    method: 'GET',
    url: `${INSTAGRAM_GRAPH}/me?fields=user_id,username,account_type`,
    auth: 'Bearer <access_token>',
  },
  item: {
    method: 'POST',
    url: `${INSTAGRAM_GRAPH}/{ig-user-id}/media`,
    auth: 'Bearer <access_token>',
    body: 'image_url, is_carousel_item=true (carousel) | image_url, caption (single) → { id }',
  },
  carousel: {
    method: 'POST',
    url: `${INSTAGRAM_GRAPH}/{ig-user-id}/media`,
    auth: 'Bearer <access_token>',
    body: "media_type='CAROUSEL', children=<ids>, caption → { id } (pending.container_id)",
  },
  status: {
    method: 'GET',
    url: `${INSTAGRAM_GRAPH}/{container-id}?fields=status_code`,
    auth: 'Bearer <access_token>',
    body: 'IN_PROGRESS | FINISHED (→ ready) | PUBLISHED (→ completed) | ERROR | EXPIRED',
  },
  publish: {
    method: 'POST',
    url: `${INSTAGRAM_GRAPH}/{ig-user-id}/media_publish`,
    auth: 'Bearer <access_token>',
    body: 'creation_id=<container-id> → { id }; then GET /{id}?fields=permalink',
  },
  refresh: {
    method: 'GET',
    url: `${INSTAGRAM_GRAPH}/refresh_access_token?grant_type=ig_refresh_token`,
    auth: 'long-lived token',
  },
} as const satisfies Record<string, RequestDescription>;

export interface InstagramApiAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
  poll?: { intervalSec?: number; timeoutSec?: number };
}

/** API mode (bound professional account); `renderHandoff` is the hand-off mode for when it is not bound. */
export function createInstagramApiAdapter(
  opts: InstagramApiAdapterOptions = {}
): Adapter<typeof instagramSchema> {
  const ref = instagramRef(opts.links);
  const base = opts.assetBase ? { assetBase: opts.assetBase } : {};
  const renderOpts = (lang?: SdkLang) => ({ ...base, ...(lang ? { lang } : {}) });
  return defineAdapter({
    key: 'instagram',
    label: 'Instagram',
    runtimes: opts.runtimes ?? platformMeta('instagram')!.runtimes.filter((r) => r.mode === 'api'),
    contentTypes: ['image-set', 'article'],
    binding: instagramApiBinding,
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: instagramSchema,
    schemaFor: instagramSchemaFor,
    maxConcurrent: 2,
    pollIntervalSec: opts.poll?.intervalSec ?? INSTAGRAM_POLL.intervalSec,
    pollTimeoutSec: opts.poll?.timeoutSec ?? INSTAGRAM_POLL.timeoutSec,
    preview(doc, form, common, content, popts): AdapterPreview {
      const ro = renderOpts(popts?.lang);
      const r = renderInstagram(doc, form, common, content, ro);
      let report = r.report.filter((i) => i.kind !== 'handoff.pending');
      try {
        report = renderInstagramApi(doc, form, common, content, ro).report;
      } catch (e) {
        report = [
          ...report,
          { kind: 'image.unreachable', level: 'warn', text: (e as Error).message },
        ];
      }
      return {
        format: 'files',
        title: common?.title || doc.title,
        body: r.caption,
        files: r.files.map((f) => ({ path: f.filename, content: f.url })),
        report,
      };
    },
    renderRequest({ doc, form, common, content, lang }) {
      const r = renderInstagramApi(doc, form, common, content, renderOpts(lang));
      return relayRequestOf(r.body, undefined, undefined, r.report);
    },
    renderHandoff({ doc, form, common, content, lang }) {
      const r = renderInstagram(doc, form, common, content, renderOpts(lang));
      return { handoff: r.handoff, report: r.report };
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        let r: InstagramApiRendered;
        const t = msg(ctx.lang);
        try {
          r = renderInstagramApi(doc, form, common, content, renderOpts(ctx.lang));
        } catch (e) {
          throw helpError(refIn(ref, ctx.lang), (e as Error).message, {
            code: 'invalid',
            kind: 'bad_body',
          });
        }
        r.report.push(...newPostReport(ctx.previous, ctx.lang));
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 30, text: t.creating });
        const credential = await credentialOf(opts.credential, 'instagram', ctx);
        const res = await relayPublish({ ...ctx, previous: undefined }, ref, r.body, undefined, {
          credential,
        });
        const report = mergeReports(r.report, res.report);
        if (res.state === 'processing')
          return { url: res.url, state: 'processing' as const, pending: res.pending, report };
        ctx.emit({ type: 'progress', percent: 100, text: t.done });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? 'published',
          report,
        };
      });
    },
    checkStatus(pending, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'instagram', ctx);
        return relayCheck(ctx, ref, pending, { credential });
      });
    },
    finalize(pending, ctx) {
      return guard(ctx, ref, async () => {
        const credential = await credentialOf(opts.credential, 'instagram', ctx);
        return relayFinalize(ctx, ref, pending, { credential });
      });
    },
  });
}
