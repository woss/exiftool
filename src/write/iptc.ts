import { UnsupportedFormatError } from './writers.js';
import type { TagValue } from '../types.js';
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
  data: Uint8Array;
}

export interface IptcWriteRequest {
  key: string;
  record: number;
  dataset: number;
  type: string;
  value: TagValue;
}

const IPTC_TAGS = new Map<string, Omit<IptcWriteRequest, 'key' | 'value'>>();
for (const table of tagData as TableDef[]) {
  if (table.perlName !== 'IPTC::ApplicationRecord' && table.perlName !== 'IPTC::EnvelopeRecord') continue;
  const record = table.perlName === 'IPTC::EnvelopeRecord' ? 1 : 2;
  for (const tag of table.tags) {
    const dataset = Number(tag.id);
    if (tag.writable && Number.isInteger(dataset) && dataset >= 0 && dataset <= 255) {
      IPTC_TAGS.set(tag.name.toLowerCase(), { record, dataset, type: tag.type });
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
  if (spec.record === 2 && spec.dataset === 25) {
    const keywordValues = Array.isArray(value) ? value : [value];
    if (value !== null && !keywordValues.every((item) => typeof item === 'string')) return undefined;
  }
  if (value !== null && !Array.isArray(value) && typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  if (Array.isArray(value) && !value.every((item) => typeof item === 'string' || typeof item === 'number')) {
    return undefined;
  }
  return { key, ...spec, value };
}

function parseBimBlocks(payload: Uint8Array): BimBlock[] {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const blocks: BimBlock[] = [];
  let pos = PHOTOSHOP_HEADER.length;
  while (pos + 12 <= payload.length) {
    const sig = String.fromCharCode(...payload.subarray(pos, pos + 4));
    if (!/^8B[A-Z0-9]{2}$/.test(sig)) break; // not an image-resource block
    const id = dv.getUint16(pos + 4);
    let p = pos + 6;
    const nameLen = payload[p];
    p += 1 + nameLen + (1 + nameLen) % 2; // pascal string padded to even
    if (p + 4 > payload.length) break;
    const size = dv.getUint32(p);
    p += 4;
    const data = payload.slice(p, p + size);
    blocks.push({ sig, id, data });
    pos = p + size + size % 2;
  }
  return blocks;
}

function serializeBimBlocks(blocks: BimBlock[]): Uint8Array {
  const total = blocks.reduce((n, b) => n + 12 + b.data.length + b.data.length % 2, 0);
  const out = new Uint8Array(PHOTOSHOP_HEADER.length + total);
  out.set(new TextEncoder().encode(PHOTOSHOP_HEADER));
  let o = PHOTOSHOP_HEADER.length;
  const dv = new DataView(out.buffer);
  for (const b of blocks) {
    out.set(new TextEncoder().encode(b.sig), o);
    dv.setUint16(o + 4, b.id);
    out[o + 6] = 0; // empty pascal name
    dv.setUint32(o + 8, b.data.length);
    out.set(b.data, o + 12);
    o += 12 + b.data.length + b.data.length % 2;
  }
  return out.subarray(0, o);
}

/** One IIM dataset: 1C marker, record, dataset, 2-byte big-endian length. */
function iimDataset(record: number, dataset: number, data: Uint8Array): Uint8Array {
  if (data.length > 0xffff) {
    throw new UnsupportedFormatError('IPTC dataset exceeds 64 KiB standard record limit');
  }
  const out = new Uint8Array(5 + data.length);
  out[0] = 0x1c;
  out[1] = record;
  out[2] = dataset;
  out[3] = data.length >> 8;
  out[4] = data.length & 255;
  out.set(data, 5);
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
    if (request.type === 'int16u') {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(number) || number < 0 || number > 0xffff) return undefined;
      out.push(new Uint8Array([number >> 8, number & 0xff]));
    } else if (request.type === 'string' || request.type === 'digits') {
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
  if (addsMetadata && !replacements.has('1:90')) {
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
): Uint8Array | null {
  const blocks: BimBlock[] = payload ? parseBimBlocks(payload) : [];
  const iptcBlock = blocks.find((block) => block.id === IPTC_RESOURCE_ID);
  const mergedIim = buildIptcIim(iptcBlock?.data ?? null, requests);
  const kept = blocks.filter((block) => block.id !== IPTC_RESOURCE_ID);
  if (mergedIim.length > 0) kept.unshift({ sig: '8BIM', id: IPTC_RESOURCE_ID, data: mergedIim });
  if (kept.length === 0) return null;
  return serializeBimBlocks(kept);
}

const IPTC_RESOURCE_ID = 0x0404;

/**
 * Merges IPTC IIM datasets into a Photoshop IRB payload, preserving unrelated
 * datasets and resources. String-array input remains supported for keywords.
 */
export function mergePhotoshopIrb(payload: Uint8Array | null, keywords: string[]): Uint8Array;
export function mergePhotoshopIrb(payload: Uint8Array | null, requests: IptcWriteRequest[]): Uint8Array | null;
export function mergePhotoshopIrb(
  payload: Uint8Array | null,
  input: string[] | IptcWriteRequest[],
): Uint8Array | null {
  const requests = typeof input[0] === 'string'
    ? requestsFromKeywords(input as string[])
    : input as IptcWriteRequest[];
  return rebuildPhotoshopIrb(payload, requests);
}
