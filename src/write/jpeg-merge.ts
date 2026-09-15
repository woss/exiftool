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
  | 'XMP-xmpRights:WebStatement';

export const MERGE_TAG_KEYS: Record<string, MergeTagKey> = {
  'exif:copyright': 'EXIF:Copyright',
  'exif:orientation': 'EXIF:Orientation',
  'xmp-dc:rights': 'XMP-dc:Rights',
  'xmp-xmprights:webstatement': 'XMP-xmpRights:WebStatement',
};

interface ExifRequest {
  /** Canonical reported name */
  key: string;
  spec: IfdTagSpec;
  value: TagValue;
  /** Home IFD: 0 = IFD0, otherwise the sub-IFD pointer tag id */
  home: 0 | 0x8769 | 0x8825;
}

interface XmpProps {
  rights?: string;
  webStatement?: string;
}

/** Bare aliases (prefix optional): 'Copyright', 'Rights', 'WebStatement', … */
const MERGE_TAG_KEYS_BARE: Record<string, MergeTagKey> = {
  copyright: 'EXIF:Copyright',
  orientation: 'EXIF:Orientation',
  rights: 'XMP-dc:Rights',
  webstatement: 'XMP-xmpRights:WebStatement',
};

interface MergeRequests {
  exif: ExifRequest[];
  xmp: XmpProps;
  xmpKeys: string[];
  skipped: string[];
}

const EXIF_IFD_POINTERS = new Set([0x8769, 0x8825, 0xa005]);

function resolveMergeRequests(tags: Record<string, TagValue>): MergeRequests {
  const exif: ExifRequest[] = [];
  const xmp: XmpProps = {};
  const xmpKeys: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    const canonical =
      MERGE_TAG_KEYS[key.toLowerCase()] ?? MERGE_TAG_KEYS_BARE[key.toLowerCase()];
    if (canonical === 'EXIF:Copyright') {
      exif.push({ key: canonical, spec: IFD0_TAGS.copyright, value, home: 0 });
    } else if (canonical === 'EXIF:Orientation') {
      exif.push({ key: canonical, spec: IFD0_TAGS.orientation, value, home: 0 });
    } else if (canonical === 'XMP-dc:Rights') {
      if (typeof value === 'string') {
        xmp.rights = value;
        xmpKeys.push(canonical);
      } else skipped.push(key);
    } else if (canonical === 'XMP-xmpRights:WebStatement') {
      if (typeof value === 'string') {
        xmp.webStatement = value;
        xmpKeys.push(canonical);
      } else skipped.push(key);
    } else {
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
  return { exif, xmp, xmpKeys, skipped };
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
  while (pos + 4 <= bytes.length) {
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
    const ptr = t.ifd0.entries.find((e) => e.tag === home);
    return ptr?.sub ?? null;
  };
  for (const req of reqs) {
    const encoded = encodeValue(req.spec, req.value, t.le);
    if (!encoded) continue;
    const target = homeIfd(req.home);
    if (!target) continue;
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
// XMP packet merge / create
// ---------------------------------------------------------------------------

const NS_DC = 'http://purl.org/dc/elements/1.1/';
const NS_XMP_RIGHTS = 'http://ns.adobe.com/xap/1.0/rights/';

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ensureRdfNamespace(xml: string, attr: string, ns: string): string {
  const open = xml.indexOf('<rdf:RDF');
  if (open === -1) return xml;
  const close = xml.indexOf('>', open);
  const tag = xml.slice(open, close);
  if (tag.includes(`${attr}=`)) return xml;
  return xml.slice(0, close) + ` ${attr}="${ns}"` + xml.slice(close);
}

/**
 * Span of the first TOP-LEVEL rdf:Description (Camera Raw packets nest
 * further rdf:Description elements inside crs structures — those must be
 * left untouched). Returns [openTagEnd, closeTagStart], or undefined.
 */
function topLevelDescriptionSpan(xml: string): [number, number] | undefined {
  const first = xml.indexOf('<rdf:Description');
  if (first === -1) return undefined;
  const selfClosing = /^<rdf:Description[^>]*\/>/;
  const openEnd = xml.indexOf('>', first);
  if (openEnd === -1) return undefined;
  if (selfClosing.test(xml.slice(first, openEnd + 1))) return undefined;
  const tokenRe = /<rdf:Description(?:\s[^>]*)?>|<\/rdf:Description>/g;
  tokenRe.lastIndex = openEnd + 1;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) return [openEnd + 1, m.index];
    } else {
      depth++;
    }
  }
  return undefined;
}

