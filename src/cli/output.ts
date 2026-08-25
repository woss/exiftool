import type { FileInfo, TagGroups, TagValue } from '../types.ts';
import type { TagDb } from '../tag-db.ts';
import { escapeXML } from '../utils/encoding.ts';

export interface FormatOptions {
  /** Family number for group headings in tabular output (set by -g[NUM]) */
  groupHeadings?: string | boolean;
  /** Family number for group name prefix in all output formats (set by -G[NUM]) */
  groupPrefix?: string | boolean;
  /** Tag database for group name lookups */
  tagDb?: TagDb;
  /** Date format string (strftime-style tokens, set by -d FMT) */
  dateFormat?: string;
  /** Emit binary tags as base64 instead of the placeholder string (set by -b) */
  binary?: boolean;
}

function resolveFamily(opts: string | boolean | undefined, defaultFamily: string): string {
  if (typeof opts === 'string') return opts;
  return defaultFamily;
}

function getGroupName(tagName: string, family: string, tagDb?: TagDb): string {
  if (!tagDb) return '';
  const entry = tagDb.getByName(tagName);
  if (!entry) return '';
  const key = `family${family}` as keyof TagGroups;
  return entry.groups[key] ?? '';
}

const DATE_PATTERN = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;

export function formatDateValue(value: TagValue, fmt: string): TagValue {
  if (typeof value !== 'string') return value;
  const m = value.match(DATE_PATTERN);
  if (!m) return value;
  const [, y, mo, d, h, mi, s, frac] = m;
  let result = fmt;
  result = result.replace(/%Y/g, y);
  result = result.replace(/%m/g, mo);
  result = result.replace(/%d/g, d);
  result = result.replace(/%H/g, h);
  result = result.replace(/%M/g, mi);
  result = result.replace(/%S/g, s);
  result = result.replace(/%f/g, frac ?? '');
  return result;
}

export function formatJSON(files: FileInfo[], options?: FormatOptions): string {
  const prefixFamily = resolveFamily(options?.groupPrefix, '1');
  const arr: Record<string, TagValue>[] = [];
  for (const file of files) {
    const entry: Record<string, TagValue> = {};
    for (const [tag, value] of Object.entries(file.tags)) {
      if (value instanceof Uint8Array && value.length === 0) continue;
      let v: TagValue;
      if (value instanceof Uint8Array) {
        v = options?.binary ? toBase64(value) : binaryPlaceholder(value);
      } else {
        v = options?.dateFormat ? formatDateValue(value, options.dateFormat) : value;
      }
      if (options?.groupPrefix) {
        const group = getGroupName(tag, prefixFamily, options.tagDb);
        entry[group ? `${group}:${tag}` : tag] = v;
      } else {
        entry[tag] = v;
      }
    }
    arr.push(entry);
  }
  return JSON.stringify(arr, null, 2);
}

export function formatXML(files: FileInfo[], options?: FormatOptions): string {
  const prefixFamily = resolveFamily(options?.groupPrefix, '1');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<exiftool>\n';
  for (const file of files) {
    xml += `  <file name="${escapeXML(file.path)}">\n`;
    for (const [tag, value] of Object.entries(file.tags)) {
      const raw = binaryTagToString(value, options);
      const str = options?.dateFormat ? binaryTagToString(formatDateValue(value, options.dateFormat), options) : raw;
      let tagName = tag;
      if (options?.groupPrefix) {
        const group = getGroupName(tag, prefixFamily, options.tagDb);
        if (group) tagName = `${group}:${tag}`;
      }
      xml += `    <tag name="${escapeXML(tagName)}">${escapeXML(str)}</tag>\n`;
    }
    xml += '  </file>\n';
  }
  xml += '</exiftool>\n';
  return xml;
}

