import { UnsupportedFormatError } from './writers.js';
import type { TagValue } from '../types.js';
import { md5Hex } from '../utils/md5.js';
import tagData from '../tags/generated/tags.json' with { type: 'json' };
import type { TableDef } from '../tags.js';

/**
 * IPTC IIM writer for JPEG APP13 (Photoshop IRB).
 *
 * Writes record 1 dataset 90 (CodedCharacterSet = ESC %G, UTF-8) and
 * record 2 dataset 25 (Keywords, one dataset per keyword) inside an 8BIM
 * 0x0404 (IPTC-NAA) resource block. An existing APP13 "Photoshop 3.0"
 * payload is merged: only its 0x0404 block is replaced, every other 8BIM
 * resource (resolution info, thumbnail, …) is copied verbatim.
 */

const PHOTOSHOP_HEADER = 'Photoshop 3.0\0';
const ESC = 0x1b;
/** CodedCharacterSet value for UTF-8: ESC % G. */
const UTF8_ESCAPE = new Uint8Array([ESC, 0x25, 0x47]);

interface BimBlock {
  sig: string;
  id: number;
  name: Uint8Array;
  data: Uint8Array;
  dataPadding: Uint8Array;
}

export interface IptcWriteRequest {
  key: string;
  record: number;
  dataset: number;
  type: string;
  values?: Record<string, string>;
  value: TagValue;
}

export interface PhotoshopResourceWriteRequest {
  key: string;
  id: number;
  data: Uint8Array | null;
  offset?: number;
  createSize?: number;
  requireExisting?: boolean;
}

const PHOTOSHOP_RESOURCE_IDS: Record<string, number> = {
  copyrightflag: 0x040a,
  url: 0x040b,
  globalangle: 0x040d,
  globalaltitude: 0x0419,
};

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset++]!;
    if (marker === 0xda || marker === 0xd9) return undefined;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (frameMarkers.has(marker)) {
      if (length < 7) return undefined;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

function encodePhotoshopThumbnail(bytes: Uint8Array): Uint8Array | undefined {
  const dimensions = jpegDimensions(bytes);
  if (!dimensions) return undefined;
  const bytesPerLine = Math.floor((dimensions.width * 24 + 31) / 32) * 4;
  const planeBytes = bytesPerLine * dimensions.height;
  if (planeBytes > 0xffffffff) return undefined;
  const data = new Uint8Array(28 + bytes.length);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, dimensions.width, false);
  view.setUint32(8, dimensions.height, false);
  view.setUint32(12, bytesPerLine, false);
  view.setUint32(16, planeBytes, false);
  view.setUint32(20, bytes.length, false);
  view.setUint16(24, 24, false);
  view.setUint16(26, 1, false);
  data.set(bytes, 28);
  return data;
}

const PHOTOSHOP_RESOLUTION_FIELDS: Record<string, { offset: number; type: 'fixed32' | 'unit' }> = {
  xresolution: { offset: 0, type: 'fixed32' },
  displayedunitsx: { offset: 4, type: 'unit' },
  yresolution: { offset: 8, type: 'fixed32' },
  displayedunitsy: { offset: 12, type: 'unit' },
};

