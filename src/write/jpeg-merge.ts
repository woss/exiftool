import type { ContainerWriter, TagValue } from '../types.js';
import {
  buildTiff,
  encodeValue,
  EXIF_IFD_TAGS,
  GPS_IFD_TAGS,
  IFD0_TAGS,
  type IfdTagSpec,
} from '../exif/tiff-builder.js';
import { UnsupportedFormatError } from './writers.js';
import {
  toXmpPropertyRequest,
  writeXmpPacket,
  type XmpPropertyRequest,
  type XmpWriteValue,
} from './xmp-writer.js';
import { mergePhotoshopIrb, resolveIptcWriteRequest, type IptcWriteRequest } from './iptc.js';
import { mergeDucky } from '../exif/ducky.js';

/**
 * Merge-write key convention (exported, documented):
 *
 *   EXIF:Copyright              string  -> IFD0 Copyright (0x8298)
 *   EXIF:Orientation            number  -> IFD0 Orientation (0x0112), 1-8
 *   XMP-dc:Rights               string  -> XMP dc:rights (rdf:Alt/li, xml:lang="x-default")
 *   XMP-xmpRights:WebStatement  string  -> XMP xmpRights:WebStatement
 *
 * The group prefix is optional and matching is case-insensitive
 * ('Copyright' == 'exif:copyright', 'WebStatement' == 'xmp-xmpRights:WebStatement').
 * Any other key from IFD0_TAGS/EXIF_IFD_TAGS/GPS_IFD_TAGS may also be written
 * with an 'EXIF:' prefix (e.g. 'EXIF:Make'); it is patched in place when the
 * entry exists, appended when the home IFD exists, and reported as skipped
 * when the tag's home sub-IFD (ExifIFD/GPS) is absent from the file.
 */
export type MergeTagKey =
  | 'EXIF:Copyright'
  | 'EXIF:Orientation'
  | 'XMP-dc:Rights'
  | 'XMP-xmpRights:WebStatement'
  | 'XMP-dc:Subject'
  | 'XMP-dc:Title'
  | 'XMP-dc:Description'
  | 'XMP-xmp:MetadataDate'
  | 'IPTC:Keywords';

export const MERGE_TAG_KEYS: Record<string, MergeTagKey> = {
  'exif:copyright': 'EXIF:Copyright',
  'exif:orientation': 'EXIF:Orientation',
  'xmp-dc:rights': 'XMP-dc:Rights',
  'xmp-xmprights:webstatement': 'XMP-xmpRights:WebStatement',
  'xmp-dc:subject': 'XMP-dc:Subject',
  'xmp-dc:title': 'XMP-dc:Title',
  'xmp-dc:description': 'XMP-dc:Description',
  'xmp-xmp:metadatadate': 'XMP-xmp:MetadataDate',
  'iptc:keywords': 'IPTC:Keywords',
};

export interface ExifRequest {
  /** Canonical reported name */
  key: string;
  spec: IfdTagSpec;
  value: TagValue;
  /** Home IFD: 0 = IFD0, otherwise the sub-IFD pointer tag id */
  home: 0 | 0x8769 | 0x8825;
}

/** Canonical XMP property name for each merge key. */
const XMP_PROPERTY_NAMES: Partial<Record<MergeTagKey, string>> = {
  'XMP-dc:Rights': 'dc:rights',
  'XMP-xmpRights:WebStatement': 'xmpRights:WebStatement',
  'XMP-dc:Subject': 'dc:subject',
  'XMP-dc:Title': 'dc:title',
  'XMP-dc:Description': 'dc:description',
  'XMP-xmp:MetadataDate': 'xmp:MetadataDate',
};

/** Bare aliases (prefix optional): 'Copyright', 'Rights', 'WebStatement', … */
const MERGE_TAG_KEYS_BARE: Record<string, MergeTagKey> = {
  copyright: 'EXIF:Copyright',
  orientation: 'EXIF:Orientation',
  rights: 'XMP-dc:Rights',
  webstatement: 'XMP-xmpRights:WebStatement',
  subject: 'XMP-dc:Subject',
  keywords: 'XMP-dc:Subject',
  title: 'XMP-dc:Title',
  description: 'XMP-dc:Description',
  metadatadate: 'XMP-xmp:MetadataDate',
};

