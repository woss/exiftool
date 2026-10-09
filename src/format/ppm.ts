import type { FormatParser } from './mod.js';
import type { FileInfo, TagValue, WriteOutcome } from '../types.js';
import { UnsupportedFormatError } from '../write/writers.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface PpmHeader {
  type: 'PPM';
  magic: 'P3' | 'P6';
  width: number;
  height: number;
  maxValue: number;
  comments: string[];
  dataOffset: number;
}

function isWhitespace(value: number): boolean {
  return value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0b || value === 0x0c || value === 0x0d;
}

function parseHeader(bytes: Uint8Array): PpmHeader | undefined {
  if (bytes.length < 3 || bytes[0] !== 0x50 || (bytes[1] !== 0x33 && bytes[1] !== 0x36)) return undefined;
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!) as 'P3' | 'P6';
  const comments: string[] = [];
  let offset = 2;

  const token = (): string | undefined => {
    for (;;) {
      while (offset < bytes.length && isWhitespace(bytes[offset]!)) offset++;
      if (offset >= bytes.length) return undefined;
      if (bytes[offset] !== 0x23) break;
      const start = ++offset;
      while (offset < bytes.length && bytes[offset] !== 0x0a && bytes[offset] !== 0x0d) offset++;
      comments.push(decoder.decode(bytes.subarray(start, offset)));
    }
    const start = offset;
    while (offset < bytes.length && !isWhitespace(bytes[offset]!) && bytes[offset] !== 0x23) offset++;
    if (start === offset) return undefined;
    return decoder.decode(bytes.subarray(start, offset));
  };

  const widthRaw = token();
  const heightRaw = token();
  const maxRaw = magic === 'P6' || magic === 'P3' ? token() : undefined;
  if (!widthRaw || !heightRaw || !maxRaw || !/^\d+$/.test(widthRaw) || !/^\d+$/.test(heightRaw) || !/^\d+$/.test(maxRaw)) {
    return undefined;
  }
  if (offset >= bytes.length || !isWhitespace(bytes[offset]!)) return undefined;
  if (bytes[offset] === 0x0d && bytes[offset + 1] === 0x0a) offset += 2;
  else offset++;

  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const maxValue = Number(maxRaw);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isSafeInteger(maxValue) ||
      width < 1 || height < 1 || maxValue < 1 || maxValue > 65535) return undefined;
  return { type: 'PPM', magic, width, height, maxValue, comments, dataOffset: offset };
}

function commentText(comments: string[]): string | undefined {
  if (comments.length === 0) return undefined;
  return comments.map((comment) => comment.replace(/^ ?/, '')).join('\n').replace(/[\r\n]+$/, '');
}

export const ppmParser: FormatParser = {
  format: 'PPM',
  extensions: ['.ppm', '.pnm'],
  canParse(bytes: Uint8Array): boolean {
    return parseHeader(bytes) !== undefined;
  },
  parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
    const header = parseHeader(bytes);
    if (!header) throw new UnsupportedFormatError('not a supported PPM stream');
    const tags: Record<string, TagValue> = {
      ImageWidth: header.width,
      ImageHeight: header.height,
      MaxVal: header.maxValue,
      FileType: 'PPM',
      MIMEType: 'image/x-portable-pixmap',
      FileName: filePath.split('/').pop() ?? filePath,
    };
    const comment = commentText(header.comments);
    if (comment !== undefined) tags.Comment = comment;
    return Promise.resolve({ path: filePath, format: 'PPM', tags });
  },
  writeBytes(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome {
    const header = parseHeader(original);
    if (!header) throw new UnsupportedFormatError('not a supported PPM stream');
    let comment: string | null | undefined;
    const skipped: string[] = [];
    for (const [key, value] of Object.entries(tags)) {
      if (key.toLowerCase() !== 'comment') {
        skipped.push(key);
      } else if (value === null || typeof value === 'string') {
        comment = value;
      } else {
        skipped.push(key);
      }
    }
    if (comment === undefined) return { bytes: original, written: [], skipped };
    const payload = original.subarray(header.dataOffset);
    const headerLines = [`${header.magic}`, ...(comment === null ? [] : comment.split(/\r?\n/).map((line) => `# ${line}`)), `${header.width} ${header.height}`, `${header.maxValue}`];
    const rewritten = encoder.encode(`${headerLines.join('\n')}\n`);
    const bytes = new Uint8Array(rewritten.length + payload.length);
    bytes.set(rewritten);
    bytes.set(payload, rewritten.length);
    return { bytes, written: ['Comment'], skipped };
  },
};