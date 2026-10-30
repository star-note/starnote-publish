import {
  bundledScript,
  defineAdapter,
  HANDOFF_FILLED_TEXT,
  handOffEditor,
  handoffFilledText,
  handoffReport,
  localizedLabel,
  openSessionRun,
  PlatformSessionError,
  rehostImages,
} from '@starnote/publish-core';

import { msg } from './i18n';
import { renderCsdn, withImages } from './render';
import { CSDN_ARTICLE_TYPES, csdnSchema, csdnSchemaFor } from './schema';
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
  instructions: msg('zh-CN').binding,
  instructionsFor: (lang) => msg(lang).binding,
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
    ((doc, _form, common = {}, _content, popts) => {
      const r = renderCsdn(doc, common, script, popts?.lang);
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
        note: msg('zh-CN').runtimeNote,
        notes: { 'zh-TW': msg('zh-TW').runtimeNote, en: msg('en').runtimeNote },
      },
    ],
    contentTypes: ['article'],
    binding: csdnBinding,
    capabilities: { supportsUpdate: false, titleMax: 100, needsLogin: true },
    schema: csdnSchema,
    schemaFor: csdnSchemaFor,
    preview: preview(bundledScript(CSDN_SITE_SCRIPT)),
    async publish({ doc, form, common, ctx }): Promise<PublishOutput> {
      const lang = ctx.lang;
      const t = msg(lang);
      const name = localizedLabel('csdn', LABEL, lang);
      const L = lang ? { lang } : {};
      ctx.emit({ type: 'progress', percent: 5, text: t.readScript });
      const run = await openSessionRun(ctx, 'csdn', LABEL, CSDN_SITE_SCRIPT, opts);
      const { script, client } = run;
      const helpUrl = script.urls.help;
      if (!ctx.handoff && !ctx.page)
        throw new PlatformSessionError('help', t.desktopOnly, { helpUrl, ...L });
      const editorSelector = script.selectors.editor;
      if (!editorSelector || !script.urls.editor)
        throw new PlatformSessionError('help', t.noEditorConfig, { helpUrl, ...L });

      const r = renderCsdn(doc, common, script, lang);
      const report: ReportItem[] = [...r.report];
      ctx.emit({ type: 'report', items: report });

      let map = new Map<string, string>();
      if (r.images.length && client.has('imagePolicy') && client.has('imageUpload')) {
        ctx.emit({ type: 'progress', percent: 15, text: t.uploadingImages });
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
          label: name,
          ...L,
          ...(opts.assetBase ? { assetBase: opts.assetBase } : {}),
          onProgress: (done, total) =>
            ctx.emit({
              type: 'progress',
              percent: 15 + Math.round((done / total) * 45),
              text: t.uploadProgress(done, total),
            }),
        });
        map = res.map;
        report.push(...res.report);
      } else if (r.images.length) {
        report.push({
          kind: 'image.failed',
          text: t.imagesNotUploaded(r.images.length),
          count: r.images.length,
          level: 'warn',
        });
      }
      ctx.emit({ type: 'report', items: report });

      // 第 3 层：发布台（或单个窗口）里打开 CSDN 编辑器，insertText 填标题、剪贴板粘贴正文，由 CSDN 编辑器自己的粘贴逻辑
      // 处理；原剪贴板由桌面端恢复。不在页面里执行脚本，也不点「发布文章」。
      ctx.emit({ type: 'progress', percent: 70, text: t.openingEditor });
      const res = await handOffEditor(ctx, run, LABEL, {
        editorUrl: script.urls.editor,
        prefill: { title: r.title, text: withImages(r, map) },
      });
      report.push(...handoffReport(res, name, lang));
      // 我们做了什么（SPEC-r15）：填好的项；标签、文章类型、创作声明只能在 CSDN 的发布弹窗里选，给出建议和提醒
      report.push({ kind: 'fields.prefilled', text: t.filled(map.size), level: 'info' });
      const tagsMax = script.limits?.tagsMax ?? 7;
      const tags = [...new Set((common.tags ?? []).map((x) => x.replace(/^#/, '').trim()))]
        .filter(Boolean)
        .slice(0, tagsMax);
      report.push({ kind: 'tags.manual', text: t.pickTags(tags, tagsMax), level: 'notice' });
      report.push({
        kind: 'declarations.user',
        text: t.chooseDeclarations(
          form.article_type ? CSDN_ARTICLE_TYPES[form.article_type] : '',
          form.article_type === 'repost' && form.original_url ? form.original_url : ''
        ),
        level: 'notice',
      });
      report.push({
        kind: 'handoff.pending',
        text: t.finish(lang ? handoffFilledText(lang) : HANDOFF_FILLED_TEXT),
        level: 'notice',
      });
      ctx.emit({ type: 'progress', percent: 100, text: t.waitingPublish });
      return { url: script.urls.editor, state: 'handoff', report };
    },
  });
}