export interface MergeRequests {
  exif: ExifRequest[];
  xmp: XmpPropertyRequest[];
  xmpKeys: string[];
  iptc: IptcWriteRequest[];
  iptcKeys: string[];
  comment?: { key: string; value: string | null };
  jfif: Array<{ key: string; field: 'unit' | 'x' | 'y'; value: number }>;
  icc?: { key: string; value: Uint8Array | null };
  ducky: Array<{ key: string; id: number; value: TagValue }>;
  skipped: string[];
}

const EXIF_IFD_POINTERS = new Set([0x8769, 0x8825, 0xa005]);

export function resolveMergeRequests(tags: Record<string, TagValue>): MergeRequests {
  const exif: ExifRequest[] = [];
  const xmp: XmpPropertyRequest[] = [];
  const xmpKeys: string[] = [];
  const iptc: IptcWriteRequest[] = [];
  const iptcKeys: string[] = [];
  const jfif: MergeRequests['jfif'] = [];
  let icc: MergeRequests['icc'];
  const ducky: MergeRequests['ducky'] = [];
  let comment: MergeRequests['comment'];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (/^(?:jpeg:)?comment$/i.test(key)) {
      if (value === null || typeof value === 'string') comment = { key, value };
      else skipped.push(key);
      continue;
    }
    const jfifMatch = key.match(/^jfif:(resolutionunit|xresolution|yresolution)$/i);
    if (jfifMatch) {
      const fieldName = jfifMatch[1]!.toLowerCase();
      const unitNames: Record<string, number> = { none: 0, inches: 1, inch: 1, cm: 2, centimeters: 2 };
      const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? unitNames[value.trim().toLowerCase()] ?? Number(value)
          : NaN;
      const max = fieldName === 'resolutionunit' ? 2 : 0xffff;
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > max) {
        skipped.push(key);
      } else {
        jfif.push({
          key,
          field: fieldName === 'resolutionunit' ? 'unit' : fieldName === 'xresolution' ? 'x' : 'y',
          value: numeric,
        });
      }
      continue;
    }
    if (/^(?:jpeg:)?icc_profile$/i.test(key)) {
      if (value === null || value instanceof Uint8Array) icc = { key, value };
      else skipped.push(key);
      continue;
    }
    const duckyMatch = key.match(/^ducky:(quality|comment|copyright)$/i);
    if (duckyMatch) {
      const property = duckyMatch[1]!.toLowerCase();
      const id = property === 'quality' ? 1 : property === 'comment' ? 2 : 3;
      const valid = value === null || (id === 1
        ? typeof value === 'number' || typeof value === 'string'
        : typeof value === 'string');
      if (!valid) skipped.push(key);
      else ducky.push({ key, id, value });
      continue;
    }
    const canonical =
      MERGE_TAG_KEYS[key.toLowerCase()] ?? MERGE_TAG_KEYS_BARE[key.toLowerCase()];
    const iptcRequest = resolveIptcWriteRequest(canonical ?? key, value);
    if (iptcRequest) {
      iptc.push(iptcRequest);
      iptcKeys.push(key);
      continue;
    }
    if (canonical === 'EXIF:Copyright') {
      exif.push({ key: canonical, spec: IFD0_TAGS.copyright, value, home: 0 });
    } else if (canonical === 'EXIF:Orientation') {
      exif.push({ key: canonical, spec: IFD0_TAGS.orientation, value, home: 0 });
    } else if (canonical && XMP_PROPERTY_NAMES[canonical]) {
      const ok =
        typeof value === 'string' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string'));
      if (!ok) {
        skipped.push(key);
        continue;
      }
      xmp.push({ name: XMP_PROPERTY_NAMES[canonical]!, value: value as XmpWriteValue });
      xmpKeys.push(canonical);
    } else {
      const xmpRequest = toXmpPropertyRequest(key, value);
      if (xmpRequest) {
        xmp.push(xmpRequest);
        xmpKeys.push(key);
        continue;
      }
      // Generic EXIF tag via optional group prefix.
      const name = key.toLowerCase().replace(/^exif:/, '');
      const spec = IFD0_TAGS[name] ?? EXIF_IFD_TAGS[name] ?? GPS_IFD_TAGS[name];
      if (!spec) {
        skipped.push(key);
        continue;
      }
      const home = EXIF_IFD_TAGS[name] ? 0x8769 : GPS_IFD_TAGS[name] ? 0x8825 : 0;
      exif.push({ key: `EXIF:${spec.name}`, spec, value, home });
    }
  }
  return { exif, xmp, xmpKeys, iptc, iptcKeys, comment, jfif, icc, ducky, skipped };
}

