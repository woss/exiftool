/**
 * CBOR (Concise Binary Object Representation) decoder for C2PA manifests.
 * Implements RFC 7049 subset needed for C2PA (major types 0-7, tags 0-36, 55799).
 * Mirrors ExifTool's CBOR.pm.
 */
import type { TagValue } from '../types.js';

// CBOR major types
const MAJOR = {
  POSITIVE_INT: 0,
  NEGATIVE_INT: 1,
  BYTE_STRING: 2,
  TEXT_STRING: 3,
  ARRAY: 4,
  MAP: 5,
  TAG: 6,
  SIMPLE: 7,
};

// CBOR tag numbers (C2PA relevant subset)
const TAG = {
  DATE_TIME_STRING: 0,
  EPOCH_DATE_TIME: 1,
  POSITIVE_BIGNUM: 2,
  NEGATIVE_BIGNUM: 3,
  DECIMAL_FRACTION: 4,
  BIGFLOAT: 5,
  COSE_ENCRYPT0: 16,
  COSE_MAC0: 17,
  COSE_SIGN1: 18,
  COSE_COUNTERSIGNATURE: 19,
  EXPECTED_BASE64URL: 21,
  EXPECTED_BASE64: 22,
  EXPECTED_BASE16: 23,
  ENCODED_CBOR: 24,
  STRING_REF: 25,
  PERL_OBJECT: 26,
  CODE_OBJECT: 27,
  SHARED_VALUE: 28,
  SHARED_VALUE_REF: 29,
  RATIONAL: 30,
  MISSING_ARRAY_VALUE: 31,
  URI: 32,
  BASE64URL: 33,
  BASE64: 34,
  REGEXP: 35,
  MIME_MESSAGE: 36,
  CBOR_MAGIC: 55799,
};

// Simple values (major type 7, additional info 20-23)
const SIMPLE = {
  FALSE: 20,
  TRUE: 21,
  NULL: 22,
  UNDEFINED: 23,
};

/**
 * Options for CBOR decoding.
 * @property maxDepth - Maximum recursion depth (default 128)
 * @property allowIndefinite - Allow indefinite-length items (default false)
 */
export interface CBORDecodeOptions {
  maxDepth?: number;
  allowIndefinite?: boolean;
}

/**
 * Custom tag handler for CBOR tags not in the default table.
 * @param tag - CBOR tag number
 * @param value - Decoded value
 * @param decode - Recursive decoder for nested structures
 * @returns Transformed value
 */
export interface CBORTagHandler {
  (tag: number, value: unknown, decode: (data: Uint8Array) => unknown): unknown;
}


const DEFAULT_OPTIONS: Required<CBORDecodeOptions> = {
  maxDepth: 128,
  allowIndefinite: false,
};

const DEFAULT_TAG_HANDLERS: Map<number, CBORTagHandler> = new Map([
  [TAG.DATE_TIME_STRING, (_tag, value) => value], // ISO 8601 string
  [TAG.EPOCH_DATE_TIME, (_tag, value) => {
    if (typeof value === 'number') return new Date(value * 1000).toISOString();
    if (typeof value === 'bigint') return new Date(Number(value) * 1000).toISOString();
    return value;
  }],
  [TAG.URI, (_tag, value) => value],
  [TAG.BASE64URL, (_tag, value) => {
    if (value instanceof Uint8Array) return base64urlEncode(value);
    return value;
  }],
  [TAG.BASE64, (_tag, value) => {
    if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
    return value;
  }],
  [TAG.EXPECTED_BASE64URL, (_tag, value) => {
    if (value instanceof Uint8Array) return base64urlEncode(value);
    return value;
  }],
  [TAG.EXPECTED_BASE64, (_tag, value) => {
    if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
    return value;
  }],
  [TAG.ENCODED_CBOR, (_tag, value, decode) => {
    if (value instanceof Uint8Array) return decode(value);
    return value;
  }],
  // COSE structures are arrays; ExifTool flattens them into Item0..ItemN tags
  [TAG.COSE_ENCRYPT0, (_tag, value) => value],
  [TAG.COSE_MAC0, (_tag, value) => value],
  [TAG.COSE_SIGN1, (_tag, value) => value],
  [TAG.COSE_COUNTERSIGNATURE, (_tag, value) => value],
]);

