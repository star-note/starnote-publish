import { z } from 'zod';

import type { CommonFormShape } from './types';

/** Fields every platform shares; adapters add their own through `Adapter.schema`. */
export const commonSchema = z.object({
  title: z.string().max(200, '标题最多 200 个字符').optional(),
  summary: z.string().max(500, '摘要最多 500 个字符').optional(),
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
 * messages are kept, everything else gets a Chinese default.
 */
export function zodToAntdRules(schema: z.ZodType): Record<string, AntdRule[]> {
  const out: Record<string, AntdRule[]> = {};
  for (const [name, field] of Object.entries(shapeOf(schema))) {
    const info = inspect(field);
    const rules: AntdRule[] = [];
    const min = info.checks.find((c) => c.kind === 'min');
    const requiredMessage =
      (info.type === 'string' && min && (min.value ?? 0) >= 1 && min.message) ||
      info.customMessage ||
      `请填写${label(name, info.description)}`;
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
              message: check.message ?? `至少 ${check.value} 个字符`,
            });
          } else if (check.kind === 'max') {
            rules.push({
              type: 'string',
              max: check.value,
              message: check.message ?? `最多 ${check.value} 个字符`,
            });
          } else if (check.kind === 'regex' && check.regex) {
            rules.push({ pattern: check.regex, message: check.message ?? '格式不正确' });
          }
        }
        break;
      case 'number':
        rules.push({ type: 'number', message: '请输入数字' });
        for (const check of info.checks) {
          if (check.kind === 'min')
            rules.push({
              type: 'number',
              min: check.value,
              message: check.message ?? `不能小于 ${check.value}`,
            });
          else if (check.kind === 'max')
            rules.push({
              type: 'number',
              max: check.value,
              message: check.message ?? `不能大于 ${check.value}`,
            });
        }
        break;
      case 'enum':
        rules.push({ type: 'enum', enum: info.options ?? [], message: '请选择有效的选项' });
        break;
      case 'boolean':
        rules.push({ type: 'boolean', message: '请选择' });
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

/** Human-readable reasons from a failed `safeParse`. */
export function formatZodError(error: unknown): string {
  const issues: any[] = (error as any)?.issues ?? [];
  if (!issues.length) return error instanceof Error ? error.message : String(error);
  return issues
    .map((issue) => {
      const path =
        Array.isArray(issue.path) && issue.path.length ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('；');
}