// ---------------------------------------------------------------------------
// JPEG segment walking
// ---------------------------------------------------------------------------

export interface JpegSegment {
  marker: number;
  /** Segment start (the 0xFF marker byte) */
  start: number;
  /** Segment end (exclusive) */
  end: number;
  /** Payload start (after the 2-byte length) for length-bearing segments */
  payloadStart: number;
  payloadEnd: number;
}

export function parseJpegSegments(bytes: Uint8Array): JpegSegment[] {
  const segments: JpegSegment[] = [];
  let pos = 2; // SOI
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda || marker === 0xd9) {
      segments.push({ marker, start: pos, end: bytes.length, payloadStart: pos, payloadEnd: bytes.length });
      pos = bytes.length;
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, start: pos, end: pos + 2, payloadStart: pos, payloadEnd: pos + 2 });
      pos += 2;
      continue;
    }
    if (pos + 2 > bytes.length) break;
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    segments.push({
      marker,
      start: pos,
      end: pos + 2 + len,
      payloadStart: pos + 4,
      payloadEnd: pos + 2 + len,
    });
    pos += 2 + len;
  }
  return segments;
}

function payloadStartsWith(bytes: Uint8Array, seg: JpegSegment, ascii: string): boolean {
  const head = ascii.length;
  if (seg.payloadEnd - seg.payloadStart < head) return false;
  for (let i = 0; i < head; i++) {
    if (bytes[seg.payloadStart + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// TIFF structural merge: parse -> patch -> re-serialize
// ---------------------------------------------------------------------------

interface RawIfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw 4-byte value field for inline entries (byte-identical re-emit). */
  raw4: Uint8Array | null;
  /** Value bytes for offset entries (copied verbatim). */
  data: Uint8Array | null;
  /** Parsed sub-IFD for pointer entries (0x8769/0x8825/0xA005). */
  sub: RawIfd | null;
}

interface RawIfd {
  entries: RawIfdEntry[];
  next: RawIfd | null;
  /** Embedded JPEG thumbnail byte range (IFD0.next chain, 0x0201/0x0202 pair). */
  thumb: Uint8Array | null;
}

interface RawTiff {
  le: boolean;
  ifd0: RawIfd;
}

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

function parseRawIfd(bytes: Uint8Array, dv: DataView, offset: number, le: boolean, depth: number): RawIfd {
  const ifd: RawIfd = { entries: [], next: null, thumb: null };
  if (depth > 4 || offset + 2 > bytes.length) return ifd;
  const count = dv.getUint16(offset, le);
  if (offset + 2 + count * 12 > bytes.length) return ifd;
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const cnt = dv.getUint32(e + 4, le);
    const size = cnt * (TIFF_TYPE_SIZES[type] ?? 1);
    const isPointer = EXIF_IFD_POINTERS.has(tag);
    const raw4 = !isPointer && size <= 4 && size > 0 ? bytes.slice(e + 8, e + 12) : null;
    let data: Uint8Array | null = null;
    let sub: RawIfd | null = null;
    if (isPointer) {
      const ptr = dv.getUint32(e + 8, le);
      sub = parseRawIfd(bytes, dv, ptr, le, depth + 1);
    } else if (size > 4) {
      const off = dv.getUint32(e + 8, le);
      if (off + size <= bytes.length) data = bytes.slice(off, off + size);
    }
    ifd.entries.push({ tag, type, count: cnt, raw4, data, sub });
  }
  // Thumbnail: 0x0201/0x0202 inline LONG pair describes a raw byte range
  // (present when Compression 0x0103 == 6). Preserve it opaquely.
  const comp = ifd.entries.find((e) => e.tag === 0x0103);
  const tOff = ifd.entries.find((e) => e.tag === 0x0201);
  const tLen = ifd.entries.find((e) => e.tag === 0x0202);
  if (tOff?.raw4 && tLen?.raw4 && comp?.raw4 && comp.raw4[0] === 6) {
    const off = dv.getUint32(offset + 2 + ifd.entries.indexOf(tOff) * 12 + 8, le);
    const len = dv.getUint32(offset + 2 + ifd.entries.indexOf(tLen) * 12 + 8, le);
    if (off > 0 && len > 0 && off + len <= bytes.length) {
      ifd.thumb = bytes.slice(off, off + len);
    }
  }
  const nextOff = dv.getUint32(offset + 2 + count * 12, le);
  if (nextOff !== 0) ifd.next = parseRawIfd(bytes, dv, nextOff, le, depth + 1);
  return ifd;
}

export function parseRawTiff(bytes: Uint8Array): RawTiff | undefined {
  if (bytes.length < 8) return undefined;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(2, le) !== 0x2a) return undefined;
  const ifd0Off = dv.getUint32(4, le);
  return { le, ifd0: parseRawIfd(bytes, dv, ifd0Off, le, 0) };
}

/** Walks the IFD chain in emission order: IFD0, its sub-IFDs, then next-IFD chain. */
function collectIfds(ifd0: RawIfd): RawIfd[] {
  const out: RawIfd[] = [];
  let chain: RawIfd | null = ifd0;
  let guard = 0;
  while (chain && guard++ < 8) {
    out.push(chain);
    for (const e of chain.entries) if (e.sub) out.push(e.sub);
    chain = chain.next;
  }
  return out;
}

function serializeRawTiff(t: RawTiff): Uint8Array {
  const ifds = collectIfds(t.ifd0);
  const offsets: number[] = [];
  let cursor = 8;
  for (const ifd of ifds) {
    offsets.push(cursor);
    cursor += 2 + ifd.entries.length * 12 + 4;
  }
  const alignTo2 = (c: number): number => (c % 2 ? c + 1 : c);
  const thumbOffsets = new Map<RawIfd, number>();
  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    if (ifd.thumb) {
      cursor = alignTo2(cursor);
      thumbOffsets.set(ifd, cursor);
      cursor += ifd.thumb.length;
    }
  }
  const blobOffsets = new Map<RawIfdEntry, number>();
  for (let i = 0; i < ifds.length; i++) {
    for (const e of ifds[i].entries) {
      if (!e.sub && e.data !== null && e.data.length > 4) {
        cursor = alignTo2(cursor);
        blobOffsets.set(e, cursor);
        cursor += e.data.length;
      }
    }
  }
  const out = new Uint8Array(cursor);
  const dv = new DataView(out.buffer);
  out[0] = t.le ? 0x49 : 0x4d;
  out[1] = out[0];
  dv.setUint16(2, 0x2a, t.le);
  dv.setUint32(4, 8, t.le);

  const chainOffsets = new Map<RawIfd, number>();
  let chain: RawIfd | null = t.ifd0;
  let guard = 0;
  while (chain && guard++ < 8) {
    chainOffsets.set(chain, chain.next ? offsets[ifds.indexOf(chain.next)] : 0);
    for (const e of chain.entries) {
      if (e.sub) chainOffsets.set(e.sub, offsets[ifds.indexOf(e.sub)]);
    }
  }

  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    const base = offsets[i];
    dv.setUint16(base, ifd.entries.length, t.le);
    for (let j = 0; j < ifd.entries.length; j++) {
      const e = ifd.entries[j];
      const ep = base + 2 + j * 12;
      dv.setUint16(ep, e.tag, t.le);
      dv.setUint16(ep + 2, e.type, t.le);
      dv.setUint32(ep + 4, e.count, t.le);
      if (e.sub) {
        dv.setUint32(ep + 8, chainOffsets.get(e.sub) ?? 0, t.le);
      } else if (e.tag === 0x0201 && ifd.thumb) {
        dv.setUint32(ep + 8, thumbOffsets.get(ifd) ?? 0, t.le);
      } else if (e.raw4 !== null) {
        out.set(e.raw4, ep + 8);
      } else {
        dv.setUint32(ep + 8, blobOffsets.get(e) ?? 0, t.le);
      }
    }
    dv.setUint32(base + 2 + ifd.entries.length * 12, chainOffsets.get(ifd) ?? 0, t.le);
  }

  for (let i = 0; i < ifds.length; i++) {
    for (const e of ifds[i].entries) {
      const off = blobOffsets.get(e);
      if (off === undefined) continue;
      out.set(e.data!, off);
    }
  }
  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    const off = thumbOffsets.get(ifd);
    if (off !== undefined) out.set(ifd.thumb!, off);
  }
  return out;
}

