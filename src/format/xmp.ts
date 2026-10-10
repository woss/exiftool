import type { FormatParser } from './mod.js';
import type { FileInfo, TagValue, WriteOutcome } from '../types.js';
import { parseXMP } from '../exif/xmp.js';
import {
  deleteXmpProperties,
  toXmpPropertyName,
  toXmpPropertyRequest,
  writeXmpPacket,
} from '../write/xmp-writer.js';
import { UnsupportedFormatError } from '../write/writers.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const XMP_ROOT = /<(?:x:xmpmeta|rdf:RDF)\b/;

export const xmpParser: FormatParser = {
  format: 'XMP',
  extensions: ['.xmp'],
  canParse(bytes: Uint8Array): boolean {
    if (bytes.length < 8) return false;
    return XMP_ROOT.test(decoder.decode(bytes.subarray(0, Math.min(bytes.length, 4096))));
  },
  async parse(bytes: Uint8Array, filePath: string): Promise<FileInfo> {
    const tags = parseXMP(decoder.decode(bytes));
    tags.FileType = 'XMP';
    tags.MIMEType = 'application/rdf+xml';
    tags.FileName = filePath.split('/').pop() ?? filePath;
    return { path: filePath, format: 'XMP', tags };
  },
  writeBytes(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome {
    const source = decoder.decode(original);
    const properties = [];
    const deletes: string[] = [];
    const written: string[] = [];
    const skipped: string[] = [];
    let rawPacket: string | undefined;

    for (const [key, value] of Object.entries(tags)) {
      if (key.toLowerCase() === 'xmp') {
        if (typeof value === 'string') rawPacket = value;
        else if (value instanceof Uint8Array) rawPacket = decoder.decode(value);
        else if (value === null) rawPacket = '';
        else skipped.push(key);
        if (!skipped.includes(key)) written.push(key);
        continue;
      }
      const propertyName = toXmpPropertyName(key);
      if (!propertyName) {
        skipped.push(key);
        continue;
      }
      if (value === null) {
        deletes.push(propertyName);
        written.push(key);
        continue;
      }
      const request = toXmpPropertyRequest(key, value);
      if (!request) {
        skipped.push(key);
        continue;
      }
      properties.push(request);
      written.push(key);
    }

    let packet: string | null = rawPacket ?? source;
    if (deletes.length > 0 && packet) packet = deleteXmpProperties(packet, deletes);
    if (properties.length > 0) packet = writeXmpPacket(packet || null, properties);
    if (rawPacket === undefined && deletes.length === 0 && properties.length === 0) {
      return { bytes: original, written: [], skipped };
    }
    if (packet === null && original.length > 0) {
      throw new UnsupportedFormatError('XMP write would leave an empty metadata file');
    }
    return { bytes: encoder.encode(packet ?? ''), written, skipped };
  },
};