export function resolvePhotoshopResourceWriteRequest(
  key: string,
  value: TagValue,
): PhotoshopResourceWriteRequest | undefined {
  if (/^Photoshop:PhotoshopQuality$/i.test(key)) {
    if (value === null) return { key, id: 0x0406, data: null, requireExisting: true };
    const quality = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    const raw = quality - 4;
    if (!Number.isInteger(quality) || raw < -0x8000 || raw > 0x7fff) return undefined;
    const data = new Uint8Array(2);
    new DataView(data.buffer).setInt16(0, raw, false);
    return { key, id: 0x0406, data, offset: 0, createSize: 4, requireExisting: true };
  }
  const thumbnailMatch = key.match(/^Photoshop:(PhotoshopThumbnail|PhotoshopBGRThumbnail)$/i);
  if (thumbnailMatch) {
    const id = thumbnailMatch[1]!.toLowerCase() === 'photoshopthumbnail' ? 0x040c : 0x0409;
    if (value === null) return { key, id, data: null };
    if (!(value instanceof Uint8Array)) return undefined;
    const data = encodePhotoshopThumbnail(value);
    return data ? { key, id, data } : undefined;
  }
  const match = key.match(/^Photoshop:(CopyrightFlag|URL|GlobalAngle|GlobalAltitude)$/i);
  const resolutionMatch = key.match(/^Photoshop:(XResolution|YResolution|DisplayedUnitsX|DisplayedUnitsY)$/i);
  if (!match && !resolutionMatch) return undefined;
  if (resolutionMatch) {
    if (value === null) return undefined;
    const field = PHOTOSHOP_RESOLUTION_FIELDS[resolutionMatch[1]!.toLowerCase()]!;
    if (field.type === 'unit') {
      const raw = typeof value === 'number'
        ? value
        : typeof value === 'string'
        ? ({ inches: 1, cm: 2 }[value.trim().toLowerCase()] ?? Number(value))
        : NaN;
      if (!Number.isInteger(raw) || raw < 1 || raw > 2) return undefined;
      const data = new Uint8Array(2);
      new DataView(data.buffer).setUint16(0, raw, false);
      return { key, id: 0x03ed, offset: field.offset, createSize: 16, data };
    }
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    const fixed = Math.round(number * 65536);
    if (!Number.isFinite(number) || number < 0 || fixed > 0xffffffff) return undefined;
    const data = new Uint8Array(4);
    new DataView(data.buffer).setUint32(0, fixed, false);
    return { key, id: 0x03ed, offset: field.offset, createSize: 16, data };
  }
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  const id = PHOTOSHOP_RESOURCE_IDS[name]!;
  if (value === null) return { key, id, data: null };
  if (name === 'url') {
    if (typeof value !== 'string') return undefined;
    return { key, id, data: new TextEncoder().encode(value) };
  }
  if (name === 'copyrightflag') {
    const flag = typeof value === 'boolean'
      ? Number(value)
      : typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(?:true|false|0|1)$/i.test(value.trim())
      ? Number(value.trim().toLowerCase() === 'true' ? 1 : value.trim())
      : NaN;
    if (!Number.isInteger(flag) || flag < 0 || flag > 1) return undefined;
    return { key, id, data: new Uint8Array([flag]) };
  }
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) return undefined;
  const data = new Uint8Array(4);
  new DataView(data.buffer).setUint32(0, number, false);
  return { key, id, data };
}

const IPTC_TAGS = new Map<string, Omit<IptcWriteRequest, 'key' | 'value'>>();
const IPTC_BINARY_LENGTHS = new Map<string, { min: number; max: number }>([
  ['2:125', { min: 7360, max: 7360 }],
  ['2:202', { min: 0, max: 256000 }],
]);
const IPTC_DIGIT_LENGTHS = new Map<string, number>([
  ['1:40', 8], ['1:60', 1], ['1:70', 8],
  ['2:8', 2], ['2:10', 1], ['2:30', 8], ['2:37', 8], ['2:42', 2], ['2:47', 8], ['2:50', 8],
  ['2:55', 8], ['2:62', 8], ['2:151', 6], ['2:152', 2], ['2:153', 6],
]);
const IPTC_DATE_DATASETS = new Set(['1:70', '2:30', '2:37', '2:47', '2:55', '2:62']);
for (const table of tagData as TableDef[]) {
  if (
    table.perlName !== 'IPTC::ApplicationRecord' &&
    table.perlName !== 'IPTC::EnvelopeRecord' &&
    table.perlName !== 'IPTC::NewsPhoto'
  ) continue;
  const record = table.perlName === 'IPTC::EnvelopeRecord'
    ? 1
    : table.perlName === 'IPTC::ApplicationRecord'
    ? 2
    : 3;
  for (const tag of table.tags) {
    const dataset = Number(tag.id);
    if (tag.writable && Number.isInteger(dataset) && dataset >= 0 && dataset <= 255) {
      IPTC_TAGS.set(tag.name.toLowerCase(), {
        record,
        dataset,
        type: tag.type,
        ...(tag.values ? { values: tag.values } : {}),
      });
    }
  }
}

