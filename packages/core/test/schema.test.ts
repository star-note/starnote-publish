import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import { describe, expect, it } from 'vitest';

import { commonSchema, formatZodError, zodFieldMeta, zodToAntdRules } from '../src/schema';

describe.each([
  ['zod 4', z as unknown as typeof z3],
  ['zod 3', z3],
])('zodToAntdRules (%s)', (_name, zz) => {
  const schema = zz.object({
    category_id: zz.string().min(1, '请选择分类'),
    slug: zz
      .string()
      .min(3)
      .max(24)
      .regex(/^[a-z0-9_]+$/, '只能用小写字母、数字和下划线')
      .optional(),
    visibility: zz.enum(['public', 'link', 'group']).default('public'),
    show_in_blog: zz.boolean().default(true),
    weight: zz.number().min(0).max(100).describe('权重'),
    note: zz.string().optional(),
  });

  it('maps string / number / enum / boolean fields to antd rules', () => {
    const rules = zodToAntdRules(schema);
    expect(rules.category_id).toEqual([{ required: true, message: '请选择分类' }]);
    expect(rules.slug).toEqual([
      { type: 'string', min: 3, message: expect.stringContaining('3') },
      { type: 'string', max: 24, message: expect.stringContaining('24') },
      { pattern: /^[a-z0-9_]+$/, message: '只能用小写字母、数字和下划线' },
    ]);
    expect(rules.visibility).toEqual([
      { type: 'enum', enum: ['public', 'link', 'group'], message: '请选择有效的选项' },
    ]);
    expect(rules.show_in_blog).toEqual([{ type: 'boolean', message: '请选择' }]);
    expect(rules.weight).toEqual([
      { required: true, message: '请填写权重' },
      { type: 'number', message: '请输入数字' },
      { type: 'number', min: 0, message: expect.stringContaining('0') },
      { type: 'number', max: 100, message: expect.stringContaining('100') },
    ]);
    expect(rules.note).toEqual([]);
  });

  it('uses a schema-level custom error as the required message of non-primitive fields', () => {
    const picker = zz.object({
      category: zz
        .union([zz.object({ id: zz.string() }), zz.object({ name: zz.string() })], {
          error: '请选择分类',
        } as never)
        .describe('分类'),
      extra: zz.object({ a: zz.string() }).describe('附加').optional(),
    });
    const rules = zodToAntdRules(picker);
    // zod 3 has no `error` option: the description-based default stays.
    expect(rules.category[0].required).toBe(true);
    expect(['请选择分类', '请填写分类']).toContain(rules.category[0].message);
    expect(rules.extra).toEqual([]);
    expect(zodFieldMeta(picker)[0]).toEqual({
      name: 'category',
      type: 'string',
      required: true,
      description: '分类',
    });
  });

  it('describes fields for auto-rendered forms', () => {
    expect(zodFieldMeta(schema)).toEqual([
      { name: 'category_id', type: 'string', required: true },
      { name: 'slug', type: 'string', required: false },
      {
        name: 'visibility',
        type: 'enum',
        options: ['public', 'link', 'group'],
        required: false,
        defaultValue: 'public',
      },
      { name: 'show_in_blog', type: 'boolean', required: false, defaultValue: true },
      { name: 'weight', type: 'number', required: true, description: '权重' },
      { name: 'note', type: 'string', required: false },
    ]);
  });
});

describe('commonSchema', () => {
  it('accepts an empty form and rejects an oversized title', () => {
    expect(commonSchema.safeParse({}).success).toBe(true);
    const bad = commonSchema.safeParse({ title: 'x'.repeat(201) });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(formatZodError(bad.error)).toBe('title: 标题最多 200 个字符');
  });

  it('turns into rules too', () => {
    const rules = zodToAntdRules(commonSchema);
    expect(rules.title).toEqual([{ type: 'string', max: 200, message: '标题最多 200 个字符' }]);
    expect(rules.tags).toEqual([]);
  });
});