function upsertXmpProperty(xml: string, name: string, element: string): string {
  // Attribute form on the top-level description open tag: drop it first
  // (element form wins), so the span below is computed on the final xml.
  const descOpen = xml.indexOf('<rdf:Description');
  if (descOpen !== -1) {
    const descClose = xml.indexOf('>', descOpen);
    const tag = xml.slice(descOpen, descClose);
    const attrRe = new RegExp(`\\s${name}="[^"]*"`);
    if (attrRe.test(tag)) {
      xml = xml.slice(0, descOpen) + tag.replace(attrRe, '') + xml.slice(descClose);
    }
  }
  const span = topLevelDescriptionSpan(xml);
  if (!span) return xml;
  const [start, end] = span;
  const inner = xml.slice(start, end);
  // Existing element form inside the top-level description: replace it.
  const elRe = new RegExp(`<${name}(?:\\s[^>]*)?/>|<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`);
  if (elRe.test(inner)) {
    return xml.slice(0, start) + inner.replace(elRe, element) + xml.slice(end);
  }
  // Insert before the top-level description's closing tag.
  return xml.slice(0, end) + element + xml.slice(end);
}

/**
 * Splices rights/webStatement into an existing XMP packet without
 * re-serializing anything else: namespaces are added to rdf:RDF when
 * missing, properties are upserted inside the first top-level
 * rdf:Description.
 */
export function mergeXmpPacket(packet: string, props: XmpProps): string {
  let out = packet;
  if (props.rights !== undefined) {
    out = ensureRdfNamespace(out, 'xmlns:dc', NS_DC);
    const el = `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(props.rights)}</rdf:li></rdf:Alt></dc:rights>`;
    out = upsertXmpProperty(out, 'dc:rights', el);
  }
  if (props.webStatement !== undefined) {
    out = ensureRdfNamespace(out, 'xmlns:xmpRights', NS_XMP_RIGHTS);
    const el = `<xmpRights:WebStatement>${xmlEscape(props.webStatement)}</xmpRights:WebStatement>`;
    out = upsertXmpProperty(out, 'xmpRights:WebStatement', el);
  }
  return out;
}
/** Minimal conformant XMP packet carrying the requested rights properties. */
export function buildXmpPacket(props: XmpProps): string {
  let children = '';
  if (props.rights !== undefined) {
    children += `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(props.rights)}</rdf:li></rdf:Alt></dc:rights>`;
  }
  if (props.webStatement !== undefined) {
    children += `<xmpRights:WebStatement>${xmlEscape(props.webStatement)}</xmpRights:WebStatement>`;
  }
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="exiftool-ts">\n` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="${NS_DC}" xmlns:xmpRights="${NS_XMP_RIGHTS}">\n` +
    `<rdf:Description rdf:about="">${children}</rdf:Description>\n` +
    `</rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
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
  if (reqs.xmp.rights !== undefined || reqs.xmp.webStatement !== undefined) {
    const packet = xmpSeg
      ? new TextDecoder().decode(original.subarray(xmpSeg.payloadStart + XMP_APP1_HEADER.length, xmpSeg.payloadEnd))
      : null;
    const merged = packet ? mergeXmpPacket(packet, reqs.xmp) : buildXmpPacket(reqs.xmp);
    xmpPayload = new TextEncoder().encode(merged);
    written.push(...reqs.xmpKeys);
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
