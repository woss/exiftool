import type { TagValue } from '../types.js';

const CONDITION_RE = /^\$([A-Za-z0-9_]+)\s*(>=|<=|eq|ne|>|<)\s*(.+)$/;

type ConditionOp = 'eq' | 'ne' | '>' | '<' | '>=' | '<=';

function coerceNumber(s: string): number | undefined {
  const trimmed = s.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function lookupTag(name: string, tags: Record<string, TagValue>): TagValue | undefined {
  if (name in tags) return tags[name];
  const lower = name.toLowerCase();
  const key = Object.keys(tags).find((k) => k.toLowerCase() === lower);
  return key !== undefined ? tags[key] : undefined;
}

function compare(op: ConditionOp, a: number | string, b: number | string): boolean {
  switch (op) {
    case 'eq':
      return a === b;
    case 'ne':
      return a !== b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
  }
}

/**
 * Evaluate one `-if` condition expression against a file's tags.
 * Grammar: `$TagName OP value` with ops eq, ne, >, <, >=, <=.
 * Numeric comparison when both sides coerce to finite numbers, else string
 * comparison. Missing tag → false.
 */
export function evalCondition(expr: string, tags: Record<string, TagValue>): boolean {
  const m = expr.trim().match(CONDITION_RE);
  if (!m) return false;
  const [, tagName, rawOp, rawValue] = m;
  const op = rawOp as ConditionOp;
  const quoted = rawValue.match(/^'(.*)'$/s);
  const value = quoted ? quoted[1] : rawValue.trim();

  const target = lookupTag(tagName, tags);
  if (target === undefined || target === null) return false;

  const actualStr = target instanceof Uint8Array ? '' : Array.isArray(target)
    ? target.map((v) => String(v)).join(', ')
    : String(target);

  const actualNum = target instanceof Uint8Array ? undefined : typeof target === 'number'
    ? target
    : coerceNumber(actualStr);
  const valueNum = coerceNumber(value);

  if (actualNum !== undefined && valueNum !== undefined) {
    return compare(op, actualNum, valueNum);
  }
  return compare(op, actualStr, value);
}
