import { z } from 'zod';

import { coreMessages } from './i18n/messages';
import { byLang, normalizeLang } from './i18n/lang';

import type { BindingSpec } from './binding';
import type { SdkLang } from './i18n/lang';
import type { Adapter, CommonFormShape } from './types';

/** `commonSchema` with its messages in `lang` (SPEC-r14 B5). */
export const commonSchemaFor = byLang((lang) => {
  const m = coreMessages(lang).schema;
  return z.object({
    title: z.string().max(200, m.titleMax).optional(),
    summary: z.string().max(500, m.summaryMax).optional(),
    /** Asset hash or URL of the cover image. */
    cover: z.string().optional(),
    /**
     * The same cover rendered for other surfaces, as asset hashes: `og` 1200×630 (share cards), `wide` 900×383
     * (公众号头条), `square` 1080×1080 (次条 / thumbnails), `portrait` 1080×1440 (小红书). Missing keys fall back to `cover`.
     */
    coverVariants: z
      .object({
        og: z.string().optional(),
        wide: z.string().optional(),
        square: z.string().optional(),
        portrait: z.string().optional(),
      })
      .optional(),
    /** Alt text of the cover (defaults to the title on the server). */
    coverAlt: z.string().max(255).optional(),
    tags: z.array(z.string()).optional(),
    /** ISO 8601; publish later instead of now. */
    scheduleAt: z.string().optional(),
  });
});

/** Fields every platform shares; adapters add their own through `Adapter.schema`. */
export const commonSchema = commonSchemaFor('zh-CN');

/**
 * SPEC-r14 B5: an adapter's form schema in `lang` (`Adapter.schemaFor`), else its plain `schema`. Use it for forms
 * (`zodFieldMeta` / `zodToAntdRules`) and validation, so labels and messages follow the user's language.
 */
export function adapterSchema<S extends z.ZodType>(
  adapter: Pick<Adapter<S>, 'schema' | 'schemaFor'>,
  lang?: SdkLang | string | null
): S {
  return lang && adapter.schemaFor ? adapter.schemaFor(normalizeLangOf(lang)) : adapter.schema;
}

/** SPEC-r14 B5: a binding's key form in `lang` (`BindingSpec.formFor`), else `form`. */
export function bindingForm(
  spec: Pick<BindingSpec, 'form' | 'formFor'> | undefined,
  lang?: SdkLang | string | null
): BindingSpec['form'] {
  if (!spec) return undefined;
  return lang && spec.formFor ? spec.formFor(normalizeLangOf(lang)) : spec.form;
}

/** SPEC-r14 B5: a binding's step-by-step help in `lang` (`BindingSpec.instructionsFor`), else `instructions`. */
export function bindingInstructions(
  spec: Pick<BindingSpec, 'instructions' | 'instructionsFor'> | undefined,
  lang?: SdkLang | string | null
): string[] | undefined {
  if (!spec) return undefined;
  return lang && spec.instructionsFor
    ? spec.instructionsFor(normalizeLangOf(lang))
    : spec.instructions;
}

export type CommonForm = z.infer<typeof commonSchema> & CommonFormShape;

/* ------------------------------------------------------------------------ */
/* zod introspection (works with zod 3.25+ and zod 4)                        */
/* ------------------------------------------------------------------------ */

export type FieldType = 'string' | 'number' | 'boolean' | 'enum';

export interface FieldMeta {
  name: string;
  type: FieldType;
  options?: string[];
  required: boolean;
  description?: string;
  /** Value from `.default()`, when there is one. */
  defaultValue?: unknown;
}

export interface AntdRule {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'enum';
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: unknown[];
  message?: string;
}

interface Check {
  kind: 'min' | 'max' | 'regex';
  value?: number;
  regex?: RegExp;
  message?: string;
}

interface Inspected {
  type: FieldType | 'unknown';
  required: boolean;
  options?: string[];
  checks: Check[];
  description?: string;
  defaultValue?: unknown;
  /** A custom `error` message on the schema itself (`z.union([...], { error: '请选择分类' })`). */
  customMessage?: string;
}

function defOf(schema: any): any {
  return schema?._zod?.def ?? schema?._def ?? {};
}

/** `'string'`, `'optional'`, … for both zod 3 (`typeName: 'ZodString'`) and zod 4 (`type: 'string'`). */
function kindOf(schema: any): string {
  const def = defOf(schema);
  if (typeof def.type === 'string') return def.type;
  if (typeof def.typeName === 'string') return def.typeName.replace(/^Zod/, '').toLowerCase();
  return 'unknown';
}

