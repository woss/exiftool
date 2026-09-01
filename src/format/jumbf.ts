import type { TagValue } from '../types.js';
import { parseC2PAManifest } from '../exif/cbor.js';

/**
 * JUMBF (JPEG Universal Metadata Box Format) parser with C2PA support.
 * Mirrors ExifTool's Jpeg2000.pm ProcessJUMB/ProcessJUMD box walking:
 * - 8-byte box header (size, 4-char type), optional pre-box header bytes
 * - `jumb` superboxes contain nested boxes; `jumd` description boxes carry
 *   a 16-byte type UUID, 1-byte flags, then optional label/ID/signature
 * - `cbor` boxes hold the C2PA manifest, flattened via parseC2PAManifest
 */

const JUMBF_TYPES = new Set(['JUMD', 'jumd', 'cbor', 'json', 'uuid', 'jumb']);

const C2PA_UUID_STANDARD = new Uint8Array([
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c,
  0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81
]);

interface JUMDInfo {
  type16: Uint8Array; // 16-byte type UUID (first 4 bytes = ascii box type)
  flags: number;      // 1-byte toggles at offset 16
  label: string | null;
}

interface JUMBFContext {
  results: Record<string, TagValue>;
  lastJUMDInfo: JUMDInfo | null;
}

/**
 * Parse JUMBF data from a byte array.
 * Scans sequentially for boxes, associating CBOR payloads with preceding JUMD boxes.
 */
export function parseJUMBF(data: Uint8Array): Record<string, TagValue> {
  const ctx: JUMBFContext = { results: {}, lastJUMDInfo: null };

  // Find first valid box (skip any header bytes)
  let startOffset = 0;
  for (; startOffset + 8 <= data.length; startOffset++) {
    const boxSize = readUint32(data, startOffset);
    const boxType = readUint32(data, startOffset + 4);
    const typeStr = String.fromCharCode(
      (boxType >> 24) & 0xff,
      (boxType >> 16) & 0xff,
      (boxType >> 8) & 0xff,
      boxType & 0xff
    );
    if (JUMBF_TYPES.has(typeStr) && boxSize >= 8 && startOffset + boxSize <= data.length) {
      break;
    }
  }

  parseBoxesSequential(data.slice(startOffset), ctx);
  return ctx.results;
}

/**
 * Parse boxes sequentially, tracking JUMD boxes to associate following CBOR payloads.
 */
function parseBoxesSequential(data: Uint8Array, ctx: JUMBFContext): void {
  let offset = 0;

  while (offset + 8 <= data.length) {
    const boxSize = readUint32(data, offset);
    const boxType = readUint32(data, offset + 4);
    const typeStr = String.fromCharCode(
      (boxType >> 24) & 0xff,
      (boxType >> 16) & 0xff,
      (boxType >> 8) & 0xff,
      boxType & 0xff
    );

    if (boxSize < 8 || offset + boxSize > data.length) {
      offset++;
      continue;
    }

    const boxData = data.slice(offset + 8, offset + boxSize);
    const boxEnd = offset + boxSize;

    if (typeStr === 'jumd' || typeStr === 'JUMD') {
      const jumdInfo = parseJUMDInfo(boxData);
      if (jumdInfo) {
        ctx.lastJUMDInfo = jumdInfo;
        addJUMDTags(jumdInfo, ctx.results);
      }
    } else if (typeStr === 'cbor') {
      parseCBORPayload(boxData, ctx);
    } else if (typeStr === 'jumb') {
      // Container box: recursively parse its contents
      parseJumbOrFlat(boxData, ctx);
    } else if (typeStr === 'uuid' && boxData.length >= 16) {
      if (uuidEquals(boxData.slice(0, 16), C2PA_UUID_STANDARD)) {
        parseBoxesSequential(boxData.slice(16), ctx);
      }
    }

    offset = boxEnd;
  }
}

/**
 * Parse box data that is either a `jumb` container or a flat sequence
 * of jumd/cbor boxes.
 */
