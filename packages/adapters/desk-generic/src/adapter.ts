import {
  bundledScript,
  convert,
  defineAdapter,
  degradeTree,
  handOffEditor,
  handoffReport,
  localizedLabel,
  openSessionRun,
  platformMeta,
  platformRules,
  PlatformSessionError,
  rewriteImageSrcs,
  truncateText,
} from '@starnote/publish-core';
import { z } from 'zod';

import { msg } from './i18n';
import { GENERIC_SITE_SCRIPTS } from './sites';

import type { GenericDeskKey } from './sites';
import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  CommonFormShape,
  Doc,
  PublishOutput,
  ReportItem,
  SdkLang,
  SessionAdapterOptions,
} from '@starnote/publish-core';

/** Nothing to fill in on our side: the platform's own form (分类、话题、原创声明…) is filled on the platform. */
export const genericDeskSchema = z.object({});

export interface GenericRendered {
  title: string;
  html: string;
  text: string;
  /** For the platforms whose editor is Markdown (site script `flags.body: 'markdown'`). */
  markdown: string;
  report: ReportItem[];
}

const labelOf = (key: GenericDeskKey) => platformMeta(key)?.label ?? key;

/**
 * HTML for the platform's rich editor (pasting HTML keeps headings, lists, links, images), plain text as the
 * fallback. Relative 辰记 image URLs become absolute so the editor can fetch them.
 */
export function renderGeneric(
  doc: Doc,
  common: CommonFormShape,
  assetBase?: string,
  /** SPEC-r14 B5: language of the report. Default `zh-CN`. */
  lang?: SdkLang,
  /** The platform's title limit (its rules), default 100. */
  titleMax = 100
): GenericRendered {
  const report: ReportItem[] = [];
  const rawTitle = (common.title || doc.title || '').trim();
  const cut = truncateText(rawTitle, titleMax);
  if (cut.truncated)
    report.push({
      kind: 'title.truncated',
      text: msg(lang).titleTruncated(titleMax),
      level: 'notice',
      samples: [rawTitle],
    });
  const degraded = degradeTree(doc.json, {
    headings: { min: 2, max: 3 },
    dropTitleHeading: doc.title,
    callouts: { style: 'html' },
    math: { mode: 'source' },
    taskList: 'keep',
    flattenDetails: true,
    videoLabel: '视频',
    ...(lang ? { lang } : {}),
  });
  report.push(...degraded.report);
  let json = degraded.json;
  if (assetBase) {
    const base = assetBase.replace(/\/$/, '');
    const map = new Map(
      convert(json)
        .images.filter((src) => src.startsWith('/'))
        .map((src) => [src, `${base}${src}`] as const)
    );
    if (map.size) json = rewriteImageSrcs(json, map);
  }
  const out = convert(json);
  return { title: cut.value, html: out.html, text: out.text, markdown: out.markdown, report };
}

export function genericDeskBinding(key: GenericDeskKey): BindingSpec {
  const label = labelOf(key);
  const session = bundledScript(GENERIC_SITE_SCRIPTS[key]).session!;
  return {
    kind: 'cookie',
    store: 'desktop',
    helpUrl: platformMeta(key)?.homepage ?? session.loginUrl,
    instructions: msg('zh-CN').binding(label),
    instructionsFor: (lang) => msg(lang).binding(localizedLabel(key, label, lang)),
    checkEvery: 0,
    desktopSession: session,
  };
}

/**
 * SPEC-r13 §4b 通用模式: the 发布台 opens the platform's author entry page in the account's own window; the tile offers
 * 「复制标题」「复制正文」 and 「我已发布」. Nothing is clicked for the user.
 *
 * When the site script has checked selectors (国内大平台, 2026-10), the 发布台 opens the write page itself and fills the
 * title (`insertText`) and the body (pasted HTML) like a person would; the user picks the platform's own options
 * (分类、原创、AI 声明…) and clicks 发布.
 */