function messageOf(check: any): string | undefined {
  if (typeof check?.message === 'string') return check.message;
  const error = check?._zod?.def?.error ?? check?.error;
  if (typeof error === 'function') {
    try {
      const out = error({});
      if (typeof out === 'string') return out;
      if (out && typeof out.message === 'string') return out.message;
    } catch {
      /* not a plain message */
    }
  }
  return typeof error === 'string' ? error : undefined;
}

function checksOf(schema: any, type: FieldType): Check[] {
  const raw: any[] = defOf(schema).checks ?? [];
  const out: Check[] = [];
  for (const item of raw) {
    const message = messageOf(item);
    const d = item?._zod?.def ?? item;
    // zod 3
    if (typeof d.kind === 'string') {
      if (d.kind === 'min' || d.kind === 'max') out.push({ kind: d.kind, value: d.value, message });
      else if (d.kind === 'regex') out.push({ kind: 'regex', regex: d.regex, message });
      continue;
    }
    // zod 4
    switch (d.check) {
      case 'min_length':
        out.push({ kind: 'min', value: d.minimum, message });
        break;
      case 'max_length':
        out.push({ kind: 'max', value: d.maximum, message });
        break;
      case 'length_equals':
        out.push(
          { kind: 'min', value: d.length, message },
          { kind: 'max', value: d.length, message }
        );
        break;
      case 'greater_than':
        if (type === 'number') out.push({ kind: 'min', value: d.value, message });
        break;
      case 'less_than':
        if (type === 'number') out.push({ kind: 'max', value: d.value, message });
        break;
      case 'string_format':
        if (d.format === 'regex' && d.pattern)
          out.push({ kind: 'regex', regex: d.pattern, message });
        break;
      default:
        break;
    }
  }
  return out;
}

function inspect(schema: any): Inspected {
  let current = schema;
  let required = true;
  let defaultValue: unknown;
  let description: string | undefined = schema?.description;
  // Unwrap optional / default / nullable / effects wrappers.
  for (let i = 0; i < 8; i += 1) {
    const kind = kindOf(current);
    const def = defOf(current);
    if (kind === 'optional' || kind === 'nullable' || kind === 'nullish') {
      required = false;
    } else if (kind === 'default' || kind === 'prefault') {
      required = false;
      const dv = def.defaultValue;
      defaultValue = typeof dv === 'function' ? dv() : dv;
    } else if (kind === 'readonly' || kind === 'catch' || kind === 'effects' || kind === 'pipe') {
      // fall through to the inner type
    } else {
      break;
    }
    const inner = def.innerType ?? def.schema ?? def.in;
    if (!inner) break;
    description ??= inner.description;
    current = inner;
  }
  description ??= current?.description;
  const kind = kindOf(current);
  const def = defOf(current);
  const customMessage = messageOf(current) ?? messageOf(schema);
  if (kind === 'string')
    return {
      type: 'string',
      required,
      checks: checksOf(current, 'string'),
      description,
      defaultValue,
      customMessage,
    };
  if (kind === 'number' || kind === 'int' || kind === 'bigint')
    return {
      type: 'number',
      required,
      checks: checksOf(current, 'number'),
      description,
      defaultValue,
    };
  if (kind === 'boolean')
    return { type: 'boolean', required, checks: [], description, defaultValue };
  if (kind === 'enum' || kind === 'nativeenum') {
    const values: string[] = Array.isArray(def.values)
      ? def.values.map(String)
      : Object.values(def.entries ?? def.values ?? {}).map(String);
    return { type: 'enum', required, options: values, checks: [], description, defaultValue };
  }
  if (kind === 'literal') {
    const values = Array.isArray(def.values) ? def.values : [def.value];
    return {
      type: 'enum',
      required,
      options: values.map(String),
      checks: [],
      description,
      defaultValue,
    };
  }
  return { type: 'unknown', required, checks: [], description, defaultValue, customMessage };
}

function shapeOf(schema: any): Record<string, any> {
  const def = defOf(schema);
  const shape = def.shape ?? schema?.shape;
  return typeof shape === 'function' ? shape() : (shape ?? {});
}

/** Field name shown in default messages. */
function label(name: string, description?: string): string {
  return description ?? name;
}

/**
 * Turns a `z.object` into antd `Form.Item` rules per field. Handles string
 * min/max/regex/optional, number min/max, enum and boolean; custom zod
 * messages are kept, everything else gets a default in `opts.lang` (default `zh-CN`). Pass the schema in the
 * same language (`adapterSchema(adapter, lang)`) so the custom messages match.
 */