function pad4(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4);
  out.set(data.length > 4 ? data.subarray(0, 4) : data);
  return out;
}

function applyExifPatches(t: RawTiff, reqs: ExifRequest[]): string[] {
  const written: string[] = [];
  const homeIfd = (home: 0 | 0x8769 | 0x8825): RawIfd | null => {
    if (home === 0) return t.ifd0;
    let ptr = t.ifd0.entries.find((e) => e.tag === home);
    if (!ptr) {
      const sub: RawIfd = { entries: [], next: null, thumb: null };
      ptr = { tag: home, type: 4, count: 1, raw4: null, data: null, sub };
      const at = t.ifd0.entries.findIndex((e) => e.tag > home);
      if (at === -1) t.ifd0.entries.push(ptr);
      else t.ifd0.entries.splice(at, 0, ptr);
    } else if (!ptr.sub) {
      ptr.sub = { entries: [], next: null, thumb: null };
    }
    return ptr.sub;
  };
  for (const req of reqs) {
    const target = homeIfd(req.home);
    if (!target) continue;
    if (req.value === null) {
      const index = target.entries.findIndex((e) => e.tag === req.spec.id);
      if (index !== -1) {
        target.entries.splice(index, 1);
        written.push(req.key);
      }
      continue;
    }
    const encoded = encodeValue(req.spec, req.value, t.le);
    if (!encoded) continue;
    let entry = target.entries.find((e) => e.tag === req.spec.id);
    if (entry) {
      entry.type = req.spec.type;
      entry.count = encoded.count;
      entry.raw4 = encoded.data.length <= 4 ? pad4(encoded.data) : null;
      entry.data = encoded.data;
    } else {
      entry = {
        tag: req.spec.id,
        type: req.spec.type,
        count: encoded.count,
        raw4: encoded.data.length <= 4 ? pad4(encoded.data) : null,
        data: encoded.data,
        sub: null,
      };
      const at = target.entries.findIndex((e) => e.tag > req.spec.id);
      if (at === -1) target.entries.push(entry);
      else target.entries.splice(at, 0, entry);
    }
    written.push(req.key);
  }
  t.ifd0.entries = t.ifd0.entries.filter(
    (entry) => !entry.sub || entry.sub.entries.length > 0 || entry.sub.next || entry.sub.thumb,
  );
  return written;
}

