import type { FileInfo, TagValue } from '../types.ts';
import { escapeXML } from '../utils/encoding.ts';

export function formatJSON(files: FileInfo[]): string {
  const obj: Record<string, unknown> = {};
  for (const file of files) {
    obj[file.path] = file.tags;
  }
  return JSON.stringify(obj, null, 2);
}

export function formatXML(files: FileInfo[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<exiftool>\n';
  for (const file of files) {
    xml += `  <file name="${escapeXML(file.path)}">\n`;
    for (const [tag, value] of Object.entries(file.tags)) {
      const str = tagValueToString(value);
      xml += `    <tag name="${escapeXML(tag)}">${escapeXML(str)}</tag>\n`;
    }
    xml += '  </file>\n';
  }
  xml += '</exiftool>\n';
  return xml;
}

export function formatCSV(files: FileInfo[]): string {
  const allTags = new Set<string>();
  for (const file of files) {
    for (const tag of Object.keys(file.tags)) {
      allTags.add(tag);
    }
  }
  const sortedTags = [...allTags].sort();

  const rows = [
    ['SourceFile', ...sortedTags].join(','),
  ];

  for (const file of files) {
    const row = [file.path];
    for (const tag of sortedTags) {
      const val = file.tags[tag];
      row.push(val !== undefined ? `"${String(val).replace(/"/g, '""')}"` : '');
    }
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

export function formatTabular(files: FileInfo[]): string {
  const lines: string[] = [];
  for (const file of files) {
    for (const [tag, value] of Object.entries(file.tags)) {
      lines.push(`${tag}\t${tagValueToString(value)}`);
    }
  }
  return lines.join('\n');
}

function tagValueToString(value: TagValue): string {
  if (value === null || value === undefined) return '-';
  if (value instanceof Uint8Array) return `[${value.length} bytes]`;
  if (Array.isArray(value)) return value.map(tagValueToString).join(', ');
  return String(value);
}