/**
 * Decodes CBOR (Concise Binary Object Representation) data to JavaScript values.
 *
 * Implements RFC 8949 subset needed for C2PA manifests:
 * - Major types 0-7 (unsigned/signed ints, byte/text strings, arrays, maps, tags, simple values)
 * - Standard tags (datetime, base64, base64url, encoded CBOR, etc.)
 * - C2PA-specific tags (COSE structures, merkle trees)
 * - Indefinite-length items (arrays, maps, strings)
 *
 * @param data - CBOR-encoded data
 * @param options - Decoding options (max depth, indefinite handling)
 * @param tagHandlers - Custom tag handlers (merged with defaults)
 * @returns Decoded JavaScript value
 */
 export function decodeCBOR(data: Uint8Array, options?: CBORDecodeOptions, tagHandlers?: Map<number, CBORTagHandler>): unknown {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const handlers = new Map([...DEFAULT_TAG_HANDLERS, ...(tagHandlers || new Map())]);
  const state = { pos: 0, depth: 0, sharedStrings: [] as string[] };
  
  return readValue(data, state, opts, handlers);
}

function readValue(
  data: Uint8Array,
  state: { pos: number; depth: number; sharedStrings: string[] },
  opts: Required<CBORDecodeOptions>,
  handlers: Map<number, CBORTagHandler>
): unknown {
  if (state.pos >= data.length) {
    throw new Error('Truncated CBOR data');
  }
  if (state.depth >= opts.maxDepth) {
    throw new Error('CBOR nesting depth exceeded');
  }
  
  const byte = data[state.pos++];
  const major = byte >> 5;
  const info = byte & 0x1f;
  
  let length = info;
  if (major !== MAJOR.SIMPLE) {
    // Additional-info 24-27 encode the item length for majors 0-6;
    // for major 7 (simple/floats) they are value types, not lengths.
    if (info === 24) {
      if (state.pos >= data.length) throw new Error('Truncated CBOR length');
      length = data[state.pos++];
    } else if (info === 25) {
      if (state.pos + 2 > data.length) throw new Error('Truncated CBOR length');
      length = (data[state.pos] << 8) | data[state.pos + 1];
      state.pos += 2;
    } else if (info === 26) {
      if (state.pos + 4 > data.length) throw new Error('Truncated CBOR length');
      length = ((data[state.pos] << 24) | (data[state.pos + 1] << 16) | (data[state.pos + 2] << 8) | data[state.pos + 3]) >>> 0;
      state.pos += 4;
    } else if (info === 27) {
      if (state.pos + 8 > data.length) throw new Error('Truncated CBOR length');
      // 64-bit length - we only support up to 32-bit for practical purposes
      const high = ((data[state.pos] << 24) | (data[state.pos + 1] << 16) | (data[state.pos + 2] << 8) | data[state.pos + 3]) >>> 0;
      const low = ((data[state.pos + 4] << 24) | (data[state.pos + 5] << 16) | (data[state.pos + 6] << 8) | data[state.pos + 7]) >>> 0;
      state.pos += 8;
      if (high !== 0) throw new Error('CBOR length exceeds 32-bit');
      length = low;
    } else if (info === 31) {
      if (!opts.allowIndefinite) throw new Error('Indefinite length not supported');
      // Indefinite length - handled per major type
      return readIndefinite(data, state, major, opts, handlers);
    }
  }
  
  switch (major) {
    case MAJOR.POSITIVE_INT:
      return length;
    case MAJOR.NEGATIVE_INT:
      return -1 - length;
    case MAJOR.BYTE_STRING:
      if (state.pos + length > data.length) throw new Error('Truncated CBOR byte string');
      const bytes = data.slice(state.pos, state.pos + length);
      state.pos += length;
      return bytes;
    case MAJOR.TEXT_STRING:
      if (state.pos + length > data.length) throw new Error('Truncated CBOR text string');
      const text = new TextDecoder().decode(data.slice(state.pos, state.pos + length));
      state.pos += length;
      return text;
    case MAJOR.ARRAY:
      state.depth++;
      const arr = [];
      for (let i = 0; i < length; i++) {
        arr.push(readValue(data, state, opts, handlers));
      }
      state.depth--;
      return arr;
    case MAJOR.MAP:
      state.depth++;
      const map = new Map();
      for (let i = 0; i < length; i++) {
        const key = readValue(data, state, opts, handlers);
        const value = readValue(data, state, opts, handlers);
        map.set(key, value);
      }
      state.depth--;
      return map;
    case MAJOR.TAG:
      state.depth++;
      const taggedValue = readValue(data, state, opts, handlers);
      state.depth--;
      const handler = handlers.get(length);
      if (handler) {
        return handler(length, taggedValue, (d: Uint8Array) => decodeCBOR(d, opts, handlers));
      }
      // Unknown tag - return tagged object
      return { __cborTag: length, value: taggedValue };
    case MAJOR.SIMPLE:
      // 0-19: reserved simple values; 20-23: false/true/null/undef;
      // 24: one-byte simple value; 25-27: float16/32/64; 28-30: reserved; 31: break
      if (length <= 19) return { __cborSimple: length };
      if (length === SIMPLE.FALSE) return false;
      if (length === SIMPLE.TRUE) return true;
      if (length === SIMPLE.NULL) return null;
      if (length === SIMPLE.UNDEFINED) return undefined;
      if (length === 24) { // extended one-byte simple value
        if (state.pos >= data.length) throw new Error('Truncated CBOR simple value');
        const simple = data[state.pos++];
        if (simple < 32) throw new Error('Invalid CBOR simple value');
        return { __cborSimple: simple };
      }
      if (length === 25) { // float16
        if (state.pos + 2 > data.length) throw new Error('Truncated CBOR float16');
        const bits = (data[state.pos] << 8) | data[state.pos + 1];
        state.pos += 2;
        return decodeFloat16(bits);
      }
      if (length === 26) { // float32
        if (state.pos + 4 > data.length) throw new Error('Truncated CBOR float32');
        const view = new DataView(data.buffer, data.byteOffset + state.pos, 4);
        state.pos += 4;
        return view.getFloat32(0, false);
      }
      if (length === 27) { // float64
        if (state.pos + 8 > data.length) throw new Error('Truncated CBOR float64');
        const view = new DataView(data.buffer, data.byteOffset + state.pos, 8);
        state.pos += 8;
        return view.getFloat64(0, false);
      }
      throw new Error(`Invalid CBOR simple value ${length}`);
    default:
      throw new Error(`Unknown CBOR major type ${major}`);
  }
}