export function formatCSV(files: FileInfo[], options?: FormatOptions): string {
  const prefixFamily = resolveFamily(options?.groupPrefix, '1');
  // Collect all tag names across files (with optional prefix)
  const allTags = new Set<string>();
  for (const file of files) {
    for (const tag of Object.keys(file.tags)) {
      const resolvedTag = options?.groupPrefix
        ? ((group) => group ? `${group}:${tag}` : tag)(getGroupName(tag, prefixFamily, options.tagDb))
        : tag;
      allTags.add(resolvedTag);
    }
  }
  const sortedTags = [...allTags].sort();

  const rows = [
    ['SourceFile', ...sortedTags].join(','),
  ];

  for (const file of files) {
    const row = [file.path];
    // Build a map of resolved-key -> value for this file
    const valueMap = new Map<string, TagValue>();
    for (const [tag, value] of Object.entries(file.tags)) {
      const resolvedTag = options?.groupPrefix
        ? ((group) => group ? `${group}:${tag}` : tag)(getGroupName(tag, prefixFamily, options.tagDb))
        : tag;
      const val = value instanceof Uint8Array
        ? (options?.binary ? toBase64(value) : binaryPlaceholder(value))
        : (options?.dateFormat ? formatDateValue(value, options.dateFormat) : value);
      valueMap.set(resolvedTag, val);
    }
    for (const tag of sortedTags) {
      const val = valueMap.get(tag);
      row.push(val !== undefined ? `"${String(val).replace(/"/g, '""')}"` : '');
    }
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

export function formatTabular(files: FileInfo[], options?: FormatOptions): string {
  const lines: string[] = [];
  const headingsFamily = resolveFamily(options?.groupHeadings, '0');
  const prefixFamily = resolveFamily(options?.groupPrefix, '1');
  const useHeadings = !!options?.groupHeadings;
  const usePrefix = !!options?.groupPrefix;

  for (const file of files) {
    if (useHeadings && options?.tagDb) {
      // Group tags by family for headings
      const groups = new Map<string, [string, TagValue][]>();
      for (const [tag, value] of Object.entries(file.tags)) {
        const group = getGroupName(tag, headingsFamily, options.tagDb);
        const key = group || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push([tag, value]);
      }
      for (const [groupName, tags] of groups) {
        lines.push(`------ GROUP:${groupName || '(unknown)'} ----`);
        for (const [tag, value] of tags) {
          let displayTag = tag;
          if (usePrefix) {
            const prefix = getGroupName(tag, prefixFamily, options.tagDb);
            if (prefix) displayTag = `${prefix}:${tag}`;
          }
          const displayValue = options?.dateFormat ? formatDateValue(value, options.dateFormat) : value;
          lines.push(`${displayTag}\t${tagValueToString(displayValue)}`);
        }
      }
    } else {
      for (const [tag, value] of Object.entries(file.tags)) {
        let displayTag = tag;
        if (usePrefix) {
          const group = getGroupName(tag, prefixFamily, options.tagDb);
          if (group) displayTag = `${group}:${tag}`;
        }
        const displayValue = options?.dateFormat ? formatDateValue(value, options.dateFormat) : value;
        lines.push(`${displayTag}\t${tagValueToString(displayValue)}`);
      }
    }
  }
  return lines.join('\n');
}

function tagValueToString(value: TagValue): string {
  if (value === null || value === undefined) return '-';
  if (value instanceof Uint8Array) return binaryPlaceholder(value);
  if (Array.isArray(value)) return value.map(tagValueToString).join(', ');
  return String(value);
}

function binaryTagToString(value: TagValue, options?: FormatOptions): string {
  if (value instanceof Uint8Array) {
    return options?.binary ? toBase64(value) : binaryPlaceholder(value);
  }
  return tagValueToString(value);
}

function binaryPlaceholder(value: Uint8Array): string {
  return `(Binary data ${value.length} bytes, use -b option to extract)`;
}

function toBase64(value: Uint8Array): string {
  let str = '';
  const chunkSize = 0x8000; // avoid arg-limit blowup on large arrays
  for (let i = 0; i < value.length; i += chunkSize) {
    str += String.fromCharCode(...value.subarray(i, i + chunkSize));
  }
  return btoa(str);
}
