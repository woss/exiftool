import type { TagValue } from '../types.js';
import { buildTiff } from '../exif/tiff-builder.js';
import { crc32 } from '../utils/crc32.js';

export interface WriteOutcome {
  bytes: Uint8Array;
  written: string[];
  skipped: string[];
}

export type ContainerWriter = (
  original: Uint8Array,
  tags: Record<string, TagValue>,
) => WriteOutcome;

export class UnsupportedFormatError extends Error {}

function u32be(arr: number[], v: number): void {
  arr.push((v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
}
function u32le(arr: number[], v: number): void {
  arr.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
}

/** JPEG: replaces every APP1 'Exif\0\0' segment with one rebuilt segment. */
export const jpegWriter: ContainerWriter = (original, tags) => {
  if (original.length < 4 || original[0] !== 0xFF || original[1] !== 0xD8) {
    throw new UnsupportedFormatError('not a JPEG stream');
  }
  const { bytes: tiff, written, skipped } = buildTiff(tags);
  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // 'Exif\0\0'
  const segLen = app1Payload.length + 2;

  const parts: number[][] = [
    [0xFF, 0xD8],
    [0xFF, 0xE1, (segLen >> 8) & 255, segLen & 255, ...app1Payload],
  ];
  let pos = 2;
  while (pos + 4 <= original.length) {
    if (original[pos] !== 0xFF) break;
    const marker = original[pos + 1];
    if (marker === 0xDA || marker === 0xD9) {
      parts.push([...original.subarray(pos)]);
      pos = original.length;
      break;
    }
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
      parts.push([0xFF, marker]);
      pos += 2;
      continue;
    }
    const segLenOrig = (original[pos + 2] << 8) | original[pos + 3];
    const isExifApp1 =
      marker === 0xE1 && segLenOrig >= 8 &&
      original[pos + 4] === 0x45 && original[pos + 5] === 0x78 &&
      original[pos + 6] === 0x69 && original[pos + 7] === 0x66 &&
      original[pos + 8] === 0x00 && original[pos + 9] === 0x00;
    if (!isExifApp1) {
      parts.push([...original.subarray(pos, pos + 2 + segLenOrig)]);
    }
    pos += 2 + segLenOrig;
  }

  return { bytes: new Uint8Array(parts.flat()), written, skipped };
};

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** PNG: drops existing eXIf chunks and inserts one after IHDR. */
export const pngWriter: ContainerWriter = (original, tags) => {
  for (let i = 0; i < 8; i++) {
    if (original[i] !== PNG_SIG[i]) throw new UnsupportedFormatError('not a PNG stream');
  }
  const { bytes: tiff, written, skipped } = buildTiff(tags);
  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);

  const kept: Array<{ type: string; data: Uint8Array }> = [];
  let inserted = false;
  let pos = 8;
  while (pos + 12 <= original.length) {
    const length = dv.getUint32(pos, false);
    const type = String.fromCharCode(...original.subarray(pos + 4, pos + 8));
    const data = original.slice(pos + 8, pos + 8 + length);
    if (pos + 12 + length > original.length) break; // truncated tail
    pos += 12 + length;
    if (type === 'IEND' || type === 'eXIf') continue;
    kept.push({ type, data });
    if (type === 'IHDR') {
      kept.push({ type: 'eXIf', data: tiff });
      inserted = true;
    }
  }
  if (!inserted) throw new UnsupportedFormatError('PNG has no IHDR chunk');

  const out: number[] = [...PNG_SIG];
  for (const chunk of kept) {
    u32be(out, chunk.data.length);
    const crcInput = new Uint8Array(4 + chunk.data.length);
    for (let i = 0; i < 4; i++) crcInput[i] = chunk.type.charCodeAt(i);
    crcInput.set(chunk.data, 4);
    for (const c of chunk.type) out.push(c.charCodeAt(0));
    out.push(...chunk.data);
    u32be(out, crc32(crcInput));
  }
  u32be(out, 0);
  for (const c of 'IEND') out.push(c.charCodeAt(0));
  return { bytes: new Uint8Array(out), written, skipped };
};

/**
 * WebP: requires an existing VP8X chunk (sets its EXIF flag), removes old
 * EXIF chunks and inserts the fresh one directly after VP8X.
 */
