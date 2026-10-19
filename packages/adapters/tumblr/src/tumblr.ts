/**
 * Tumblr (API v2 ✅ tumblr.com/docs/en/api/v2): NPF posts `POST /v2/blog/{blog}/posts`, edits
 * `PUT /v2/blog/{blog}/posts/{id}` (the whole post again ✅). Bound with OAuth2 (✅ `www.tumblr.com/oauth2/authorize`,
 * `api.tumblr.com/v2/oauth2/token`, scopes `basic write offline_access`; access tokens are short, a refresh token
 * comes with `offline_access` ✅).
 *
 * An article becomes NPF blocks (`./npf`): the title as `heading1`, the cover and body images as image blocks,
 * a link block back to 辰记 at the end, `source_url` = the original. Images: the documented way is a multipart
 * upload (✅ media `identifier` + a form field of that name; ⚠️ 外链 url 能否直接用未核实), so the relay body carries
 * the 辰记 image URLs and the sender (desktop main / 辰记's API) downloads and uploads them.
 *
 * Limits ✅: 250 posts / day per user (reblogs included), 250 image uploads / day.
 */
import { defineAdapter, mergeReports, platformMeta } from '@starnote/publish-core';
import {
  absoluteUrl,
  articleOf,
  canonicalOf,
  credentialOf,
  degradeJson,
  degradeReport,
  fitTags,
  fitTitle,
  guard,
  relayPublish,
} from '@starnote/publish-kit';
import { z } from 'zod';

import { toNpf } from './npf';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishContent,
  ReportItem,
  RuntimeSupport,
} from '@starnote/publish-core';
import type {
  CredentialSource,
  ErrorLinks,
  PlatformRef,
  RequestDescription,
} from '@starnote/publish-kit';
import type { NpfBlock } from './npf';

export const TUMBLR_API = 'https://api.tumblr.com/v2';

export const TUMBLR_LIMITS = {
  /** ⚠️ 待核实：单帖标签上限（按 30 截断），单个标签 ≤ 140 字符。 */
  tags: 30,
  tagMax: 140,
  /** ⚠️ 待核实：单帖内容块上限；按 500 截断。 */
  blocks: 500,
  /** ⚠️ 待核实：单帖图片上限；按 30 截断。 */
  images: 30,
  /** ✅ 每天每个用户最多发 250 帖、上传 250 张图片。 */
  postsPerDay: 250,
} as const;

export const tumblrSchema = z.object({
  /** Blog name (from the binding's list); absent: the one picked when binding (else the primary blog). */
  blog: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,64}$/, '博客名只能是字母、数字和 -')
    .optional()
    .describe('博客'),
  state: z
    .enum(['published', 'draft', 'private', 'queue'])
    .default('published')
    .describe('发布方式'),
  set_canonical: z.boolean().default(true).describe('附原文链接'),
  canonical_url: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, '请填写以 http(s):// 开头的地址')
    .optional()
    .describe('原文链接'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*$/, '只能用小写字母、数字和 -')
    .optional()
    .describe('网址'),
  external_id: z
    .string()
    .trim()
    .regex(/^\d+$/, '帖子 ID 是数字')
    .optional()
    .describe('已发布帖子 ID'),
});

export type TumblrForm = z.infer<typeof tumblrSchema>;
export type TumblrFormInput = z.input<typeof tumblrSchema>;

export const tumblrBinding: BindingSpec = {
  kind: 'oauth',
  store: 'desktop',
  provider: 'tumblr',
  scopes: ['basic', 'write', 'offline_access'],
  helpUrl: 'https://www.tumblr.com/',
  instructions: [
    '点「用 Tumblr 授权」，在 Tumblr 页面允许辰记代你发帖',
    '回到辰记后选择要发布到的博客',
    '桌面端：令牌加密存在本机；网页：令牌只在当前页面，关闭即失效；打开「云端代发」才会存到辰记服务器',
    '不用时到 Tumblr「设置 → 应用」撤销辰记',
  ],
  selects: [{ id: 'blog', title: '发布到哪个博客' }],
};

export interface TumblrPostBody {
  content: NpfBlock[];
  state: 'published' | 'draft' | 'private' | 'queue';
  tags?: string;
  source_url?: string;
  slug?: string;
}

export interface TumblrRelayBody {
  blog?: string;
  post: TumblrPostBody;
}

