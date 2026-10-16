import type { ContainerWriter, TagValue, WriteOutcome } from '../types.js';
import { parseICCProfile } from '../exif/icc.js';
import { parseXMP } from '../exif/xmp.js';
import { toXmpPropertyRequest, writeXmpPacket, type XmpPropertyRequest } from './xmp-writer.js';
import { UnsupportedFormatError } from './writers.js';

const GIF_SIGNATURES = new Set(['GIF87a', 'GIF89a']);
const XMP_APPLICATION = 'XMP DataXMP';
const ICC_APPLICATION = 'ICCRGBG1012';
const XMP_TRAILER = new Uint8Array([1, ...Array.from({ length: 256 }, (_, i) => 255 - i)]);
const decoder = new TextDecoder();

interface GifBlock {
  start: number;
  end: number;
  kind: 'extension' | 'image' | 'trailer';
  label?: number;
  application?: string;
  data?: Uint8Array;
}

interface SubBlocks {
  data: Uint8Array;
  end: number;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readSubBlocks(bytes: Uint8Array, start: number): SubBlocks {
  const parts: Uint8Array[] = [];
  let offset = start;
  while (offset < bytes.length) {
    const length = bytes[offset]!;
    offset++;
    if (length === 0) return { data: concat(parts), end: offset };
    if (offset + length > bytes.length) break;
    parts.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  throw new UnsupportedFormatError('truncated GIF data sub-blocks');
}

function walkGif(bytes: Uint8Array): GifBlock[] {
  if (bytes.length < 13 || !GIF_SIGNATURES.has(decoder.decode(bytes.subarray(0, 6)))) {
    throw new UnsupportedFormatError('not a GIF stream');
  }
  const blocks: GifBlock[] = [];
  let offset = 13;
  const screenFlags = bytes[10]!;
  if (screenFlags & 0x80) offset += 3 * (2 << (screenFlags & 0x07));
  if (offset > bytes.length) throw new UnsupportedFormatError('truncated GIF color table');

  while (offset < bytes.length) {
    const start = offset;
    const marker = bytes[offset]!;
    if (marker === 0x3b) {
      blocks.push({ start, end: start + 1, kind: 'trailer' });
      break;
    }
    if (marker === 0x21) {
      if (offset + 2 > bytes.length) throw new UnsupportedFormatError('truncated GIF extension');
      const label = bytes[offset + 1]!;
      let dataStart = offset + 2;
      let application: string | undefined;
      if (label === 0xff) {
        if (dataStart >= bytes.length || bytes[dataStart] !== 11 || dataStart + 12 > bytes.length) {
          throw new UnsupportedFormatError('invalid GIF application extension header');
        }
        application = decoder.decode(bytes.subarray(dataStart + 1, dataStart + 12));
        dataStart += 12;
      }
      if (application === XMP_APPLICATION) {
        const tail = decoder.decode(bytes.subarray(dataStart));
        const match = /<\?xpacket\s+end=["']\s*[wr]\s*["']\s*\?>/.exec(tail);
        if (!match) throw new UnsupportedFormatError('GIF XMP extension has no packet terminator');
        const packetTextEnd = match.index + match[0].length;
        const hasBom = bytes[dataStart] === 0xef && bytes[dataStart + 1] === 0xbb && bytes[dataStart + 2] === 0xbf;
        const packetEnd = new TextEncoder().encode(tail.slice(0, packetTextEnd)).length + (hasBom ? 3 : 0);
        const dataEnd = dataStart + packetEnd + XMP_TRAILER.length;
        if (dataEnd >= bytes.length || bytes[dataEnd] !== 0) {
          throw new UnsupportedFormatError('truncated GIF XMP landing zone');
        }
        blocks.push({
          start,
          end: dataEnd + 1,
          kind: 'extension',
          label,
          application,
          data: bytes.subarray(dataStart, dataStart + packetEnd),
        });
        offset = dataEnd + 1;
        continue;
      }
      const subblocks = readSubBlocks(bytes, dataStart);
      blocks.push({ start, end: subblocks.end, kind: 'extension', label, application, data: subblocks.data });
      offset = subblocks.end;
      continue;
    }
    if (marker === 0x2c) {
      if (offset + 10 > bytes.length) throw new UnsupportedFormatError('truncated GIF image descriptor');
      const flags = bytes[offset + 9]!;
      let dataStart = offset + 10;
      if (flags & 0x80) dataStart += 3 * (2 << (flags & 0x07));
      if (dataStart >= bytes.length) throw new UnsupportedFormatError('truncated GIF image data');
      dataStart++; // LZW minimum code size
      const subblocks = readSubBlocks(bytes, dataStart);
      blocks.push({ start, end: subblocks.end, kind: 'image' });
      offset = subblocks.end;
      continue;
    }
    throw new UnsupportedFormatError(`invalid GIF block marker 0x${marker.toString(16)}`);
  }
  return blocks;
}

function blockify(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += 255) {
    const chunk = data.subarray(offset, Math.min(offset + 255, data.length));
    parts.push(new Uint8Array([chunk.length]), chunk);
  }
  return concat(parts);
}

function makeCommentExtension(value: string): Uint8Array {
  return concat([new Uint8Array([0x21, 0xfe]), blockify(new TextEncoder().encode(value)), new Uint8Array([0])]);
}

function makeApplicationExtension(application: string, data: Uint8Array, xmp = false): Uint8Array {
  const header = new TextEncoder().encode(application);
  if (header.length !== 11) throw new UnsupportedFormatError('GIF application identifier must be 11 bytes');
  const body = xmp
    ? concat([data, XMP_TRAILER, new Uint8Array([0])])
    : concat([blockify(data), new Uint8Array([0])]);
  return concat([new Uint8Array([0x21, 0xff, 11]), header, body]);
}

function targetApplication(block: GifBlock, application: string): boolean {
  return block.kind === 'extension' && block.label === 0xff && block.application === application;
}

function extractXmpPacket(data: Uint8Array): string | null {
  const text = decoder.decode(data);
  const match = /<\?xpacket\s+end=["']\s*[wr]\s*["']\s*\?>/.exec(text);
  return match ? text.slice(0, match.index + match[0].length) : null;
}

interface WriteRequests {
  comment?: { key: string; value: string | null };
  xmp?: { keys: string[]; raw: string | Uint8Array | null; properties: XmpPropertyRequest[] };
  icc?: { key: string; value: Uint8Array | null };
  skipped: string[];
}

function resolveRequests(tags: Record<string, TagValue>): WriteRequests {
  const requests: WriteRequests = { skipped: [] };
  for (const [key, value] of Object.entries(tags)) {
    const name = key.toLowerCase().replace(/^gif:/, '');
    if (name === 'comment') {
      if (value === null || typeof value === 'string') requests.comment = { key, value };
      else requests.skipped.push(key);
      continue;
    }
    if (name === 'icc_profile') {
      if (value === null || value instanceof Uint8Array) requests.icc = { key, value };
      else requests.skipped.push(key);
      continue;
    }
    if (name === 'xmp') {
      if (value === null || typeof value === 'string' || value instanceof Uint8Array) {
        requests.xmp = { keys: [key], raw: value, properties: [] };
      } else requests.skipped.push(key);
      continue;
    }
    const property = toXmpPropertyRequest(key, value);
    if (property) {
      requests.xmp ??= { keys: [], raw: null, properties: [] };
      requests.xmp.keys.push(key);
      requests.xmp.properties.push(property);
    } else {
      requests.skipped.push(key);
    }
  }
  return requests;
}

export const gifWriter: ContainerWriter = (original, tags): WriteOutcome => {
  const blocks = walkGif(original);
  const request = resolveRequests(tags);
  const comments = blocks.filter((block) => block.kind === 'extension' && block.label === 0xfe);
  const xmpBlocks = blocks.filter((block) => targetApplication(block, XMP_APPLICATION));
  const iccBlocks = blocks.filter((block) => targetApplication(block, ICC_APPLICATION));
  const existingXmp = xmpBlocks.map((block) => extractXmpPacket(block.data!)).find((packet) => packet !== null) ?? null;

  let xmpData: Uint8Array | null = null;
  if (request.xmp) {
    if (request.xmp.raw === null && request.xmp.properties.length === 0) {
      xmpData = null;
    } else if (request.xmp.raw instanceof Uint8Array) {
      xmpData = request.xmp.properties.length
        ? new TextEncoder().encode(writeXmpPacket(decoder.decode(request.xmp.raw), request.xmp.properties))
        : request.xmp.raw;
    } else if (typeof request.xmp.raw === 'string') {
      xmpData = request.xmp.properties.length
        ? new TextEncoder().encode(writeXmpPacket(request.xmp.raw, request.xmp.properties))
        : new TextEncoder().encode(request.xmp.raw);
    } else {
      xmpData = new TextEncoder().encode(writeXmpPacket(existingXmp, request.xmp.properties));
    }
  }

  const iccData = request.icc?.value ?? null;
  const newComment = request.comment?.value === null || request.comment?.value === undefined
    ? null
    : makeCommentExtension(request.comment.value);
  const newXmp = xmpData?.length ? makeApplicationExtension(XMP_APPLICATION, xmpData, true) : null;
  const newIcc = iccData?.length ? makeApplicationExtension(ICC_APPLICATION, iccData) : null;

  const insertions = new Map<number, Uint8Array[]>();
  const removed = new Set<number>();
  const written: string[] = [];
  const setAt = (at: number, data: Uint8Array | null) => {
    if (!data) return;
    const current = insertions.get(at) ?? [];
    current.push(data);
    insertions.set(at, current);
  };
  const replaceBlocks = (targets: GifBlock[], replacement: Uint8Array | null, key: string) => {
    if (!request.comment && !request.xmp && !request.icc) return;
    if (targets.length > 0) {
      for (const block of targets) removed.add(block.start);
      if (replacement) setAt(targets[0]!.start, replacement);
    } else if (replacement) {
      const insertion = blocks.find((block) => block.kind !== 'extension')?.start ?? original.length;
      setAt(insertion, replacement);
    }
    if (request.comment?.key === key || request.icc?.key === key) written.push(key);
  };

  if (request.comment) replaceBlocks(comments, newComment, request.comment.key);
  if (request.xmp) {
    replaceBlocks(xmpBlocks, newXmp, request.xmp.keys[0] ?? 'XMP');
    written.push(...request.xmp.keys);
  }
  if (request.icc) replaceBlocks(iccBlocks, newIcc, request.icc.key);

  const metadataAdded = Boolean(newComment || newXmp || newIcc);
  const header = original.slice(0, 13);
  if (metadataAdded && decoder.decode(header.subarray(0, 6)) === 'GIF87a') {
    header.set(new TextEncoder().encode('GIF89a'), 0);
  }
  const parts: Uint8Array[] = [header];
  let position = 13;
  const first = blocks[0];
  const globalTableEnd = first?.start ?? original.length;
  if (globalTableEnd > position) {
    parts.push(original.subarray(position, globalTableEnd));
    position = globalTableEnd;
  }
  for (const block of blocks) {
    if (block.start < position) continue;
    if (block.start > position) parts.push(original.subarray(position, block.start));
    for (const inserted of insertions.get(block.start) ?? []) parts.push(inserted);
    if (!removed.has(block.start)) parts.push(original.subarray(block.start, block.end));
    position = block.end;
  }
  if (position < original.length) parts.push(original.subarray(position));
  return { bytes: concat(parts), written, skipped: request.skipped };
};

export function parseGifMetadata(bytes: Uint8Array): Record<string, TagValue> {
  const blocks = walkGif(bytes);
  const tags: Record<string, TagValue> = {
    GIFVersion: decoder.decode(bytes.subarray(3, 6)),
    ImageWidth: bytes[6]! | (bytes[7]! << 8),
    ImageHeight: bytes[8]! | (bytes[9]! << 8),
  };
  let frameCount = 0;
  let duration = 0;
  for (const block of blocks) {
    if (block.kind === 'image') frameCount++;
    if (block.kind !== 'extension') continue;
    if (block.label === 0xfe && !('Comment' in tags)) tags.Comment = decoder.decode(block.data!);
    if (block.label === 0xf9 && block.data!.length >= 4) {
      duration += (block.data![1]! | (block.data![2]! << 8)) / 100;
    }
    if (targetApplication(block, XMP_APPLICATION)) {
      const packet = extractXmpPacket(block.data!);
      if (packet) Object.assign(tags, parseXMP(packet));
    }
    if (targetApplication(block, ICC_APPLICATION)) Object.assign(tags, parseICCProfile(block.data!));
  }
  if (frameCount > 1) tags.FrameCount = frameCount;
  if (duration > 0) tags.Duration = `${duration.toFixed(2)} s`;
  return tags;
}