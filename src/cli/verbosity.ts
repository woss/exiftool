import type { FileInfo, TagValue } from '../types.ts';

/** Render a tag value for verbose stderr output. */
export function renderTagValue(value: TagValue): string {
  if (value instanceof Uint8Array) return `[${value.length} bytes]`;
  if (value === null) return '';
  if (Array.isArray(value)) return value.map((v) => renderTagValue(v)).join(', ');
  return String(value);
}

/** Build the stderr lines for one file at the given verbosity level (>=1). */
export function verboseLines(info: FileInfo, level: number): string[] {
  const lines = [
    `[verbose] ${info.path}: ${Object.keys(info.tags).length} tags (${info.format})`,
  ];
  if (level >= 2) {
    for (const [tag, value] of Object.entries(info.tags)) {
      lines.push(`  ${tag}: ${renderTagValue(value)}`);
    }
  }
  return lines;
}
