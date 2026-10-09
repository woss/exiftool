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

function splitLogical(expr: string): { terms: string[]; operators: ('and' | 'or')[] } {
  const terms: string[] = [];
  const operators: ('and' | 'or')[] = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < expr.length; index++) {
    if (expr[index] === "'" && expr[index - 1] !== '\\') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (expr[index] === '(') {
      depth++;
      continue;
    }
    if (expr[index] === ')') {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    let operator: 'and' | 'or' | undefined;
    let length = 0;
    if (expr.startsWith('&&', index)) {
      operator = 'and';
      length = 2;
    } else if (expr.startsWith('||', index)) {
      operator = 'or';
      length = 2;
    } else {
      const match = expr.slice(index).match(/^(and|or)\b/i);
      if (match && (index === 0 || /\s/.test(expr[index - 1]!))) {
        operator = match[1]!.toLowerCase() as 'and' | 'or';
        length = match[0].length;
      }
    }
    if (!operator) continue;
    terms.push(expr.slice(start, index));
    operators.push(operator);
    index += length - 1;
    start = index + 1;
  }
  terms.push(expr.slice(start));
  return { terms, operators };
}

function stripOuterParens(expr: string): string {
  let current = expr.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let quoted = false;
    let wrapsWholeExpression = true;
    for (let index = 0; index < current.length; index++) {
      if (current[index] === "'" && current[index - 1] !== '\\') {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (current[index] === '(') depth++;
      else if (current[index] === ')') {
        depth--;
        if (depth === 0 && index !== current.length - 1) {
          wrapsWholeExpression = false;
          break;
        }
      }
    }
    if (!wrapsWholeExpression || depth !== 0) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

/**
 * Evaluate `-if` comparisons joined by `and`/`or` or `&&`/`||`.
 * Comparisons support eq, ne, >, <, >=, <=; AND binds more tightly than OR.
 * Numeric comparison when both sides coerce to finite numbers, else string
 * comparison. Missing tags and malformed atomic expressions evaluate false.
 */
export function evalCondition(expr: string, tags: Record<string, TagValue>): boolean {
  const normalized = stripOuterParens(expr.trim());
  const { terms, operators } = splitLogical(normalized);
  if (operators.length === 0) return evalComparison(normalized, tags);
  let conjunction = evalCondition(terms[0] ?? '', tags);
  let disjunction = false;
  for (let index = 0; index < operators.length; index++) {
    const next = evalCondition(terms[index + 1] ?? '', tags);
    if (operators[index] === 'and') {
      conjunction = conjunction && next;
    } else {
      disjunction ||= conjunction;
      conjunction = next;
    }
  }
  return disjunction || conjunction;
}

function evalComparison(expr: string, tags: Record<string, TagValue>): boolean {
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
