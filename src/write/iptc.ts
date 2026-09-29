import { UnsupportedFormatError } from './writers.js';

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

function buildIptcIim(keywords: string[]): Uint8Array {
  const parts: Uint8Array[] = [iimDataset(1, 90, UTF8_ESCAPE)];
  for (const kw of keywords) {
    parts.push(iimDataset(2, 25, new TextEncoder().encode(kw)));
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const IPTC_RESOURCE_ID = 0x0404;

/**
 * Merges keywords into a Photoshop IRB payload, or builds a minimal one
 * when `payload` is null. Returns the full APP13 segment payload
 * (including the "Photoshop 3.0\0" header).
 */
export function mergePhotoshopIrb(payload: Uint8Array | null, keywords: string[]): Uint8Array {
  const blocks: BimBlock[] = payload ? parseBimBlocks(payload) : [];
  const kept = blocks.filter((b) => b.id !== IPTC_RESOURCE_ID);
  // 0x0404 stays first when present (Photoshop writes it near the front);
  // otherwise insert after the header.
  return serializeBimBlocks([
    { sig: '8BIM', id: IPTC_RESOURCE_ID, data: buildIptcIim(keywords) },
    ...kept,
  ]);
}