/**
 * Merges EXIF requests into an existing TIFF block, preserving every
 * untouched entry's value bytes verbatim (including MakerNotes and IFD1
 * thumbnails) and recomputing all structure offsets.
 */
export function mergeExifTiff(
  tiff: Uint8Array,
  reqs: ExifRequest[],
): { bytes: Uint8Array; written: string[]; skipped: string[] } {
  const parsed = parseRawTiff(tiff);
  if (!parsed) throw new UnsupportedFormatError('malformed EXIF TIFF block');
  const written = applyExifPatches(parsed, reqs);
  const skipped = reqs.filter((r) => !written.includes(r.key)).map((r) => r.key);
  return { bytes: serializeRawTiff(parsed), written, skipped };
}

// ---------------------------------------------------------------------------
// JPEG merge writer
// ---------------------------------------------------------------------------

const XMP_APP1_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

function app1Segment(payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) {
    throw new UnsupportedFormatError('APP1 segment exceeds 64 KiB JPEG limit');
  }
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  const len = payload.length + 2;
  seg[2] = (len >> 8) & 0xff;
  seg[3] = len & 0xff;
  seg.set(payload, 4);
  return seg;
}

function app13Segment(payload: Uint8Array): Uint8Array {
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xed;
  const len = payload.length + 2;
  seg[2] = (len >> 8) & 0xff;
  seg[3] = len & 0xff;
  seg.set(payload, 4);
  return seg;
}

function app12Segment(payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) throw new UnsupportedFormatError('APP12 segment exceeds 65,533 bytes');
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xec;
  const length = payload.length + 2;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  return segment;
}

