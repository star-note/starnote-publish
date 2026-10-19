import {
  bundledScript,
  defineAdapter,
  HANDOFF_FILLED_TEXT,
  handOffEditor,
  handoffReport,
  openSessionRun,
  PlatformSessionError,
  rehostImages,
} from '@starnote/publish-core';

import { renderCsdn, withImages } from './render';
import { CSDN_ARTICLE_TYPES, csdnSchema } from './schema';
import bundledSigned from './site-script.signed.json';

import type {
  Adapter,
  AdapterPreview,
  BindingSpec,
  PublishOutput,
  ReportItem,
  RuntimeSupport,
  SessionAdapterOptions,
  SignedSiteScript,
  SiteScript,
} from '@starnote/publish-core';

export const CSDN_SITE_SCRIPT = bundledSigned as SignedSiteScript;
const LABEL = 'CSDN';

export const csdnBinding: BindingSpec = {
  kind: 'cookie',
  store: 'desktop',
  helpUrl: 'https://mp.csdn.net/',
  instructions: [
    '在辰记桌面端点「在桌面端登录 CSDN」',
    '在弹出的 CSDN 登录页里用任意方式登录，验证码由你本人完成',
    '登录成功后窗口自动关闭，登录状态只保存在这台电脑上',
  ],
  checkEvery: 6 * 3600,
  desktopSession: bundledScript(CSDN_SITE_SCRIPT).session!,
};

export interface CsdnAdapterOptions extends SessionAdapterOptions {
  runtimes?: RuntimeSupport[];
}

function imageSuffix(url: string): string {
  const m = /\.(png|jpe?g|gif|webp)(?:[?#]|$)/i.exec(url);
  const ext = m ? m[1]!.toLowerCase() : 'png';
  return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * 页面操作层级：第 1 层（imgservice 上传图片，只需登录态）+ 第 3 层（打开编辑器，剪贴板粘贴正文、insertText 填标题，
 * 用户点「发布文章」）。
 *
 * CSDN is a hand-off: its save / publish API needs an `x-ca-signature` computed by CSDN's own front-end, which
 * we do not reproduce. We upload the images (imgservice needs only the login), open CSDN's Markdown editor in
 * the account's window, fill in the title and body, and leave「发布文章」to the user.
 */
export function createCsdnAdapter(opts: CsdnAdapterOptions = {}): Adapter<typeof csdnSchema> {
  const preview = (script: SiteScript) =>
    ((doc, _form, common = {}) => {
      const r = renderCsdn(doc, common, script);
      return {
        format: 'markdown',
        title: r.title,
        body: r.markdown,
        report: r.report,
      } satisfies AdapterPreview;
    }) as NonNullable<Adapter<typeof csdnSchema>['preview']>;

  return defineAdapter({
    key: 'csdn',
    label: LABEL,
    runtimes: opts.runtimes ?? [
      {
        runtime: 'electron',
        // Runs here on the desktop (planRuntime → run-here); the outcome is `state: 'handoff'`.
        mode: 'automation',
        needs: ['session'],
        note: '第 3 层（交接）：打开 CSDN 编辑器粘贴好内容，由你点「发布文章」',
      },
    ],
    contentTypes: ['article'],
    binding: csdnBinding,
    capabilities: { supportsUpdate: false, titleMax: 100, needsLogin: true },
    schema: csdnSchema,
    preview: preview(bundledScript(CSDN_SITE_SCRIPT)),
    async publish({ doc, form, common, ctx }): Promise<PublishOutput> {
      ctx.emit({ type: 'progress', percent: 5, text: '读取 CSDN 站点脚本' });
      const run = await openSessionRun(ctx, 'csdn', LABEL, CSDN_SITE_SCRIPT, opts);
      const { script, client } = run;
      const helpUrl = script.urls.help;
      if (!ctx.handoff && !ctx.page)
        throw new PlatformSessionError('help', 'CSDN 需要在桌面端打开编辑器发布', { helpUrl });
      const editorSelector = script.selectors.editor;
      if (!editorSelector || !script.urls.editor)
        throw new PlatformSessionError('help', 'CSDN 站点脚本缺少编辑器配置', { helpUrl });

      const r = renderCsdn(doc, common, script);
      const report: ReportItem[] = [...r.report];
      ctx.emit({ type: 'report', items: report });

      let map = new Map<string, string>();
      if (r.images.length && client.has('imagePolicy') && client.has('imageUpload')) {
        ctx.emit({ type: 'progress', percent: 15, text: '上传图片到 CSDN' });
        const upload = async (url: string) => {
          const suffix = imageSuffix(url);
          const policy = (await client.call('imagePolicy', { vars: { suffix } })).result;
          const { host, ...fields } = policy;
          if (typeof host !== 'string' || !/^https:\/\//.test(host)) return undefined;
          const res = await client.call('imageUpload', {
            vars: { host },
            data: fields,
            files: { file: { kind: 'url', url, name: `image.${suffix}` } },
          });
          return typeof res.result.url === 'string' ? res.result.url : undefined;
        };
        const res = await rehostImages(r.images, upload, {
          label: LABEL,
          ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
          onProgress: (done, total) =>
            ctx.emit({
              type: 'progress',
              percent: 15 + Math.round((done / total) * 45),
              text: `上传图片 ${done}/${total}`,
            }),
        });
        map = res.map;
        report.push(...res.report);
      } else if (r.images.length) {
        report.push({
          kind: 'image.failed',
          text: `${r.images.length} 张图片没有预先上传，已保留原图链接；CSDN 编辑器粘贴时会尝试转存`,
          count: r.images.length,
          level: 'warn',
        });
      }
      ctx.emit({ type: 'report', items: report });

      // 第 3 层：发布台（或单个窗口）里打开 CSDN 编辑器，insertText 填标题、剪贴板粘贴正文，由 CSDN 编辑器自己的粘贴逻辑
      // 处理；原剪贴板由桌面端恢复。不在页面里执行脚本，也不点「发布文章」。
      ctx.emit({ type: 'progress', percent: 70, text: '打开 CSDN 编辑器' });
      const res = await handOffEditor(ctx, run, LABEL, {
        editorUrl: script.urls.editor,
        prefill: { title: r.title, text: withImages(r, map) },
      });
      report.push(...handoffReport(res, LABEL));
      const type = CSDN_ARTICLE_TYPES[form.article_type];
      report.push({
        kind: 'handoff.pending',
        text: `${HANDOFF_FILLED_TEXT}：在 CSDN 编辑器里点「发布文章」，文章类型选「${type}」${
          form.article_type === 'repost' && form.original_url
            ? `并填写原文链接 ${form.original_url}`
            : ''
        }，再选标签和分类专栏`,
        level: 'notice',
      });
      ctx.emit({ type: 'progress', percent: 100, text: '等你在 CSDN 编辑器里发布' });
      return { url: script.urls.editor, state: 'handoff', report };
    },
  });
}