function parseJumbOrFlat(data: Uint8Array, ctx: JUMBFContext): void {
  let innerOffset = 0;

  while (innerOffset + 8 <= data.length) {
    const innerSize = readUint32(data, innerOffset);
    const innerType = readUint32(data, innerOffset + 4);
    const innerTypeStr = String.fromCharCode(
      (innerType >> 24) & 0xff,
      (innerType >> 16) & 0xff,
      (innerType >> 8) & 0xff,
      innerType & 0xff
    );

    if (innerSize < 8 || innerOffset + innerSize > data.length) break;

    const innerData = data.slice(innerOffset + 8, innerOffset + innerSize);
    const innerEnd = innerOffset + innerSize;

    if (innerTypeStr === 'jumd' || innerTypeStr === 'JUMD') {
      const jumdInfo = parseJUMDInfo(innerData);
      if (jumdInfo) {
        ctx.lastJUMDInfo = jumdInfo;
        addJUMDTags(jumdInfo, ctx.results);
      }
    } else if (innerTypeStr === 'cbor') {
      parseCBORPayload(innerData, ctx);
    } else if (innerTypeStr === 'jumb') {
      parseJumbOrFlat(innerData, ctx);
    }

    innerOffset = innerEnd;
  }
}

/**
 * Parse a CBOR payload box, associating it with the preceding JUMD box
 * when that JUMD label indicates C2PA content (actions/hash/claim).
 */
function parseCBORPayload(data: Uint8Array, ctx: JUMBFContext): void {
  if (!data.length) return;
  const jumd = ctx.lastJUMDInfo;
  if (jumd && !shouldParseAsCBOR(jumd)) return;
  try {
    const tags = parseC2PAManifest(data);
    for (const [k, v] of Object.entries(tags)) {
      ctx.results[k] = v;
    }
  } catch {
    // Ignore CBOR parse errors
  }
}

/**
 * Determine if a JUMD box's content should be followed by CBOR payload.
 * Matches ExifTool: cbor boxes tied to C2PA content labels.
 */
function shouldParseAsCBOR(jumdInfo: JUMDInfo): boolean {
  const label = jumdInfo.label ?? '';
  return label.includes('action') ||
    label.includes('hash') ||
    label.includes('claim') ||
    label.includes('manifest') ||
    label.includes('signature');
}

/**
 * Parse JUMD (JUMBF Description) box per ExifTool ProcessJUMD:
 * 16-byte type UUID, 1-byte flags, optional label (null-terminated),
 * optional 4-byte ID, optional 32-byte signature.
 */
function parseJUMDInfo(data: Uint8Array): JUMDInfo | null {
  if (data.length < 17) return null;

  const type16 = data.slice(0, 16);
  const flags = data[16];
  let pos = 17;

  let label: string | null = null;
  if (flags & 0x02) {
    const labelEnd = data.indexOf(0, pos);
    if (labelEnd < 0) return null; // missing label terminator
    label = new TextDecoder().decode(data.slice(pos, labelEnd));
    pos = labelEnd + 1;
  }
  if (flags & 0x04) {
    if (pos + 4 > data.length) return null;
    pos += 4;
  }
  if (flags & 0x08) {
    if (pos + 32 > data.length) return null;
    pos += 32;
  }

  return { type16, flags, label };
}

function addJUMDTags(jumdInfo: JUMDInfo, results: Record<string, TagValue>): void {
  // ExifTool suppresses duplicate non-list tags: JUMDType/JUMDLabel keep the
  // first box's values. JUMDToggles is Unknown => 1, hidden in default output.
  if (!(results['JUMBF:JUMDType'] ?? results['JUMDType'])) {
    results['JUMDType'] = formatJUMDType(jumdInfo.type16);
  }
  if (jumdInfo.label !== null && !(results['JUMBF:JUMDLabel'] ?? results['JUMDLabel'])) {
    results['JUMDLabel'] = jumdInfo.label;
  }
}

/**
 * Parse JUMBF data from APP11 segment (JPEG) or caBX chunk (PNG).
 * Entry point for format parsers.
 */
export function parseJUMBFFromSegment(data: Uint8Array): Record<string, TagValue> {
  if (data.length >= 2 && data[0] === 0x4a && data[1] === 0x50) { // 'JP'
    return parseJUMBF(data.slice(2));
  }
  return {};
}

/**
 * Format JUMD 16-byte type UUID as ExifTool does:
 * hex split 8-4-4-16; first 4 bytes as ASCII inside parens when printable.
 * e.g. (c2pa)-0011-0010-800000aa00389b71
 */
function formatJUMDType(type16: Uint8Array): string {
  const hex = Buffer.from(type16.slice(0, 16)).toString('hex');
  const m = hex.match(/^(\w{8})(\w{4})(\w{4})(\w{16})$/);
  if (!m) return hex;
  const ascii = Buffer.from(m[1], 'hex').toString('ascii');
  m[1] = /^[a-zA-Z0-9]{4}$/.test(ascii) ? `(${ascii})` : m[1];
  return [m[1], m[2], m[3], m[4]].join('-');
}

function uuidEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

export { JUMBF_TYPES, C2PA_UUID_STANDARD as C2PA_UUID };