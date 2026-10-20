/**
 * Learned rules (SPEC-r8 §12.9 / SPEC-r9-compliance-learning): what the backend distilled from real platform
 * rejections and failures. The SDK stays the judge — `checkCompliance(platform, doc, extraRules)` merges them
 * with the built-in `rules` — the backend only learns and ships them (user-level rules for the author who hit
 * them, global ones after an admin approved; global ones travel inside the signed site script as `learnedRules`).
 * Nothing here blocks publishing: every item is a suggestion.
 */
import type { ComplianceField, ComplianceInput, ComplianceItem } from './compliance';

export interface LearnedRulePattern {
  /** `keyword`: substring (case-insensitive); `regex`: a JS / Python-compatible source; `semantic`: AI judges. */
  type: 'keyword' | 'regex' | 'semantic';
  value: string;
}

export interface LearnedRule {
  id: string;
  platform: string;
  /** 违规类型: contact | external-link | ad-law | sensitive | title | length | format | other … */
  category: string;
  pattern: LearnedRulePattern;
  /** 建议改法 (中文). */
  suggestion: string;
  /** 0–1. */
  confidence: number;
  /** `user`: learned from this author's own feedback; `global`: approved by an admin for everyone. */
  source?: 'user' | 'global';
  hits?: number;
}

const FIELDS: ComplianceField[] = ['title', 'summary', 'body'];

function around(text: string, index: number, length: number, pad = 8): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`.replace(/\s+/g, ' ');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexOf(p: LearnedRulePattern): RegExp | null {
  if (!p.value) return null;
  try {
    return new RegExp(p.type === 'regex' ? p.value : escapeRe(p.value), 'gi');
  } catch {
    return null;
  }
}

/**
 * Items of the learned rules that apply to `input.platform` (a rule whose `platform` is `*` applies everywhere).
 * Keyword / regex rules point at the match; semantic rules add one `needsAi` item for the AI to judge in context.
 * Ids are stable per rule + match, so 「忽略」 survives re-runs.
 */
export function checkLearnedRules(
  input: Pick<ComplianceInput, 'platform' | 'title' | 'summary' | 'text'>,
  rules: readonly LearnedRule[] | undefined
): ComplianceItem[] {
  const out: ComplianceItem[] = [];
  if (!rules?.length) return out;
  const texts: [ComplianceField, string | undefined][] = [
    ['title', input.title],
    ['summary', input.summary],
    ['body', input.text],
  ];
  for (const rule of rules) {
    if (rule.platform !== input.platform && rule.platform !== '*') continue;
    const learned = { id: rule.id, source: rule.source ?? 'global' } as const;
    const base = `learned:${rule.id}`;
    const note = rule.source === 'user' ? '根据你近期的发布反馈' : '根据近期发布反馈';
    if (rule.pattern.type === 'semantic') {
      const text = texts.map(([, v]) => v ?? '').join('\n').trim();
      if (!text) continue;
      out.push({
        id: base,
        rule: 'learned',
        field: 'body',
        level: 'info',
        message: `${note}：${rule.pattern.value}。${rule.suggestion}`,
        needsAi: true,
        learned,
      });
      continue;
    }
    const re = regexOf(rule.pattern);
    if (!re) continue;
    let n = 0;
    for (const field of FIELDS) {
      const value = texts.find(([f]) => f === field)?.[1];
      if (!value) continue;
      for (const m of value.matchAll(re)) {
        if (!m[0]) continue;
        out.push({
          id: `${base}:${field}:${n++}`,
          rule: 'learned',
          field,
          level: rule.confidence >= 0.85 ? 'warn' : 'info',
          message: `${note}：「${m[0]}」在${platformWord(rule.platform)}曾被驳回。${rule.suggestion}`,
          excerpt: around(value, m.index!, m[0].length),
          fix: { kind: 'replace', from: m[0], to: '' },
          needsAi: true,
          learned,
        });
      }
    }
  }
  return out;
}

function platformWord(platform: string): string {
  return platform === '*' ? '多个平台' : '这个平台';
}
