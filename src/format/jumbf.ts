import type { TagValue } from '../types.js';
import { parseC2PAManifest } from '../exif/cbor.js';

/**
 * JUMBF (JPEG Universal Metadata Box Format) parser with C2PA support.
 * Handles the C2PA-specific box structure where JUMD description boxes
 * are followed by CBOR payload data (either as sibling 'cbor' boxes or nested).
 */

const JUMBF_TYPES = new Set(['JUMD', 'jumd', 'cbor', 'json', 'uuid', 'jumb']);

const C2PA_BOX_TYPES = new Set([
  'c2pa', // C2PA manifest/claim
  'c2ma', // C2PA manifest
  'c2as', // C2PA assertions
  'cbor', // CBOR data
  'c2cl', // C2PA claim
  'c2cs', // C2PA signature
]);

const C2PA_UUID_STANDARD = new Uint8Array([
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c,
  0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81
]);

interface JUMDInfo {
  type: string;
  flags: number;
  uuid: Uint8Array;
  label: string;
  boxEnd: number; // End offset of this JUMD box in the data stream
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
      // JUMD description box - store info for potential CBOR payload association
      const jumdInfo = parseJUMDInfo(boxData);
      if (jumdInfo) {
        jumdInfo.boxEnd = boxEnd;
        ctx.lastJUMDInfo = jumdInfo;
        addJUMDTags(jumdInfo, ctx.results, '');
      }
    } else if (typeStr === 'cbor') {
      // CBOR payload box - associate with last JUMD if appropriate
      if (ctx.lastJUMDInfo && shouldParseAsCBOR(ctx.lastJUMDInfo)) {
        try {
          const cborTags = parseC2PAManifest(boxData);
          const prefix = `JUMBF:${ctx.lastJUMDInfo.type}:`;
          for (const [k, v] of Object.entries(cborTags)) {
            ctx.results[`${prefix}${k}`] = v;
          }
        } catch {
          // Ignore parse errors
        }
      } else {
        // Standalone CBOR box
        try {
          const tags = parseC2PAManifest(boxData);
          for (const [k, v] of Object.entries(tags)) {
            ctx.results[`JUMBF:${k}`] = v;
          }
        } catch {
        }
      }
    } else if (typeStr === 'jumb') {
      // Nested jumb box - recursively parse its contents
      // The jumb box may contain a jumd followed by CBOR payload
      parseJumbBox(boxData, ctx);
    } else if (typeStr === 'uuid' && boxData.length >= 16) {
      if (uuidEquals(boxData.slice(0, 16), C2PA_UUID_STANDARD)) {
        parseBoxesSequential(boxData.slice(16), ctx);
      }
    }
    
    offset = boxEnd;
  }
}

/**
 * Parse a 'jumb' box which may contain a jumd followed by CBOR payload.
 * Also recursively parses any nested boxes within.
 */
function parseJumbBox(data: Uint8Array, ctx: JUMBFContext): void {
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
        jumdInfo.boxEnd = innerEnd;
        ctx.lastJUMDInfo = jumdInfo;
        addJUMDTags(jumdInfo, ctx.results, '');
      }
    } else if (innerTypeStr === 'cbor') {
      // CBOR payload inside jumb box
      if (ctx.lastJUMDInfo && shouldParseAsCBOR(ctx.lastJUMDInfo)) {
        try {
          const cborTags = parseC2PAManifest(innerData);
          const prefix = `JUMBF:${ctx.lastJUMDInfo.type}:`;
          for (const [k, v] of Object.entries(cborTags)) {
            ctx.results[`${prefix}${k}`] = v;
          }
        } catch {
        }
      }
    } else if (innerTypeStr === 'jumb') {
      // Recursively parse nested jumb boxes
      parseJumbBox(innerData, ctx);
    }
    
    innerOffset = innerEnd;
  }
}

/**
 * Determine if a JUMD box's content should be followed by CBOR payload.
 */
function shouldParseAsCBOR(jumdInfo: JUMDInfo): boolean {
  return ['cbor', 'c2cl', 'c2cs'].includes(jumdInfo.type) ||
         jumdInfo.label.includes('action') ||
         jumdInfo.label.includes('hash') ||
         jumdInfo.label.includes('claim') ||
         jumdInfo.label.includes('signature');
}

/**
 * Parse JUMD (JUMBF Description) box and extract metadata.
 */
function parseJUMDInfo(data: Uint8Array): JUMDInfo | null {
  if (data.length < 4) return null;
  
  // Check if this is C2PA format (4-byte type followed by 4-byte flags + UUID)
  const possibleType = String.fromCharCode(...data.slice(0, 4));
  if (C2PA_BOX_TYPES.has(possibleType)) {
    return parseC2PAJUMD(possibleType, data);
  }
  
  // Standard format: 16-byte UUID type, 1-byte flags, optional label, etc.
  if (data.length < 17) return null;
  return parseStandardJUMD(data);
}