/**
 * Decode an indefinite-length item (major types 2-5 terminate with 0xff).
 * Chunks are read from the current position without stepping back.
 */
function readIndefinite(
  data: Uint8Array,
  state: { pos: number; depth: number; sharedStrings: string[] },
  major: number,
  opts: Required<CBORDecodeOptions>,
  handlers: Map<number, CBORTagHandler>
): unknown {
  switch (major) {
    case MAJOR.BYTE_STRING: {
      const chunks: Uint8Array[] = [];
      while (state.pos < data.length) {
        if (data[state.pos] === 0xff) { state.pos++; break; }
        const chunk = readValue(data, state, opts, handlers);
        if (chunk instanceof Uint8Array) chunks.push(chunk);
        else throw new Error('Expected byte string chunk in indefinite byte string');
      }
      return concatUint8Arrays(chunks);
    }
    case MAJOR.TEXT_STRING: {
      const chunks: string[] = [];
      while (state.pos < data.length) {
        if (data[state.pos] === 0xff) { state.pos++; break; }
        const chunk = readValue(data, state, opts, handlers);
        if (typeof chunk === 'string') chunks.push(chunk);
        else throw new Error('Expected text string chunk in indefinite text string');
      }
      return chunks.join('');
    }
    case MAJOR.ARRAY: {
      state.depth++;
      const arr: unknown[] = [];
      while (state.pos < data.length) {
        if (data[state.pos] === 0xff) { state.pos++; break; }
        arr.push(readValue(data, state, opts, handlers));
      }
      state.depth--;
      return arr;
    }
    case MAJOR.MAP: {
      state.depth++;
      const map = new Map<unknown, unknown>();
      while (state.pos < data.length) {
        if (data[state.pos] === 0xff) { state.pos++; break; }
        const key = readValue(data, state, opts, handlers);
        const value = readValue(data, state, opts, handlers);
        map.set(key, value);
      }
      state.depth--;
      return map;
    }
    default:
      throw new Error(`Indefinite length not supported for major type ${major}`);
  }
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function decodeFloat16(bits: number): number {
  const sign = (bits >> 15) & 0x1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  
  if (exponent === 0) {
    return (sign ? -1 : 1) * (mantissa / 1024) * Math.pow(2, -14);
  } else if (exponent === 0x1f) {
    return mantissa === 0 ? (sign ? -Infinity : Infinity) : NaN;
  } else {
    return (sign ? -1 : 1) * (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
  }
}

function base64urlEncode(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * C2PA tag table (mirrors ExifTool CBOR.pm %Image::ExifTool::CBOR::Main).
 * Unlisted tags get their name from the flattened CBOR key path.
 */
const CBOR_TAG_TABLE: Record<string, string> = {
  'dc:title': 'Title',
  'dc:format': 'Format',
  authorName: 'AuthorName',
  authorIdentifier: 'AuthorIdentifier',
  documentID: 'DocumentID',
  instanceID: 'InstanceID',
  thumbnailHash: 'ThumbnailHash',
  thumbnailUrl: 'ThumbnailURL',
  relationship: 'Relationship',
};

/**
 * Parse C2PA manifest from CBOR data.
 * Mirrors ExifTool's JSON::ProcessTag flattening: arrays recurse with the same
 * tag, hash keys append ucfirst to the parent tag, characters after
 * non-alphanumerics are capitalized, and byte strings become binary placeholders.
 */
export function parseC2PAManifest(cborData: Uint8Array): Record<string, TagValue> {
  const decoded = decodeCBOR(cborData, { allowIndefinite: true }) as unknown;
  const acc = new Map<string, unknown[]>();

  if (decoded instanceof Map) {
    for (const [key, value] of decoded) {
      flattenCBOR(value, String(key), acc);
    }
  } else if (Array.isArray(decoded)) {
    // ExifTool tags top-level CBOR arrays as Item0, Item1, ...
    decoded.forEach((el, i) => flattenCBOR(el, `Item${i}`, acc));
  } else if (decoded && typeof decoded === 'object') {
    for (const [key, value] of Object.entries(decoded as Record<string, unknown>)) {
      flattenCBOR(value, key, acc);
    }
  }

  const result: Record<string, TagValue> = {};
  for (const [tagID, values] of acc) {
    const name = CBOR_TAG_TABLE[tagID] ?? nameFromTagID(tagID);
    result[name] = (values.length === 1 ? values[0] : values) as TagValue;
  }
  return result;
}

/**
 * Flatten one decoded CBOR value, accumulating scalar values under tag IDs
 * exactly as ExifTool's JSON::ProcessTag does.
 */
function flattenCBOR(value: unknown, tag: string, acc: Map<string, unknown[]>): void {
  if (value instanceof Map) {
    for (const [key, v] of value) {
      const keyStr = String(key);
      // Perl: $tg = $tag . ((/^\d/ and $tag =~ /\d$/) ? '_' : '') . ucfirst
      const needsUnderscore = /^\d/.test(keyStr) && /\d$/.test(tag);
      let child = tag + (needsUnderscore ? '_' : '') + ucfirst(keyStr);
      child = child.replace(/([^a-zA-Z])([a-z])/g, (m, a, b) => a + b.toUpperCase());
      flattenCBOR(v, child, acc);
    }
  } else if (Array.isArray(value)) {
    for (const el of value) {
      flattenCBOR(el, tag, acc);
    }
  } else if (value instanceof Uint8Array) {
    pushValue(acc, tag, `(Binary data ${value.length} bytes, use -b option to extract)`);
  } else if (value === null) {
    // CBOR simple value 22: ExifTool maps it to the string 'null'
    pushValue(acc, tag, 'null');
  } else if (value !== undefined) {
    pushValue(acc, tag, value);
  }
}

function pushValue(acc: Map<string, unknown[]>, tag: string, value: unknown): void {
  const list = acc.get(tag);
  if (list) list.push(value);
  else acc.set(tag, [value]);
}

/**
 * Derive the displayed tag name from a flattened CBOR tag ID the way
 * ExifTool names unknown tags: capitalize first letter, strip '.' separators.
 */
function nameFromTagID(tagID: string): string {
  return (tagID.charAt(0).toUpperCase() + tagID.slice(1)).replace(/\./g, '');
}

function ucfirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parses a C2PA merkle tree from CBOR data.
 * Currently returns the raw decoded structure without further processing.
 *
 * @param cborData - CBOR-encoded merkle tree data
 * @returns Decoded CBOR value
 */
 export function parseC2PAMerkle(cborData: Uint8Array): unknown {
  return decodeCBOR(cborData);
}