export function zodToAntdRules(
  schema: z.ZodType,
  opts: { lang?: SdkLang | string | null } = {}
): Record<string, AntdRule[]> {
  const m = coreMessages(opts.lang).schema;
  const out: Record<string, AntdRule[]> = {};
  for (const [name, field] of Object.entries(shapeOf(schema))) {
    const info = inspect(field);
    const rules: AntdRule[] = [];
    const min = info.checks.find((c) => c.kind === 'min');
    const requiredMessage =
      (info.type === 'string' && min && (min.value ?? 0) >= 1 && min.message) ||
      info.customMessage ||
      m.required(label(name, info.description));
    if (info.required) rules.push({ required: true, message: requiredMessage });
    switch (info.type) {
      case 'string':
        for (const check of info.checks) {
          if (check.kind === 'min') {
            // `min(1)` on a required string is already covered by `required`.
            if (info.required && (check.value ?? 0) <= 1) continue;
            rules.push({
              type: 'string',
              min: check.value,
              message: check.message ?? m.minChars(check.value ?? 0),
            });
          } else if (check.kind === 'max') {
            rules.push({
              type: 'string',
              max: check.value,
              message: check.message ?? m.maxChars(check.value ?? 0),
            });
          } else if (check.kind === 'regex' && check.regex) {
            rules.push({ pattern: check.regex, message: check.message ?? m.badFormat });
          }
        }
        break;
      case 'number':
        rules.push({ type: 'number', message: m.number });
        for (const check of info.checks) {
          if (check.kind === 'min')
            rules.push({
              type: 'number',
              min: check.value,
              message: check.message ?? m.notBelow(check.value ?? 0),
            });
          else if (check.kind === 'max')
            rules.push({
              type: 'number',
              max: check.value,
              message: check.message ?? m.notAbove(check.value ?? 0),
            });
        }
        break;
      case 'enum':
        rules.push({ type: 'enum', enum: info.options ?? [], message: m.validOption });
        break;
      case 'boolean':
        rules.push({ type: 'boolean', message: m.choose });
        break;
      default:
        break;
    }
    out[name] = rules;
  }
  return out;
}

/** One entry per field of a `z.object`, for rendering a form automatically. */
export function zodFieldMeta(schema: z.ZodType): FieldMeta[] {
  return Object.entries(shapeOf(schema)).map(([name, field]) => {
    const info = inspect(field);
    const meta: FieldMeta = {
      name,
      type: info.type === 'unknown' ? 'string' : info.type,
      required: info.required,
    };
    if (info.options) meta.options = info.options;
    if (info.description) meta.description = info.description;
    if (info.defaultValue !== undefined) meta.defaultValue = info.defaultValue;
    return meta;
  });
}

/**
 * Human-readable reasons from a failed `safeParse`. The messages come from the schema (parse with the schema of the
 * user's language, `adapterSchema(adapter, lang)`); `opts.lang` only picks the separator.
 */
export function formatZodError(
  error: unknown,
  opts: { lang?: SdkLang | string | null } = {}
): string {
  const issues: any[] = (error as any)?.issues ?? [];
  if (!issues.length) return error instanceof Error ? error.message : String(error);
  return issues
    .map((issue) => {
      const path =
        Array.isArray(issue.path) && issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join(coreMessages(opts.lang).schema.issueSeparator);
}

/** SPEC-r14 B5: a binding's permission list in `lang` (`BindingSpec.permissionsFor`), else `permissions`. */
export function bindingPermissions(
  spec: Pick<BindingSpec, 'permissions' | 'permissionsFor'> | undefined,
  lang?: SdkLang | string | null
): string[] | undefined {
  if (!spec) return undefined;
  return lang && spec.permissionsFor
    ? spec.permissionsFor(normalizeLangOf(lang))
    : spec.permissions;
}

/** SPEC-r14 B5: what to pick after binding, titles in `lang` (`BindingSpec.selectsFor`), else `selects`. */
export function bindingSelects(
  spec: Pick<BindingSpec, 'selects' | 'selectsFor'> | undefined,
  lang?: SdkLang | string | null
): BindingSpec['selects'] {
  if (!spec) return undefined;
  return lang && spec.selectsFor ? spec.selectsFor(normalizeLangOf(lang)) : spec.selects;
}

function normalizeLangOf(lang: SdkLang | string): SdkLang {
  return lang === 'zh-CN' || lang === 'zh-TW' || lang === 'en' ? lang : normalizeLang(lang);
}