export function createGenericDeskAdapter(
  key: GenericDeskKey,
  opts: SessionAdapterOptions = {}
): Adapter<typeof genericDeskSchema> {
  const label = labelOf(key);
  const signed = GENERIC_SITE_SCRIPTS[key];
  const bundled = bundledScript(signed);
  const fills = Boolean(bundled.selectors.editor);
  // 技术社区的编辑器是 Markdown：预览和复制的正文都用 Markdown
  const markdown = bundled.flags?.body === 'markdown';
  const note = (l?: SdkLang) =>
    fills
      ? msg(l).runtimeNoteFill(localizedLabel(key, label, l))
      : msg(l).runtimeNote(localizedLabel(key, label, l));
  const titleMax = platformRules(key)?.title?.max ?? 100;
  return defineAdapter({
    key,
    label,
    runtimes: [
      {
        runtime: 'electron',
        mode: 'automation',
        needs: ['session'],
        note: note(),
        notes: { 'zh-TW': note('zh-TW'), en: note('en') },
      },
    ],
    contentTypes: ['article'],
    binding: genericDeskBinding(key),
    capabilities: { supportsUpdate: false, needsLogin: true, titleMax },
    schema: genericDeskSchema,
    preview: ((doc, _form, common = {}, _content, popts) => {
      const r = renderGeneric(doc, common, opts.assetBase, popts?.lang, titleMax);
      return {
        format: markdown ? 'markdown' : 'html',
        title: r.title,
        body: markdown ? r.markdown : r.html,
        report: r.report,
      } satisfies AdapterPreview;
    }) as NonNullable<Adapter<typeof genericDeskSchema>['preview']>,
    async publish({ doc, common, ctx }): Promise<PublishOutput> {
      const lang = ctx.lang;
      const t = msg(lang);
      const name = localizedLabel(key, label, lang);
      const L = lang ? { lang } : {};
      ctx.emit({ type: 'progress', percent: 10, text: t.readScript(name) });
      const run = await openSessionRun(ctx, key, label, signed, { ...opts, remoteScript: false });
      const { script } = run;
      const editorUrl = script.urls.write ?? script.urls.home;
      if (!ctx.handoff && !ctx.page)
        throw new PlatformSessionError('help', t.desktopOnly(name), {
          helpUrl: script.urls.home,
          ...L,
        });
      if (!editorUrl) throw new PlatformSessionError('help', t.noEntry(name), { ...L });
      const r = renderGeneric(doc, common, opts.assetBase, lang, titleMax);
      const report: ReportItem[] = [...r.report];
      ctx.emit({ type: 'progress', percent: 60, text: t.opening(name) });
      const res = await handOffEditor(ctx, run, label, {
        editorUrl,
        prefill: markdown
          ? { title: r.title, text: r.markdown }
          : { title: r.title, html: r.html, text: r.text },
      });
      report.push(...handoffReport(res, name, lang));
      if (markdown)
        report.push({
          kind: 'format.markdown',
          text: fills ? t.markdownFilled(name) : t.markdownBody(name),
          level: 'info',
        });
      if (script.selectors.editor) {
        // 我们做了什么（SPEC-r15）：填好的项；平台自己的选项（分类、原创、AI 声明…）由用户选，只提醒
        report.push({ kind: 'fields.prefilled', text: t.filled(name), level: 'info' });
        report.push({
          kind: 'declarations.user',
          text: t.chooseDeclarations(name),
          level: 'notice',
        });
      }
      const hint = t.hints[key];
      if (hint) report.push({ kind: 'platform.hint', text: hint, level: 'notice' });
      report.push({
        kind: 'handoff.pending',
        text: script.selectors.editor ? t.stepsFilled(name) : t.steps(name),
        level: 'notice',
      });
      ctx.emit({ type: 'progress', percent: 100, text: t.waiting(name) });
      return { url: editorUrl, state: 'handoff', report };
    },
  });
}