export function resolveIptcWriteRequest(
  key: string,
  value: TagValue,
): IptcWriteRequest | undefined {
  const match = key.match(/^IPTC:(.+)$/i);
  if (!match) return undefined;
  const spec = IPTC_TAGS.get(match[1]!.toLowerCase());
  if (!spec) return undefined;
  let requestValue = value;
  if (typeof value === 'string' && spec.values) {
    const input = value.trim().toLowerCase();
    const entries = Object.entries(spec.values);
    const exact = entries.filter(([, label]) => label.toLowerCase() === input);
    const matches = exact.length ? exact : entries.filter(([, label]) => label.toLowerCase().startsWith(input));
    if (matches.length === 1) requestValue = matches[0]![0];
  }
  if (spec.record === 1 && spec.dataset === 90 && requestValue !== null) {
    if (
      typeof requestValue !== 'string' ||
      !/^(?:utf-?8|(?:ESC\s*|\x1b)\s*%\s*G)$/i.test(requestValue.trim())
    ) return undefined;
  }
  if (spec.type === 'digits' && requestValue !== null) {
    const values = Array.isArray(requestValue) ? requestValue : [requestValue];
    if (!values.every((item) => encodeIptcDigits(spec, item) !== undefined)) {
      return undefined;
    }
  }
  if (spec.type === 'undef' && requestValue instanceof Uint8Array) {
    const bounds = IPTC_BINARY_LENGTHS.get(`${spec.record}:${spec.dataset}`);
    if (!bounds || requestValue.length < bounds.min || requestValue.length > bounds.max) return undefined;
  }
  if (spec.record === 2 && spec.dataset === 25) {
    const keywordValues = Array.isArray(requestValue) ? requestValue : [requestValue];
    if (requestValue !== null && !keywordValues.every((item) => typeof item === 'string')) return undefined;
  }
  if (
    requestValue !== null && !Array.isArray(requestValue) && typeof requestValue !== 'string' && typeof requestValue !== 'number' &&
    !(requestValue instanceof Uint8Array && spec.type === 'undef')
  ) {
    return undefined;
  }
  if (Array.isArray(requestValue) && !requestValue.every((item) => typeof item === 'string' || typeof item === 'number')) {
    return undefined;
  }
  return { key, ...spec, value: requestValue };
}