export interface TumblrRendered {
  title: string;
  blocks: NpfBlock[];
  previewHtml: string;
  body: TumblrRelayBody;
  report: ReportItem[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A rough HTML view of the blocks for the preview tab. */
export function npfPreviewHtml(blocks: NpfBlock[]): string {
  const out: string[] = [];
  let list: 'ol' | 'ul' | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const b of blocks) {
    if (b.type === 'image') {
      close();
      out.push(
        `<figure><img src="${esc(b.media[0]?.url ?? '')}" alt="${esc(b.alt_text ?? '')}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`
      );
      continue;
    }
    if (b.type === 'link') {
      close();
      out.push(`<p class="npf-link"><a href="${esc(b.url)}">${esc(b.title ?? b.url)}</a></p>`);
      continue;
    }
    let html = '';
    let pos = 0;
    const chars = b.text;
    const marks = [...(b.formatting ?? [])].sort((x, y) => x.start - y.start);
    for (const f of marks) {
      if (f.start < pos) continue;
      html += esc(chars.slice(pos, f.start));
      const inner = esc(chars.slice(f.start, f.end));
      html +=
        f.type === 'link'
          ? `<a href="${esc(f.url ?? '')}">${inner}</a>`
          : f.type === 'bold'
            ? `<strong>${inner}</strong>`
            : f.type === 'italic'
              ? `<em>${inner}</em>`
              : f.type === 'strikethrough'
                ? `<s>${inner}</s>`
                : `<small>${inner}</small>`;
      pos = f.end;
    }
    html += esc(chars.slice(pos));
    const kind =
      b.subtype === 'ordered-list-item' ? 'ol' : b.subtype === 'unordered-list-item' ? 'ul' : null;
    if (kind) {
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${html}</li>`);
      continue;
    }
    close();
    if (b.subtype === 'heading1') out.push(`<h1>${html}</h1>`);
    else if (b.subtype === 'heading2') out.push(`<h2>${html}</h2>`);
    else if (b.subtype === 'indented' || b.subtype === 'quote')
      out.push(`<blockquote>${html}</blockquote>`);
    else if (b.subtype === 'chat') out.push(`<pre>${html}</pre>`);
    else out.push(`<p>${html}</p>`);
  }
  close();
  return out.join('\n');
}

function tumblrTag(t: string): string | null {
  const n = t.replace(/^#+/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return n ? n.slice(0, TUMBLR_LIMITS.tagMax) : null;
}

/** Pure: NPF blocks, relay body and the predicted report (articles and short texts). */
export function renderTumblr(
  doc: Doc,
  form: TumblrForm,
  common: CommonFormShape = {},
  content?: PublishContent,
  opts: { assetBase?: string } = {}
): TumblrRendered {
  const report: ReportItem[] = [];
  const blocks: NpfBlock[] = [];
  let titleText: string;
  let canonicalUrl: string | undefined;

  if (content?.kind === 'short-text') {
    titleText = common.title || doc.title || '';
    for (const line of content.text.split(/\n{2,}/)) {
      const t = line.trim();
      if (t) blocks.push({ type: 'text', text: t });
    }
    canonicalUrl = form.set_canonical === false ? undefined : form.canonical_url || content.link;
  } else {
    const article = articleOf(doc, content);
    const { json, counts } = degradeJson(article.doc.json, {
      target: 'html',
      ...(article.lang ? { lang: article.lang } : {}),
      title: article.doc.title,
      math: 'source',
      video: 'link',
      ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
    });
    report.push(...degradeReport(counts, { target: 'html' }, 'Tumblr'));
    const title = fitTitle(common.title || article.doc.title || 'Untitled', undefined, 'Tumblr');
    titleText = title.title;
    report.push(...title.report);
    blocks.push({ type: 'text', text: titleText, subtype: 'heading1' });
    const cover = absoluteUrl(common.cover, opts.assetBase);
    if (cover) blocks.push({ type: 'image', media: [{ url: cover }] });
    const npf = toNpf(json);
    blocks.push(...npf.blocks);
    if (npf.counts.divider)
      report.push({
        kind: 'block.dropped.divider',
        text: `Tumblr 没有分割线，去掉 ${npf.counts.divider} 处`,
      });
    if (npf.counts.table)
      report.push({
        kind: 'table.flattened',
        level: 'notice',
        text: `Tumblr 没有表格，${npf.counts.table} 个表格按行转成文字（单元格用 | 分隔）`,
        count: npf.counts.table,
      });
    if (npf.counts.code)
      report.push({
        kind: 'code.monospace',
        text: `${npf.counts.code} 个代码块转成等宽文字（没有高亮）`,
      });
    if (npf.counts.imageSkipped)
      report.push({
        kind: 'image.failed',
        level: 'warn',
        text: `${npf.counts.imageSkipped} 张图片没有可访问的地址，已去掉`,
        count: npf.counts.imageSkipped,
      });
    const canonical = canonicalOf(form, article, 'Tumblr');
    canonicalUrl = canonical.url;
    report.push(...canonical.report.filter((i) => i.kind !== 'canonical.set'));
  }

  if (canonicalUrl) {
    blocks.push({ type: 'link', url: canonicalUrl, title: titleText || canonicalUrl });
    report.push({
      kind: 'canonical.source',
      text: 'Tumblr 没有 canonical：帖子的来源（source_url）设为辰记原文，文末附原文链接卡片',
      detail: { url: canonicalUrl },
    });
  }

  // cap images, then blocks
  let images = 0;
  let capped = blocks.filter((b) => b.type !== 'image' || ++images <= TUMBLR_LIMITS.images);
  if (images > TUMBLR_LIMITS.images)
    report.push({
      kind: 'image.trimmed',
      level: 'notice',
      text: `Tumblr 单帖最多 ${TUMBLR_LIMITS.images} 张图片，去掉 ${images - TUMBLR_LIMITS.images} 张`,
    });
  if (capped.length > TUMBLR_LIMITS.blocks) {
    const tail = capped.at(-1)!;
    capped = [...capped.slice(0, TUMBLR_LIMITS.blocks - 1), tail];
    report.push({
      kind: 'body.truncated',
      level: 'warn',
      text: `正文超过 ${TUMBLR_LIMITS.blocks} 个段落，已截短`,
    });
  }
  const imageCount = capped.filter((b) => b.type === 'image').length;
  if (imageCount)
    report.push({
      kind: 'image.rehosted',
      text: `${imageCount} 张图片将上传到 Tumblr`,
      count: imageCount,
    });

  const tags = fitTags(common.tags, { max: TUMBLR_LIMITS.tags, normalize: tumblrTag }, 'Tumblr');
  report.push(...tags.report);
  if (form.state !== 'published')
    report.push({
      kind: 'draft.only',
      level: 'notice',
      text:
        form.state === 'queue'
          ? '加入 Tumblr 发布队列，按队列设置的时间发出'
          : form.state === 'private'
            ? '以私密帖子发布，只有你自己能看到'
            : '保存为 Tumblr 草稿',
    });

  return {
    title: titleText,
    blocks: capped,
    previewHtml: npfPreviewHtml(capped),
    body: {
      ...(form.blog ? { blog: form.blog } : {}),
      post: {
        content: capped,
        state: form.state,
        ...(tags.tags.length ? { tags: tags.tags.join(',') } : {}),
        ...(canonicalUrl ? { source_url: canonicalUrl } : {}),
        ...(form.slug ? { slug: form.slug } : {}),
      },
    },
    report,
  };
}

export function tumblrRef(links?: ErrorLinks): PlatformRef {
  return { key: 'tumblr', label: 'Tumblr', ...(links ? { links } : {}) };
}

export const TUMBLR_REQUESTS = {
  account: { method: 'GET', url: `${TUMBLR_API}/user/info`, auth: 'Bearer <access_token>' },
  create: {
    method: 'POST',
    url: `${TUMBLR_API}/blog/{blog}/posts`,
    auth: 'Bearer <access_token>',
    body: 'multipart: json = TumblrPostBody (image media → {type, identifier}), img<N> = file',
  },
  update: {
    method: 'PUT',
    url: `${TUMBLR_API}/blog/{blog}/posts/{id}`,
    auth: 'Bearer <access_token>',
    body: 'same as create',
  },
} as const satisfies Record<string, RequestDescription>;

export interface TumblrAdapterOptions {
  runtimes?: RuntimeSupport[];
  assetBase?: string;
  links?: ErrorLinks;
  credential?: CredentialSource;
}

export function createTumblrAdapter(opts: TumblrAdapterOptions = {}): Adapter<typeof tumblrSchema> {
  const ref = tumblrRef(opts.links);
  const renderOpts = opts.assetBase ? { assetBase: opts.assetBase } : {};
  return defineAdapter({
    key: 'tumblr',
    label: 'Tumblr',
    runtimes: opts.runtimes ?? platformMeta('tumblr')!.runtimes,
    contentTypes: ['article', 'short-text'],
    binding: tumblrBinding,
    capabilities: { supportsUpdate: true, needsLogin: true },
    schema: tumblrSchema,
    preview(doc, form, common, content): AdapterPreview {
      const r = renderTumblr(doc, form, common, content, renderOpts);
      return {
        format: 'html',
        title: r.title,
        body: JSON.stringify(r.body.post.content),
        previewHtml: r.previewHtml,
        report: r.report,
      };
    },
    publish({ doc, form, common, ctx, content }) {
      return guard(ctx, ref, async () => {
        const r = renderTumblr(doc, form, common, content, renderOpts);
        ctx.emit({ type: 'report', items: r.report });
        ctx.emit({ type: 'progress', percent: 40, text: '发布到 Tumblr' });
        const credential = await credentialOf(opts.credential, 'tumblr', ctx);
        const res = await relayPublish(ctx, ref, r.body, form.external_id, { credential });
        ctx.emit({ type: 'progress', percent: 100, text: '完成' });
        return {
          url: res.url,
          externalId: res.externalId,
          state: res.state ?? (form.state === 'draft' ? 'draft' : 'published'),
          report: mergeReports(r.report, res.report),
        };
      });
    },
  });
}