function jpegCommentSegments(value: string): Uint8Array[] {
  const data = new TextEncoder().encode(value);
  const segments: Uint8Array[] = [];
  for (let offset = 0; offset < data.length || (data.length === 0 && offset === 0); offset += 0xffff - 2) {
    const part = data.subarray(offset, Math.min(offset + 0xffff - 2, data.length));
    const segment = new Uint8Array(part.length + 4);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    const length = part.length + 2;
    segment[2] = length >> 8;
    segment[3] = length & 0xff;
    segment.set(part, 4);
    segments.push(segment);
  }
  return segments;
}

function jfifSegment(originalPayload: Uint8Array | null, requests: MergeRequests['jfif']): Uint8Array {
  const payload = originalPayload
    ? originalPayload.slice()
    : new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 1, 0, 0x48, 0, 0x48, 0, 0]);
  if (payload.length < 14 || !payloadStartsWith(payload, {
    marker: 0xe0,
    start: 0,
    end: payload.length,
    payloadStart: 0,
    payloadEnd: payload.length,
  }, 'JFIF\0')) {
    throw new UnsupportedFormatError('malformed JFIF APP0 segment');
  }
  for (const request of requests) {
    if (request.field === 'unit') payload[7] = request.value;
    else if (request.field === 'x') {
      payload[8] = request.value >> 8;
      payload[9] = request.value & 0xff;
    } else {
      payload[10] = request.value >> 8;
      payload[11] = request.value & 0xff;
    }
  }
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  const length = payload.length + 2;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  return segment;
}

function iccProfileSegments(profile: Uint8Array): Uint8Array[] {
  const headerLength = 14;
  const maxDataLength = 0xffff - 2 - headerLength;
  const total = Math.max(1, Math.ceil(profile.length / maxDataLength));
  if (total > 255) throw new UnsupportedFormatError('ICC profile requires more than 255 JPEG APP2 segments');
  const signature = new TextEncoder().encode('ICC_PROFILE\0');
  const segments: Uint8Array[] = [];
  for (let index = 0; index < total; index++) {
    const data = profile.subarray(index * maxDataLength, Math.min((index + 1) * maxDataLength, profile.length));
    const payload = new Uint8Array(headerLength + data.length);
    payload.set(signature);
    payload[12] = index + 1;
    payload[13] = total;
    payload.set(data, headerLength);
    const segment = new Uint8Array(payload.length + 4);
    segment[0] = 0xff;
    segment[1] = 0xe2;
    const length = payload.length + 2;
    segment[2] = length >> 8;
    segment[3] = length & 0xff;
    segment.set(payload, 4);
    segments.push(segment);
  }
  return segments;
}

/**
 * JPEG merge writer: changes ONLY the requested tags.
 *
 * EXIF lives in the first APP1 'Exif\0\0' segment: its TIFF block is
 * structurally rebuilt with untouched entry values copied verbatim, so
 * MakerNotes, IFD1 thumbnails, GPS and ExifIFD data survive byte-for-byte.
 * XMP lives in the first APP1 'http://ns.adobe.com/xap/1.0/\0' segment: the
 * two rights properties are spliced into the existing packet, or a minimal
 * conformant packet is created when none exists. All other segments
 * (IPTC APP13, ICC APP2, C2PA APP11, …) are copied verbatim.
 *
 * Known limitation (pre-existing, shared with the whole mergeExifTiff
 * path): the TIFF rebuild shifts value areas, so MakerNotes blobs whose
 * internal offsets are absolute from the TIFF header (e.g. Olympus) lose
 * their internal offsets when entries are ADDED. Existing-entry patches
 * and makernote-relative formats (Canon, Nikon) are unaffected. Reference
 * exiftool fixes this with per-maker offset logic — out of scope here;
 * XMP/IPTC-only writes never touch the EXIF TIFF block.
 */
