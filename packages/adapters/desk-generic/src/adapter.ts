import {
  bundledScript,
  convert,
  defineAdapter,
  degradeTree,
  handOffEditor,
  handoffReport,
  openSessionRun,
  platformMeta,
  PlatformSessionError,
  rewriteImageSrcs,
  truncateText,
} from '@starnote/publish-core';
import { z } from 'zod';

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
  SessionAdapterOptions,
} from '@starnote/publish-core';

/** Nothing to fill in on our side: the platform's own form (分类、话题、原创声明…) is filled on the platform. */
export const genericDeskSchema = z.object({});

export interface GenericRendered {
  title: string;
  html: string;
  text: string;
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
  assetBase?: string
): GenericRendered {
  const report: ReportItem[] = [];
  const rawTitle = (common.title || doc.title || '').trim();
  const cut = truncateText(rawTitle, 100);
  if (cut.truncated)
    report.push({
      kind: 'title.truncated',
      text: '标题超过 100 字，已截短',
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
  return { title: cut.value, html: out.html, text: out.text, report };
}

export function genericDeskBinding(key: GenericDeskKey): BindingSpec {
  const label = labelOf(key);
  const session = bundledScript(GENERIC_SITE_SCRIPTS[key]).session!;
  return {
    kind: 'cookie',
    store: 'desktop',
    helpUrl: platformMeta(key)?.homepage ?? session.loginUrl,
    instructions: [
      `在辰记桌面端点「在桌面端登录${label}」`,
      `在弹出的${label}页面里用任意方式登录，验证码由你本人完成`,
      '登录好后关掉窗口，在提示里点「已登录」。登录状态只保存在这台电脑上',
    ],
    checkEvery: 0,
    desktopSession: session,
  };
}

/**
 * SPEC-r13 §4b 通用模式: the 发布台 opens the platform's author entry page in the account's own window; the tile offers
 * 「复制标题」「复制正文」 and 「我已发布」. Nothing is typed into the page and nothing is clicked for the user.
 */
export function createGenericDeskAdapter(
  key: GenericDeskKey,
  opts: SessionAdapterOptions = {}
): Adapter<typeof genericDeskSchema> {
  const label = labelOf(key);
  const signed = GENERIC_SITE_SCRIPTS[key];
  return defineAdapter({
    key,
    label,
    runtimes: [
      {
        runtime: 'electron',
        mode: 'automation',
        needs: ['session'],
        note: `通用模式：在发布台打开${label}，复制标题和正文粘贴进去，由你点发布`,
      },
    ],
    contentTypes: ['article'],
    binding: genericDeskBinding(key),
    capabilities: { supportsUpdate: false, needsLogin: true },
    schema: genericDeskSchema,
    preview: ((doc, _form, common = {}) => {
      const r = renderGeneric(doc, common, opts.assetBase);
      return {
        format: 'html',
        title: r.title,
        body: r.html,
        report: r.report,
      } satisfies AdapterPreview;
    }) as NonNullable<Adapter<typeof genericDeskSchema>['preview']>,
    async publish({ doc, common, ctx }): Promise<PublishOutput> {
      ctx.emit({ type: 'progress', percent: 10, text: `读取${label}的站点脚本` });
      const run = await openSessionRun(ctx, key, label, signed, { ...opts, remoteScript: false });
      const { script } = run;
      const editorUrl = script.urls.write ?? script.urls.home;
      if (!ctx.handoff && !ctx.page)
        throw new PlatformSessionError('help', `${label}需要在辰记桌面端发布`, {
          helpUrl: script.urls.home,
        });
      if (!editorUrl) throw new PlatformSessionError('help', `${label}的站点脚本缺少入口地址`, {});
      const r = renderGeneric(doc, common, opts.assetBase);
      const report: ReportItem[] = [...r.report];
      ctx.emit({ type: 'progress', percent: 60, text: `在发布台打开${label}` });
      const res = await handOffEditor(ctx, run, label, {
        editorUrl,
        prefill: { title: r.title, html: r.html, text: r.text },
      });
      report.push(...handoffReport(res, label));
      report.push({
        kind: 'handoff.pending',
        text: `在${label}里打开写文章，点格子顶栏的「复制标题」「复制正文」粘贴进去，检查后自己点发布，再点「我已发布」并把文章链接贴回辰记`,
        level: 'notice',
      });
      ctx.emit({ type: 'progress', percent: 100, text: `等你在${label}里发布` });
      return { url: editorUrl, state: 'handoff', report };
    },
  });
}