function encodeIptcDigits(
  spec: Pick<IptcWriteRequest, 'record' | 'dataset'>,
  value: TagValue,
): string | undefined {
  const key = `${spec.record}:${spec.dataset}`;
  const width = IPTC_DIGIT_LENGTHS.get(key);
  if (!width || (typeof value !== 'string' && typeof value !== 'number')) return undefined;
  const text = String(value);
  if (/^\d+$/.test(text) && text.length === width) return text;
  if (!IPTC_DATE_DATASETS.has(key) || typeof value !== 'string') return undefined;
  const match = text.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

function parseBimBlocks(payload: Uint8Array): BimBlock[] {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const blocks: BimBlock[] = [];
  let pos = PHOTOSHOP_HEADER.length;
  while (pos + 12 <= payload.length) {
    const sig = String.fromCharCode(...payload.subarray(pos, pos + 4));
    if (!/^8B[A-Z0-9]{2}$/.test(sig)) break; // not an image-resource block
    const id = dv.getUint16(pos + 4);
    const nameStart = pos + 6;
    let p = nameStart;
    const nameLen = payload[p];
    const nameSize = 1 + nameLen + (1 + nameLen) % 2;
    const name = payload.slice(nameStart, nameStart + nameSize);
    p += nameSize;
    if (p + 4 > payload.length) break;
    const size = dv.getUint32(p);
    p += 4;
    if (p + size > payload.length) break;
    const data = payload.slice(p, p + size);
    const paddingSize = size % 2;
    const dataPadding = payload.slice(p + size, p + size + paddingSize);
    blocks.push({ sig, id, name, data, dataPadding });
    pos = p + size + size % 2;
  }
  return blocks;
}

export function hasPhotoshopResource(payload: Uint8Array | null, id: number): boolean {
  return payload !== null && parseBimBlocks(payload).some((block) => block.id === id);
}

function serializeBimBlocks(blocks: BimBlock[]): Uint8Array {
  const total = blocks.reduce((n, b) => n + 10 + b.name.length + b.data.length + b.dataPadding.length, 0);
  const out = new Uint8Array(PHOTOSHOP_HEADER.length + total);
  out.set(new TextEncoder().encode(PHOTOSHOP_HEADER));
  let o = PHOTOSHOP_HEADER.length;
  const dv = new DataView(out.buffer);
  for (const b of blocks) {
    out.set(new TextEncoder().encode(b.sig), o);
    dv.setUint16(o + 4, b.id);
    out.set(b.name, o + 6);
    const sizeOffset = o + 6 + b.name.length;
    dv.setUint32(sizeOffset, b.data.length);
    const dataOffset = sizeOffset + 4;
    out.set(b.data, dataOffset);
    out.set(b.dataPadding, dataOffset + b.data.length);
    o = dataOffset + b.data.length + b.dataPadding.length;
  }
  return out.subarray(0, o);
}

/** One IIM dataset: 1C marker, record, dataset, 2-byte big-endian length. */
function iimDataset(record: number, dataset: number, data: Uint8Array): Uint8Array {
  let extendedLengthBytes = 0;
  let lengthPrefix = 0;
  if (data.length >= 0x8000) {
    extendedLengthBytes = 1;
    while (extendedLengthBytes < 4 && data.length >= 2 ** (8 * extendedLengthBytes)) extendedLengthBytes++;
    lengthPrefix = 0x8000 | extendedLengthBytes;
  }
  const payloadOffset = extendedLengthBytes ? 5 + extendedLengthBytes : 5;
  const out = new Uint8Array(payloadOffset + data.length);
  out[0] = 0x1c;
  out[1] = record;
  out[2] = dataset;
  if (extendedLengthBytes) {
    out[3] = lengthPrefix >> 8;
    out[4] = lengthPrefix & 255;
    for (let index = 0; index < extendedLengthBytes; index++) {
      out[5 + index] = data.length >>> (8 * (extendedLengthBytes - index - 1));
    }
  } else {
    out[3] = data.length >> 8;
    out[4] = data.length & 255;
  }
  out.set(data, payloadOffset);
  return out;
}

interface IimEntry { record: number; dataset: number; raw: Uint8Array }

function parseIptcIim(data: Uint8Array): IimEntry[] {
  const entries: IimEntry[] = [];
  let pos = 0;
  while (pos + 5 <= data.length) {
    if (data[pos] !== 0x1c) {
      pos++;
      continue;
    }
    let headerLength = 5;
    let size = (data[pos + 3]! << 8) | data[pos + 4]!;
    if (size & 0x8000) {
      const sizeBytes = size & 0x7fff;
      if (sizeBytes < 1 || sizeBytes > 4 || pos + 5 + sizeBytes > data.length) break;
      headerLength += sizeBytes;
      size = 0;
      for (let i = 0; i < sizeBytes; i++) size = size * 256 + data[pos + 5 + i]!;
    }
    if (pos + headerLength + size > data.length) break;
    entries.push({
      record: data[pos + 1]!,
      dataset: data[pos + 2]!,
      raw: data.slice(pos, pos + headerLength + size),
    });
    pos += headerLength + size;
  }
  return entries;
}

function encodeIptcValues(request: IptcWriteRequest): Uint8Array[] | undefined {
  if (request.value === null) return [];
  const values = Array.isArray(request.value) ? request.value : [request.value];
  const out: Uint8Array[] = [];
    for (const value of values) {
        if (request.record === 1 && request.dataset === 90) {
          if (typeof value !== 'string') return undefined;
          const text = value.trim();
          if (/^utf-?8$/i.test(text)) {
            out.push(UTF8_ESCAPE);
          } else {
            const escapeSequence = text.replace(/ESC\s*/gi, '\x1b').replace(/,\s*/g, '').replace(/\s+/g, '');
            if (!escapeSequence.startsWith('\x1b') || escapeSequence.length > 32) return undefined;
            out.push(new TextEncoder().encode(escapeSequence));
          }
        } else if (request.type === 'undef' && value instanceof Uint8Array) {
          out.push(value);
        } else if (request.type === 'digits') {
          const digits = encodeIptcDigits(request, value);
          if (!digits) return undefined;
          out.push(new TextEncoder().encode(digits));
        } else if (request.type === 'int8u') {
        const number = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(number) || number < 0 || number > 0xff) return undefined;
        out.push(new Uint8Array([number]));
      } else if (request.type === 'int16u') {
        const number = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(number) || number < 0 || number > 0xffff) return undefined;
        out.push(new Uint8Array([number >> 8, number & 0xff]));
      } else if (request.type === 'int32u') {
        const number = typeof value === 'number' ? value : Number(value);
        if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) return undefined;
        out.push(new Uint8Array([number >>> 24, number >>> 16 & 255, number >>> 8 & 255, number & 255]));
    } else if (request.type === 'string') {
      out.push(new TextEncoder().encode(String(value)));
    } else {
      return undefined;
    }
  }
  return out;
}