export const jpegMergeWriter: ContainerWriter = (original, tags) => {
  if (original.length < 4 || original[0] !== 0xff || original[1] !== 0xd8) {
    throw new UnsupportedFormatError('not a JPEG stream');
  }
  const reqs = resolveMergeRequests(tags);
  const segments = parseJpegSegments(original);
  const exifSeg = segments.find(
    (s) => s.marker === 0xe1 && payloadStartsWith(original, s, 'Exif\0\0'),
  );
  const xmpSeg = segments.find(
    (s) => s.marker === 0xe1 && payloadStartsWith(original, s, XMP_APP1_HEADER),
  );
  const psApp13 = segments.find(
    (s) => s.marker === 0xed && payloadStartsWith(original, s, 'Photoshop 3.0\0'),
  );
  const comments = segments.filter((s) => s.marker === 0xfe);
  const jfifSeg = segments.find((s) => s.marker === 0xe0 && payloadStartsWith(original, s, 'JFIF\0'));
  const adobeSeg = segments.find((s) => s.marker === 0xee && payloadStartsWith(original, s, 'Adobe'));
  const iccSegments = segments.filter((s) => s.marker === 0xe2 && payloadStartsWith(original, s, 'ICC_PROFILE\0'));
  const duckySeg = segments.find((s) => s.marker === 0xec && payloadStartsWith(original, s, 'Ducky'));

  const written: string[] = [];
  const skipped: string[] = [...reqs.skipped];

  // --- EXIF ---
  let exifPayload: Uint8Array | null = null;
  if (reqs.exif.length > 0) {
    if (exifSeg) {
      const tiff = original.subarray(exifSeg.payloadStart + 6, exifSeg.payloadEnd);
      const merged = mergeExifTiff(tiff, reqs.exif);
      exifPayload = merged.bytes;
      written.push(...merged.written);
      skipped.push(...merged.skipped);
    } else {
      const fresh: Record<string, TagValue> = {};
      for (const r of reqs.exif) fresh[r.spec.name] = r.value;
      const built = buildTiff(fresh);
      exifPayload = built.bytes;
      written.push(...reqs.exif.filter((r) => built.written.includes(r.spec.name)).map((r) => r.key));
      skipped.push(...reqs.exif.filter((r) => !built.written.includes(r.spec.name)).map((r) => r.key));
    }
  }

  // --- XMP ---
  let xmpPayload: Uint8Array | null = null;
  if (reqs.xmp.length > 0) {
    const packet = xmpSeg
      ? new TextDecoder().decode(original.subarray(xmpSeg.payloadStart + XMP_APP1_HEADER.length, xmpSeg.payloadEnd))
      : null;
    const merged = writeXmpPacket(packet, reqs.xmp);
    xmpPayload = new TextEncoder().encode(merged);
    written.push(...reqs.xmpKeys);
  }

  // --- IPTC (APP13 Photoshop IRB) ---
  let iptcPayload: Uint8Array | null = null;
  let iptcTouched = false;
  if (reqs.iptc.length > 0) {
    iptcTouched = true;
    const existingPayload = psApp13
      ? original.subarray(psApp13.payloadStart, psApp13.payloadEnd)
      : null;
    iptcPayload = mergePhotoshopIrb(existingPayload, reqs.iptc);
    if (iptcPayload && iptcPayload.length + 2 > 0xffff) {
      throw new UnsupportedFormatError('APP13 segment exceeds 64 KiB JPEG limit');
    }
    written.push(...reqs.iptcKeys);
  }

  // --- Reassemble: sorted splice list over the original bytes ---
  interface Edit { at: number; end: number; bytes: Uint8Array | null }
  const edits: Edit[] = [];
  const withHeader = (ascii: string, payload: Uint8Array): Uint8Array => {
    const header = new TextEncoder().encode(ascii);
    const out = new Uint8Array(header.length + payload.length);
    out.set(header);
    out.set(payload, header.length);
    return app1Segment(out);
  };
  if (exifPayload) {
    const seg = withHeader('Exif\0\0', exifPayload);
    edits.push(exifSeg ? { at: exifSeg.start, end: exifSeg.end, bytes: seg } : { at: 2, end: 2, bytes: seg });
  }
  if (xmpPayload) {
    const seg = withHeader(XMP_APP1_HEADER, xmpPayload);
    if (xmpSeg) {
      edits.push({ at: xmpSeg.start, end: xmpSeg.end, bytes: seg });
    } else if (exifSeg) {
      edits.push({ at: exifSeg.end, end: exifSeg.end, bytes: seg });
    } else {
      // Both fresh: insert both at the SOI boundary; stable sort keeps
      // EXIF first, XMP second.
      edits.push({ at: 2, end: 2, bytes: seg });
    }
  }
  if (iptcTouched && iptcPayload) {
    const seg = app13Segment(iptcPayload);
    if (psApp13) {
      edits.push({ at: psApp13.start, end: psApp13.end, bytes: seg });
    } else {
      // Fresh APP13: after the last APP0/APP1 metadata segment, else SOI.
      const anchor = xmpSeg ?? exifSeg;
      edits.push(anchor ? { at: anchor.end, end: anchor.end, bytes: seg } : { at: 2, end: 2, bytes: seg });
    }
  } else if (iptcTouched && psApp13) {
    edits.push({ at: psApp13.start, end: psApp13.end, bytes: null });
  }
  if (reqs.comment) {
    const replacement = reqs.comment.value === null ? [] : jpegCommentSegments(reqs.comment.value);
    if (comments.length > 0) {
      edits.push({
        at: comments[0]!.start,
        end: comments[0]!.end,
        bytes: replacement[0] ?? null,
      });
      for (const comment of comments.slice(1)) {
        edits.push({ at: comment.start, end: comment.end, bytes: null });
      }
      for (const segment of replacement.slice(1)) {
        edits.push({ at: comments[0]!.end, end: comments[0]!.end, bytes: segment });
      }
    } else if (replacement.length > 0) {
      const scan = segments.find((segment) => segment.marker === 0xda);
      const eoi = segments.find((segment) => segment.marker === 0xd9);
      const at = scan?.start ?? eoi?.start ?? original.length;
      for (const segment of replacement) edits.push({ at, end: at, bytes: segment });
    }
    written.push(reqs.comment.key);
  }
  if (reqs.jfif.length > 0) {
    if (!jfifSeg && adobeSeg) {
      skipped.push(...reqs.jfif.map((request) => request.key));
    } else {
      const payload = jfifSeg
        ? original.subarray(jfifSeg.payloadStart, jfifSeg.payloadEnd)
        : null;
      const replacement = jfifSegment(payload, reqs.jfif);
      if (jfifSeg) edits.push({ at: jfifSeg.start, end: jfifSeg.end, bytes: replacement });
      else edits.push({ at: 2, end: 2, bytes: replacement });
      written.push(...reqs.jfif.map((request) => request.key));
    }
  }
  if (reqs.icc) {
    for (const segment of iccSegments) edits.push({ at: segment.start, end: segment.end, bytes: null });
    if (reqs.icc.value) {
      const replacements = iccProfileSegments(reqs.icc.value);
      if (iccSegments.length > 0) {
        edits.push({ at: iccSegments[0]!.start, end: iccSegments[0]!.start, bytes: replacements[0]! });
        for (const segment of replacements.slice(1)) {
          edits.push({ at: iccSegments[0]!.start, end: iccSegments[0]!.start, bytes: segment });
        }
      } else {
        const anchor = segments.find((segment) => segment.marker === 0xda)?.start ??
          segments.find((segment) => segment.marker === 0xd9)?.start ?? original.length;
        for (const segment of replacements) edits.push({ at: anchor, end: anchor, bytes: segment });
      }
    }
    written.push(reqs.icc.key);
  }
  if (reqs.ducky.length > 0) {
    const existing = duckySeg
      ? original.subarray(duckySeg.payloadStart, duckySeg.payloadEnd)
      : null;
    const updated = mergeDucky(existing, reqs.ducky);
    if (updated && updated.length + 2 > 0xffff) {
      throw new UnsupportedFormatError('Ducky APP12 segment exceeds 65,533 bytes');
    }
    if (duckySeg) {
      edits.push({ at: duckySeg.start, end: duckySeg.end, bytes: updated ? app12Segment(updated) : null });
    } else if (updated) {
      const anchor = segments.find((segment) => segment.marker === 0xda)?.start ??
        segments.find((segment) => segment.marker === 0xd9)?.start ?? original.length;
      edits.push({ at: anchor, end: anchor, bytes: app12Segment(updated) });
    }
    written.push(...reqs.ducky.map((request) => request.key));
  }
  edits.sort((a, b) => a.at - b.at);
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const ed of edits) {
    if (ed.at > pos) parts.push(original.subarray(pos, ed.at));
    if (ed.bytes) parts.push(ed.bytes);
    pos = Math.max(pos, ed.end);
  }
  if (pos < original.length) parts.push(original.subarray(pos));

  let total = 0;
  for (const p of parts) total += p.length;
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, written, skipped };
};
