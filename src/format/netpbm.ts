import type { FormatParser } from './mod.js';
import type { FileInfo, TagValue, WriteOutcome } from '../types.js';
import { UnsupportedFormatError } from '../write/writers.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface NetpbmHeader {
  magic: string;
  width: number;
  height: number;
  maxValue?: number;
  comments: string[];
  dataOffset: number;
}

function isWhitespace(value: number): boolean {
  return value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0b || value === 0x0c || value === 0x0d;
}

function parseHeader(bytes: Uint8Array, magicValues: string[], hasMaxValue: boolean): NetpbmHeader | undefined {
  if (bytes.length < 3 || bytes[0] !== 0x50) return undefined;
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!);
  if (!magicValues.includes(magic)) return undefined;
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
  const maxRaw = hasMaxValue ? token() : undefined;
  if (!widthRaw || !heightRaw || !/^\d+$/.test(widthRaw) || !/^\d+$/.test(heightRaw) ||
      (hasMaxValue && (!maxRaw || !/^\d+$/.test(maxRaw)))) return undefined;
  if (offset >= bytes.length || !isWhitespace(bytes[offset]!)) return undefined;
  if (bytes[offset] === 0x0d && bytes[offset + 1] === 0x0a) offset += 2;
  else offset++;

  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const maxValue = maxRaw === undefined ? undefined : Number(maxRaw);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      (maxValue !== undefined && (!Number.isSafeInteger(maxValue) || maxValue < 1 || maxValue > 65535))) return undefined;
  return { magic, width, height, maxValue, comments, dataOffset: offset };
}

export function createNetpbmParser(options: {
  format: 'PPM' | 'PGM' | 'PBM';
  magics: string[];
  hasMaxValue: boolean;
  extensions: string[];
  mimeType: string;
}): FormatParser {
  const parse = (bytes: Uint8Array) => parseHeader(bytes, options.magics, options.hasMaxValue);
  return {
    format: options.format,
    extensions: options.extensions,
    canParse(bytes: Uint8Array): boolean {
      return parse(bytes) !== undefined;
    },
    parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
      const header = parse(bytes);
      if (!header) throw new UnsupportedFormatError(`not a supported ${options.format} stream`);
      const tags: Record<string, TagValue> = {
        ImageWidth: header.width,
        ImageHeight: header.height,
        FileType: options.format,
        MIMEType: options.mimeType,
        FileName: filePath.split('/').pop() ?? filePath,
      };
      if (header.maxValue !== undefined) tags.MaxVal = header.maxValue;
      if (header.comments.length > 0) {
        tags.Comment = header.comments.map((comment) => comment.replace(/^ ?/, '')).join('\n').replace(/[\r\n]+$/, '');
      }
      return Promise.resolve({ path: filePath, format: options.format, tags });
    },
    writeBytes(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome {
      const header = parse(original);
      if (!header) throw new UnsupportedFormatError(`not a supported ${options.format} stream`);
      let comment: string | null | undefined;
      const skipped: string[] = [];
      for (const [key, value] of Object.entries(tags)) {
        if (key.toLowerCase() !== 'comment') skipped.push(key);
        else if (value === null || typeof value === 'string') comment = value;
        else skipped.push(key);
      }
      if (comment === undefined) return { bytes: original, written: [], skipped };
      const payload = original.subarray(header.dataOffset);
      const lines = [
        header.magic,
        ...(comment === null ? [] : comment.split(/\r?\n/).map((line) => `# ${line}`)),
        `${header.width} ${header.height}`,
        ...(header.maxValue === undefined ? [] : [String(header.maxValue)]),
      ];
      const rewritten = encoder.encode(`${lines.join('\n')}\n`);
      const bytes = new Uint8Array(rewritten.length + payload.length);
      bytes.set(rewritten);
      bytes.set(payload, rewritten.length);
      return { bytes, written: ['Comment'], skipped };
    },
  };
}