function buildIptcIim(existing: Uint8Array | null, requests: IptcWriteRequest[]): Uint8Array {
  let entries = existing ? parseIptcIim(existing) : [];
  const replacements = new Map<string, IptcWriteRequest>();
  for (const request of requests) replacements.set(`${request.record}:${request.dataset}`, request);
  entries = entries.filter((entry) => !replacements.has(`${entry.record}:${entry.dataset}`));

  const additions: Uint8Array[] = [];
  let addsMetadata = false;
  for (const request of requests) {
    const encoded = encodeIptcValues(request);
    if (!encoded) throw new UnsupportedFormatError(`unsupported IPTC value for ${request.key}`);
    for (const data of encoded) {
      additions.push(iimDataset(request.record, request.dataset, data));
      addsMetadata = true;
    }
  }
  const charsetRequest = requests.find((request) => request.record === 1 && request.dataset === 90);
  if (addsMetadata && (!charsetRequest || charsetRequest.value === null)) {
    entries = entries.filter((entry) => entry.record !== 1 || entry.dataset !== 90);
    additions.unshift(iimDataset(1, 90, UTF8_ESCAPE));
  }

  const preserved = entries.map((entry) => entry.raw);
  const all = [...preserved, ...additions];
  let total = 0;
  for (const part of all) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of all) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function requestsFromKeywords(keywords: string[]): IptcWriteRequest[] {
  const spec = IPTC_TAGS.get('keywords')!;
  return [{ key: 'IPTC:Keywords', ...spec, value: keywords }];
}

