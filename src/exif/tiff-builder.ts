import type { TagValue } from '../types.js';

/**
 * Result of building a TIFF structure.
 * @property bytes - Serialized TIFF bytes
 * @property written - Tag names successfully written
 * @property skipped - Tag names that could not be encoded
 */
export interface BuildTiffResult {
  bytes: Uint8Array;
  written: string[];
  skipped: string[];
}

interface IfdTagSpec {
  id: number;
  type: 2 | 3 | 5; // ASCII, SHORT, RATIONAL
  name: string;
}

const IFD0_TAGS: Record<string, IfdTagSpec> = {
  imagedescription: { id: 0x010E, type: 2, name: 'ImageDescription' },
  make: { id: 0x010F, type: 2, name: 'Make' },
  model: { id: 0x0110, type: 2, name: 'Model' },
  orientation: { id: 0x0112, type: 3, name: 'Orientation' },
  xresolution: { id: 0x011A, type: 5, name: 'XResolution' },
  yresolution: { id: 0x011B, type: 5, name: 'YResolution' },
  resolutionunit: { id: 0x0128, type: 3, name: 'ResolutionUnit' },
  software: { id: 0x0131, type: 2, name: 'Software' },
  datetime: { id: 0x0132, type: 2, name: 'DateTime' },
  modifydate: { id: 0x0132, type: 2, name: 'DateTime' },
  artist: { id: 0x013B, type: 2, name: 'Artist' },
  copyright: { id: 0x8298, type: 2, name: 'Copyright' },
};

function toAscii(value: TagValue): Uint8Array | undefined {
  const s = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
  if (s === undefined) return undefined;
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

/** Accepts a number (scaled by 1000), [num, den], or 'num/den'. */
function toRational(value: TagValue): [number, number] | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? [value, 1] : [Math.round(value * 1000), 1000];
  }
  if (typeof value === 'string') {
    const m = value.match(/^(-?\d+)\/(-?\d+)$/);
    if (m) return [Number(m[1]), Number(m[2])];
    const n = Number(value);
    return Number.isFinite(n) ? toRational(n) : undefined;
  }
  if (Array.isArray(value) && value.length === 2) {
    const [a, b] = value as [unknown, unknown];
    if (typeof a === 'number' && typeof b === 'number') return [a, b];
  }
  return undefined;
}

function encodeValue(
  spec: IfdTagSpec,
  value: TagValue,
): { data: Uint8Array; count: number } | undefined {
  if (spec.type === 2) {
    const ascii = toAscii(value);
    return ascii ? { data: ascii, count: ascii.length } : undefined;
  }
  if (spec.type === 3) {
    let n: number | undefined;
    if (typeof value === 'number') n = Math.round(value);
    else if (typeof value === 'string') {
      const parsed = Number(value);
      n = Number.isFinite(parsed) ? Math.round(parsed) : undefined;
    }
    if (n === undefined || n < 0 || n > 0xFFFF) return undefined;
    return { data: new Uint8Array([n & 255, n >> 8]), count: 1 };
  }
  // RATIONAL
  if (Array.isArray(value)) {
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < value.length; i += 2) {
      const r = toRational([value[i], value[i + 1]]);
      if (!r) return undefined;
      pairs.push(r);
    }
    // deno-coverage-ignore-next-line -- unreachable: the loop above yields
    // one pair per two elements, so an empty list implies zero elements,
    // which the Array.isArray guard never lets through for RATIONAL tags.
    if (pairs.length === 0) return undefined;
    const buf = new ArrayBuffer(pairs.length * 8);
    const dv = new DataView(buf);
    pairs.forEach(([num, den], i) => {
      dv.setUint32(i * 8, num >>> 0, true);
      dv.setUint32(i * 8 + 4, den >>> 0, true);
    });
    return { data: new Uint8Array(buf), count: pairs.length };
  }
  const r = toRational(value);
  if (!r) return undefined;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint32(0, r[0] >>> 0, true);
  dv.setUint32(4, r[1] >>> 0, true);
  return { data: new Uint8Array(dv.buffer), count: 1 };
}

/**
 * Serializes the writable subset of `tags` into a little-endian TIFF
 * structure (single IFD0, no sub-IFDs). Names are resolved through
 * IFD0_TAGS; unrecognized or unencodable names are reported as skipped.
 */
export function buildTiff(tags: Record<string, TagValue>): BuildTiffResult {
  const written: string[] = [];
  const skipped: string[] = [];
  interface Prepared {
    spec: IfdTagSpec;
    data: Uint8Array;
    count: number;
  }
  const prepared: Prepared[] = [];

  for (const [name, value] of Object.entries(tags)) {
    const spec = IFD0_TAGS[name.toLowerCase()];
    if (!spec) {
      skipped.push(name);
      continue;
    }
    const encoded = encodeValue(spec, value);
    if (!encoded) {
      skipped.push(name);
      continue;
    }
    prepared.push({ spec, data: encoded.data, count: encoded.count });
    written.push(spec.name);
  }

  prepared.sort((a, b) => a.spec.id - b.spec.id);

  const ifdOffset = 8;
  const ifdSize = 2 + prepared.length * 12 + 4;
  const valuesOffset = ifdOffset + ifdSize;

  // Lay out oversized values first so offsets are known.
  const valueBlobs: Uint8Array[] = [];
  const valueOffsets = new Map<Prepared, number>();
  let cursor = valuesOffset;
  for (const p of prepared) {
    if (p.data.length > 4) {
      valueOffsets.set(p, cursor);
      valueBlobs.push(p.data);
      cursor += p.data.length;
      if (cursor % 2) {
        valueBlobs.push(new Uint8Array([0]));
        cursor++;
      }
    }
  }

  const total = cursor;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49; // 'II'
  dv.setUint16(2, 0x2A, true);
  dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, prepared.length, true);

  let entryPos = ifdOffset + 2;
  for (const p of prepared) {
    dv.setUint16(entryPos, p.spec.id, true);
    dv.setUint16(entryPos + 2, p.spec.type, true);
    dv.setUint32(entryPos + 4, p.count, true);
    if (p.data.length <= 4) {
      out.set(p.data, entryPos + 8);
    } else {
      dv.setUint32(entryPos + 8, valueOffsets.get(p)!, true);
    }
    entryPos += 12;
  }
  dv.setUint32(entryPos, 0, true); // no next IFD

  let blobPos = valuesOffset;
  for (const blob of valueBlobs) {
    out.set(blob, blobPos);
    blobPos += blob.length;
  }

  return { bytes: out, written, skipped };
}