export const webpWriter: ContainerWriter = (original, tags) => {
  const riff = String.fromCharCode(...original.subarray(0, 4));
  const webp = String.fromCharCode(...original.subarray(8, 12));
  if (riff !== 'RIFF' || webp !== 'WEBP') {
    throw new UnsupportedFormatError('not a WebP stream');
  }
  const { bytes: tiff, written, skipped } = buildTiff(tags);
  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);

  interface Chunk { id: string; data: Uint8Array }
  const chunks: Chunk[] = [];
  let pos = 12;
  while (pos + 8 <= original.length) {
    const id = String.fromCharCode(...original.subarray(pos, pos + 4));
    const size = dv.getUint32(pos + 4, true);
    chunks.push({ id, data: original.slice(pos + 8, pos + 8 + size) });
    pos += 8 + size + (size % 2);
  }

  const vp8x = chunks.find((c) => c.id === 'VP8X');
  if (!vp8x) throw new UnsupportedFormatError('WebP writing requires a VP8X chunk');
  const vp8xData = Uint8Array.from(vp8x.data);
  vp8xData[0] |= 0x08; // EXIF flag

  const out: number[] = [];
  for (const c of 'RIFF') out.push(c.charCodeAt(0));
  const sizeHolder = out.length;
  u32le(out, 0); // patched below
  for (const c of 'WEBP') out.push(c.charCodeAt(0));

  const pushChunk = (id: string, data: Uint8Array) => {
    for (const c of id) out.push(c.charCodeAt(0));
    u32le(out, data.length);
    out.push(...data);
    if (data.length % 2) out.push(0);
  };

  pushChunk('VP8X', vp8xData);
  pushChunk('EXIF', new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff])); // 'Exif\0\0' prefix
  for (const c of chunks) {
    if (c.id === 'EXIF' || c.id === 'VP8X') continue;
    pushChunk(c.id, c.data);
  }

  const payloadSize = out.length - sizeHolder - 4;
  out[sizeHolder] = payloadSize & 255;
  out[sizeHolder + 1] = (payloadSize >> 8) & 255;
  out[sizeHolder + 2] = (payloadSize >> 16) & 255;
  out[sizeHolder + 3] = (payloadSize >> 24) & 255;
  return { bytes: new Uint8Array(out), written, skipped };
};

function box(type: string, payload: number[]): number[] {
  const out: number[] = [];
  u32be(out, payload.length + 8);
  for (const c of type) out.push(c.charCodeAt(0));
  return [...out, ...payload];
}

function fullBox(type: string, versionAndFlags: number[], payload: number[]): number[] {
  return box(type, [...versionAndFlags, ...payload]);
}

function chars(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/**
 * AVIF: replaces the Exif item payload inside an existing meta box, or
 * appends a fresh minimal meta box (hdlr/pitm/iinf/Exif) after ftyp when
 * none exists. iloc tables of pre-existing files are left untouched —
 * readers in this project locate the Exif box structurally.
 */
export const avifWriter: ContainerWriter = (original, tags) => {
  if (String.fromCharCode(...original.subarray(4, 8)) !== 'ftyp') {
    throw new UnsupportedFormatError('not an ISOBMFF/AVIF stream');
  }
  const { bytes: tiff, written, skipped } = buildTiff(tags);

  const exifBox = box('Exif', [0, 0, 0, 4, ...tiff]); // offset prefix -> TIFF starts after it

  const dv = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const topLevel: Array<{ type: string; start: number; total: number }> = [];
  let pos = 0;
  while (pos + 8 <= original.length) {
    const size = dv.getUint32(pos, false);
    const type = String.fromCharCode(...original.subarray(pos + 4, pos + 8));
    const total = size === 0 ? original.length - pos : size;
    if (total < 8 || pos + total > original.length) break;
    topLevel.push({ type, start: pos, total });
    pos += total;
  }

  const metaTop = topLevel.find((b) => b.type === 'meta');
  let metaBytes: number[];
  if (metaTop) {
    const children: number[] = [];
    let cpos = metaTop.start + 8; // plain box: children follow the header
    const metaEnd = metaTop.start + metaTop.total;
    while (cpos + 8 <= metaEnd) {
      const csize = dv.getUint32(cpos, false);
      const ctype = String.fromCharCode(...original.subarray(cpos + 4, cpos + 8));
      // Malformed children are dropped so the rebuilt meta box stays
      // parseable; well-formed non-Exif siblings are preserved.
      const wellFormed = csize >= 8 && cpos + csize <= metaEnd;
      if (wellFormed && ctype !== 'Exif') {
        children.push(...original.subarray(cpos, cpos + csize));
      }
      cpos += wellFormed ? csize : 8;
    }
    metaBytes = box('meta', [...children, ...exifBox]);
  } else {
    const hdlr = fullBox(
      'hdlr',
      [0, 0, 0, 0],
      [0, 0, 0, 0, ...chars('pict'), 0, 0, 0, 0, 0],
    );
    const pitm = fullBox('pitm', [0, 0, 0, 0], [0, 1]);
    const infe = fullBox('infe', [2, 0, 0], [0, 1, 0, 0, ...chars('Exif'), 0]);
    const iinf = fullBox('iinf', [0, 0, 0, 0], [0, 1, ...infe]);
    metaBytes = box('meta', [
      ...box('hdlr', hdlr.slice(8)),
      ...box('pitm', pitm.slice(8)),
      ...box('iinf', iinf.slice(8)),
      ...exifBox,
    ]);
  }

  const out: number[] = [];
  for (const b of topLevel) {
    if (b.type === 'meta') {
      out.push(...metaBytes);
    } else {
      out.push(...original.subarray(b.start, b.start + b.total));
      if (b.type === 'ftyp' && !metaTop) out.push(...metaBytes);
    }
  }
  return { bytes: new Uint8Array(out), written, skipped };
};
