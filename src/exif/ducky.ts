import type { TagValue } from '../types.js';
import { UnsupportedFormatError } from '../write/writers.js';

export interface DuckyRequest {
  key: string;
  id: number;
  value: TagValue;
}

interface DuckyBlock {
  id: number;
  bytes: Uint8Array;
}

function readBlocks(payload: Uint8Array): DuckyBlock[] | undefined {
  if (payload.length < 5 || new TextDecoder().decode(payload.subarray(0, 5)) !== 'Ducky') return undefined;
  const blocks: DuckyBlock[] = [];
  let offset = 5;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  while (offset + 4 <= payload.length) {
    const start = offset;
    const id = view.getUint16(offset, false);
    const length = view.getUint16(offset + 2, false);
    offset += 4;
    if (id === 0) return blocks;
    if (offset + length > payload.length) return undefined;
    offset += length;
    blocks.push({ id, bytes: payload.slice(start, offset) });
  }
  return undefined;
}

function utf16be(data: Uint8Array): string {
  const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false);
  const units: number[] = [];
  const end = Math.min(data.length, 4 + count * 2);
  for (let offset = 4; offset + 1 < end; offset += 2) {
    units.push((data[offset]! << 8) | data[offset + 1]!);
  }
  return String.fromCharCode(...units);
}

export function parseDucky(payload: Uint8Array): Record<string, TagValue> {
  const blocks = readBlocks(payload);
  if (!blocks) return {};
  const tags: Record<string, TagValue> = {};
  for (const block of blocks) {
    const data = block.bytes.subarray(4);
    if (block.id === 1 && data.length === 4) {
      tags.Quality = `${new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, false)}%`;
    } else if ((block.id === 2 || block.id === 3) && data.length >= 4) {
      tags[block.id === 2 ? 'Comment' : 'Copyright'] = utf16be(data);
    }
  }
  return tags;
}

function encodeValue(request: DuckyRequest): Uint8Array | null {
  if (request.value === null) return null;
  let data: Uint8Array;
  if (request.id === 1) {
    const raw = typeof request.value === 'number'
      ? request.value
      : typeof request.value === 'string'
        ? Number(request.value.replace(/%$/, '').trim())
        : NaN;
    if (!Number.isInteger(raw) || raw < 0 || raw > 0xffffffff) {
      throw new UnsupportedFormatError(`invalid Ducky Quality value: ${String(request.value)}`);
    }
    data = new Uint8Array(4);
    new DataView(data.buffer).setUint32(0, raw, false);
  } else {
    if (typeof request.value !== 'string') {
      throw new UnsupportedFormatError(`invalid Ducky text value for ${request.key}`);
    }
    const dataView = new DataView(new ArrayBuffer(4 + request.value.length * 2));
    dataView.setUint32(0, request.value.length, false);
    for (let i = 0; i < request.value.length; i++) dataView.setUint16(4 + i * 2, request.value.charCodeAt(i), false);
    data = new Uint8Array(dataView.buffer);
  }
  if (data.length > 0xffff) throw new UnsupportedFormatError(`Ducky ${request.key} exceeds 64 KiB`);
  const block = new Uint8Array(data.length + 4);
  const view = new DataView(block.buffer);
  view.setUint16(0, request.id, false);
  view.setUint16(2, data.length, false);
  block.set(data, 4);
  return block;
}

export function mergeDucky(
  payload: Uint8Array | null,
  requests: DuckyRequest[],
): Uint8Array | null {
  const existing = payload ? readBlocks(payload) : [];
  if (!existing) throw new UnsupportedFormatError('malformed Ducky APP12 block');
  const byId = new Map(requests.map((request) => [request.id, request]));
  const output = new Map<number, Uint8Array>();
  const order: number[] = [];
  for (const block of existing) {
    const request = byId.get(block.id);
    if (!request) {
      if (!output.has(block.id)) order.push(block.id);
      output.set(block.id, block.bytes);
      continue;
    }
    if (output.has(block.id)) continue;
    order.push(block.id);
    const encoded = encodeValue(request);
    if (encoded) output.set(block.id, encoded);
  }
  for (const request of requests) {
    if (order.includes(request.id)) continue;
    order.push(request.id);
    const encoded = encodeValue(request);
    if (encoded) output.set(request.id, encoded);
  }
  const retained = order.flatMap((id) => output.get(id) ?? []);
  if (retained.length === 0) return null;
  const size = 5 + retained.reduce((sum, block) => sum + block.length, 0) + 4;
  const result = new Uint8Array(size);
  result.set(new TextEncoder().encode('Ducky'));
  let offset = 5;
  for (const block of retained) {
    result.set(block, offset);
    offset += block.length;
  }
  return result;
}