function parseC2PAJUMD(c2paType: string, data: Uint8Array): JUMDInfo | null {
  // Minimum: 4 (type) + 4 (flags) + at least 1 (label start)
  if (data.length < 9) return null;
  
  const flags = readUint32(data, 4);
  // UUID is 16 bytes but may be truncated in some files
  const uuidEnd = Math.min(24, data.length);
  const uuid = data.slice(8, uuidEnd);
  let pos = uuidEnd;
  
  // Label is null-terminated
  let label = '';
  if (pos < data.length) {
    const labelEnd = data.indexOf(0, pos);
    if (labelEnd >= 0) {
      label = new TextDecoder().decode(data.slice(pos, labelEnd));
      pos = labelEnd + 1;
    }
  }
  
  return { type: c2paType, flags, uuid, label, boxEnd: 0 };
}

function parseStandardJUMD(data: Uint8Array): JUMDInfo | null {
  if (data.length < 17) return null;
  
  const type = data.slice(0, 16);
  const flags = data[16];
  let pos = 17;
  
  let label = '';
  if (pos < data.length && (flags & 0x02)) {
    const labelEnd = data.indexOf(0, pos);
    if (labelEnd >= 0) {
      label = new TextDecoder().decode(data.slice(pos, labelEnd));
      pos = labelEnd + 1;
    }
  }
  
  const c2paType = extractC2PATypeFromUUID(type);
  
  return { type: c2paType || 'standard', flags, uuid: type, label, boxEnd: 0 };
}

function addJUMDTags(jumdInfo: JUMDInfo, results: Record<string, TagValue>, _prefix: string): void {
  if (jumdInfo.type === 'c2pa') {
    // First/main JUMD box - these are the top-level JUMD tags
    results['JUMBF:JUMDType'] = formatC2PAUUID(jumdInfo.uuid);
    results['JUMBF:JUMDLabel'] = normalizeJUMDLabel(jumdInfo.label);
    results['JUMBF:JUMDToggles'] = jumdInfo.flags;
  } else {
    const pfx = `JUMBF:${jumdInfo.type}:`;
    results[`${pfx}UUID`] = formatC2PAUUID(jumdInfo.uuid);
    results[`${pfx}Label`] = normalizeJUMDLabel(jumdInfo.label);
    results[`${pfx}Flags`] = jumdInfo.flags;
    results[`${pfx}Type`] = jumdInfo.type;
  }
}

function extractC2PATypeFromUUID(uuid: Uint8Array): string | null {
  const ascii = new TextDecoder().decode(uuid.slice(0, 4));
  if (C2PA_BOX_TYPES.has(ascii)) return ascii;
  return null;
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
 * Format C2PA UUID (Microsoft GUID byte order) as ExifTool does:
 * (type)-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
function formatC2PAUUID(uuid: Uint8Array): string {
  // Microsoft GUID byte order:
  // Data1 (4 bytes, LE), Data2 (2 bytes, LE), Data3 (2 bytes, LE), Data4 (8 bytes, BE)
  // Handle truncated UUIDs (less than 16 bytes) by using available bytes
  const data1 = uuid.length >= 4
    ? ((uuid[0] | (uuid[1] << 8) | (uuid[2] << 16) | (uuid[3] << 24)) >>> 0)
    : 0;
  const data2 = uuid.length >= 6
    ? ((uuid[4] | (uuid[5] << 8)) >>> 0)
    : 0;
  const data3 = uuid.length >= 8
    ? ((uuid[6] | (uuid[7] << 8)) >>> 0)
    : 0;
  const data4 = uuid.length > 8 ? uuid.slice(8) : new Uint8Array(0);
  
  const hex1 = data1.toString(16).padStart(8, '0');
  const hex2 = data2.toString(16).padStart(4, '0');
  const hex3 = data3.toString(16).padStart(4, '0');
  const hex4 = Buffer.from(data4).toString('hex').padEnd(16, '0'); // Data4 is 8 bytes = 16 hex chars
  
  // Check if first 4 bytes of UUID are printable ASCII (for type prefix)
  const ascii = uuid.length >= 4 ? new TextDecoder().decode(uuid.slice(0, 4)) : '';
  const prefix = /^[a-zA-Z0-9]{4}$/.test(ascii) ? `(${ascii})` : '';
  
  return `${prefix}${hex1}-${hex2}-${hex3}-${hex4}`;
}

/**
 * Format standard JUMD type UUID as ExifTool does.
 */
function formatJUMDType(uuid: Uint8Array): string {
  const hex = Buffer.from(uuid).toString('hex');
  const ascii = new TextDecoder().decode(uuid.slice(0, 4));
  if (/^[a-zA-Z0-9]{4}$/.test(ascii)) {
    return `(${ascii})-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 32)}`;
  }
  return hex.replace(/(\w{8})(\w{4})(\w{4})(\w{16})/, '$1-$2-$3-$4');
}

/**
 * Normalize JUMD label like ExifTool.
 */
function normalizeJUMDLabel(label: string): string {
  let name = label
    .replace(/[^-_a-zA-Z0-9]([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/[^-_a-zA-Z0-9]/g, '')
    .replace(/__/g, '_');
  
  name = name.charAt(0).toUpperCase() + name.slice(1);
  name = name.replace(/C2pa/g, 'C2PA');
  
  if (name.length < 2) name = 'Tag' + name;
  
  return name;
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