function rebuildPhotoshopIrb(
  payload: Uint8Array | null,
  requests: IptcWriteRequest[],
  resourceRequests: PhotoshopResourceWriteRequest[],
): Uint8Array | null {
  const blocks: BimBlock[] = payload ? parseBimBlocks(payload) : [];
  const iptcBlock = blocks.find((block) => block.id === IPTC_RESOURCE_ID);
  const iptcTouched = requests.length > 0;
  const mergedIim = iptcTouched
    ? buildIptcIim(iptcBlock?.data ?? null, requests)
    : iptcBlock?.data ?? new Uint8Array(0);
  const digestIndex = iptcTouched ? blocks.findIndex((block) => block.id === IPTC_DIGEST_RESOURCE_ID) : -1;
  const digestBlock = digestIndex < 0 ? undefined : blocks[digestIndex];
  if (digestBlock && iptcBlock && digestBlock.data.length === 16) {
    const oldDigest = md5Hex(iptcBlock.data);
    const storedDigest = [...digestBlock.data].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (storedDigest === oldDigest) {
      if (mergedIim.length > 0) {
        const newDigest = md5Hex(mergedIim);
        digestBlock.data = Uint8Array.from(newDigest.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
        digestBlock.dataPadding = new Uint8Array(0);
      } else {
        blocks.splice(digestIndex, 1);
      }
    }
  }
  const requestsById = new Map<number, PhotoshopResourceWriteRequest[]>();
  for (const request of resourceRequests) {
    const group = requestsById.get(request.id) ?? [];
    group.push(request);
    requestsById.set(request.id, group);
  }
  const appliedResourceIds = new Set<number>();
  const kept: BimBlock[] = [];
  for (const block of blocks) {
    if (iptcTouched && block.id === IPTC_RESOURCE_ID) continue;
    const requestsForBlock = requestsById.get(block.id);
    if (!requestsForBlock) {
      kept.push(block);
      continue;
    }
    if (appliedResourceIds.has(block.id)) continue;
    appliedResourceIds.add(block.id);
    let data = block.data.slice();
    let removeBlock = false;
    for (const request of requestsForBlock) {
      if (request.offset === undefined) {
        if (request.data === null) removeBlock = true;
        else data = request.data.slice();
      } else if (request.data) {
        const needed = request.offset + request.data.length;
        if (data.length < needed) {
          const extended = new Uint8Array(needed);
          extended.set(data);
          data = extended;
        }
        data.set(request.data, request.offset);
      }
    }
    if (!removeBlock) {
      kept.push({ ...block, data, dataPadding: new Uint8Array(data.length % 2) });
    }
  }
  for (const [id, requestsForId] of requestsById) {
    if (appliedResourceIds.has(id)) continue;
    if (requestsForId.length === 1 && requestsForId[0]!.offset === undefined && !requestsForId[0]!.data) continue;
    const initialSize = Math.max(...requestsForId.map((request) => request.createSize ?? 0));
    const maximumEnd = Math.max(...requestsForId.map((request) =>
      request.offset === undefined ? request.data?.length ?? 0 : request.offset + (request.data?.length ?? 0),
    ));
    let data = new Uint8Array(Math.max(initialSize, maximumEnd));
    for (const request of requestsForId) {
      if (request.offset === undefined) {
        if (request.data === null) data = new Uint8Array(0);
        else if (request.data) data = request.data.slice();
      } else if (request.data) {
        data.set(request.data, request.offset);
      }
    }
    if (data.length === 0) continue;
    kept.push({
      sig: '8BIM',
      id,
      name: new Uint8Array([0, 0]),
      data,
      dataPadding: new Uint8Array(data.length % 2),
    });
  }
  if (iptcTouched && mergedIim.length > 0) {
    kept.unshift({
      sig: '8BIM', id: IPTC_RESOURCE_ID, name: new Uint8Array([0, 0]),
      data: mergedIim, dataPadding: new Uint8Array(mergedIim.length % 2),
    });
  }
  if (kept.length === 0) return null;
  return serializeBimBlocks(kept);
}

const IPTC_RESOURCE_ID = 0x0404;
const IPTC_DIGEST_RESOURCE_ID = 0x0425;

/**
 * Merges IPTC IIM datasets into a Photoshop IRB payload, preserving unrelated
 * datasets and resources. String-array input remains supported for keywords.
 */
export function mergePhotoshopIrb(payload: Uint8Array | null, keywords: string[]): Uint8Array;
export function mergePhotoshopIrb(
  payload: Uint8Array | null,
  requests: IptcWriteRequest[],
  resourceRequests?: PhotoshopResourceWriteRequest[],
): Uint8Array | null;
export function mergePhotoshopIrb(
  payload: Uint8Array | null,
  input: string[] | IptcWriteRequest[],
  resourceRequests: PhotoshopResourceWriteRequest[] = [],
): Uint8Array | null {
  const requests = typeof input[0] === 'string'
    ? requestsFromKeywords(input as string[])
    : input as IptcWriteRequest[];
  return rebuildPhotoshopIrb(payload, requests, resourceRequests);
}
