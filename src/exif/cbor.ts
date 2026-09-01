/**
 * CBOR (Concise Binary Object Representation) decoder for C2PA manifests.
 * Implements RFC 7049 subset needed for C2PA (major types 0-7, tags 0-36, 55799).
 * Mirrors ExifTool's CBOR.pm.
 */

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

export interface CBORDecodeOptions {
  maxDepth?: number;
  allowIndefinite?: boolean;
}

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
]);

/**
 * Decode CBOR data to JavaScript values.
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
  if (info === 24) {
    if (state.pos >= data.length) throw new Error('Truncated CBOR length');
    length = data[state.pos++];
  } else if (info === 25) {
    if (state.pos + 2 > data.length) throw new Error('Truncated CBOR length');
    length = (data[state.pos] << 8) | data[state.pos + 1];
    state.pos += 2;
  } else if (info === 26) {
    if (state.pos + 4 > data.length) throw new Error('Truncated CBOR length');
    length = (data[state.pos] << 24) | (data[state.pos + 1] << 16) | (data[state.pos + 2] << 8) | data[state.pos + 3];
    state.pos += 4;
  } else if (info === 27) {
    if (state.pos + 8 > data.length) throw new Error('Truncated CBOR length');
    // 64-bit length - we only support up to 32-bit for practical purposes
    const high = (data[state.pos] << 24) | (data[state.pos + 1] << 16) | (data[state.pos + 2] << 8) | data[state.pos + 3];
    const low = (data[state.pos + 4] << 24) | (data[state.pos + 5] << 16) | (data[state.pos + 6] << 8) | data[state.pos + 7];
    state.pos += 8;
    if (high !== 0) throw new Error('CBOR length exceeds 32-bit');
    length = low;
  } else if (info === 31) {
    if (!opts.allowIndefinite) throw new Error('Indefinite length not supported');
    // Indefinite length - handled per major type
    return readIndefinite(data, state, major, opts, handlers);
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
      switch (length) {
        case SIMPLE.FALSE: return false;
        case SIMPLE.TRUE: return true;
        case SIMPLE.NULL: return null;
        case SIMPLE.UNDEFINED: return undefined;
        default:
          if (length >= 32) {
            // Extended simple values (float16, float32, float64)
            if (length === 25) { // float16
              if (state.pos + 2 > data.length) throw new Error('Truncated CBOR float16');
              const bits = (data[state.pos] << 8) | data[state.pos + 1];
              state.pos += 2;
              return decodeFloat16(bits);
            } else if (length === 26) { // float32
              if (state.pos + 4 > data.length) throw new Error('Truncated CBOR float32');
              const view = new DataView(data.buffer, data.byteOffset + state.pos, 4);
              state.pos += 4;
              return view.getFloat32(0, false);
            } else if (length === 27) { // float64
              if (state.pos + 8 > data.length) throw new Error('Truncated CBOR float64');
              const view = new DataView(data.buffer, data.byteOffset + state.pos, 8);
              state.pos += 8;
              return view.getFloat64(0, false);
            }
          }
          return { __cborSimple: length };
      }
    default:
      throw new Error(`Unknown CBOR major type ${major}`);
  }
}

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
        const byte = data[state.pos];
        if (byte === 0xff) { state.pos++; break; } // break byte
        state.pos--; // step back to re-read the chunk header
        const chunk = readValue(data, state, opts, handlers);
        if (chunk instanceof Uint8Array) chunks.push(chunk);
        else throw new Error('Expected byte string chunk in indefinite byte string');
      }
      return concatUint8Arrays(chunks);
    }
    case MAJOR.TEXT_STRING: {
      const chunks: string[] = [];
      while (state.pos < data.length) {
        const byte = data[state.pos];
        if (byte === 0xff) { state.pos++; break; }
        state.pos--;
        const chunk = readValue(data, state, opts, handlers);
        if (typeof chunk === 'string') chunks.push(chunk);
        else throw new Error('Expected text string chunk in indefinite text string');
      }
      return chunks.join('');
    }
    case MAJOR.ARRAY: {
      state.depth++;
      const arr = [];
      while (state.pos < data.length) {
        const byte = data[state.pos];
        if (byte === 0xff) { state.pos++; break; }
        arr.push(readValue(data, state, opts, handlers));
      }
      state.depth--;
      return arr;
    }
    case MAJOR.MAP: {
      state.depth++;
      const map = new Map();
      while (state.pos < data.length) {
        const byte = data[state.pos];
        if (byte === 0xff) { state.pos++; break; }
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
 * Parse C2PA manifest from CBOR data.
 * Returns flattened tags matching ExifTool's output structure.
 */
export function parseC2PAManifest(cborData: Uint8Array): Record<string, string | number | boolean | string[]> {
  const decoded = decodeCBOR(cborData, { allowIndefinite: true }) as Map<unknown, unknown> | Record<string, unknown>;
  const result: Record<string, string | number | boolean | string[]> = {};
  
  if (decoded instanceof Map) {
    extractC2PATags(decoded, result, '');
  } else if (decoded && typeof decoded === 'object') {
    extractC2PATagsFromObject(decoded, result, '');
  }
  
  return result;
}

function extractC2PATags(map: Map<unknown, unknown>, result: Record<string, unknown>, prefix: string): void {
  for (const [key, value] of map.entries()) {
    const keyStr = String(key);
    const fullKey = prefix ? `${prefix}.${keyStr}` : keyStr;
    
    // Map C2PA claim keys to ExifTool-style tags
    const tagName = mapC2PAKey(keyStr);
    if (tagName) {
      if (value instanceof Map) {
        extractC2PATags(value, result, fullKey);
      } else if (value instanceof Set) {
        result[tagName] = Array.from(value);
      } else if (Array.isArray(value)) {
        // Handle arrays - process each element
        for (const elem of value) {
          if (elem instanceof Map) {
            const elemResult: Record<string, unknown> = {};
            extractC2PATags(elem, elemResult, '');
            // Merge elemResult directly into result (keys already mapped)
            Object.assign(result, elemResult);
          } else if (elem && typeof elem === 'object' && !(elem instanceof Uint8Array)) {
            const elemResult: Record<string, unknown> = {};
            extractC2PATagsFromObject(elem as Record<string, unknown>, elemResult, '');
            Object.assign(result, elemResult);
          } else {
            // Primitive array elements - store as string array under the tagName
            if (!result[tagName]) result[tagName] = [];
            (result[tagName] as string[]).push(String(elem));
          }
        }
      } else if (value instanceof Map) {
        extractC2PATags(value, result, fullKey);
      } else if (value instanceof Uint8Array) {
        // Convert binary data to hex string
        result[tagName] = Buffer.from(value).toString('hex');
      } else {
        result[tagName] = value as string | number | boolean;
      }
    }
  }
}

function extractC2PATagsFromObject(obj: Record<string, unknown>, result: Record<string, unknown>, prefix: string): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const tagName = mapC2PAKey(key);
    if (tagName) {
      if (value instanceof Map) {
        extractC2PATags(value, result, fullKey);
      } else if (Array.isArray(value)) {
        // Handle arrays - process each element
        for (const elem of value) {
          if (elem instanceof Map) {
            const elemResult: Record<string, unknown> = {};
            extractC2PATags(elem, elemResult, '');
            Object.assign(result, elemResult);
          } else if (elem && typeof elem === 'object' && !(elem instanceof Uint8Array)) {
            const elemResult: Record<string, unknown> = {};
            extractC2PATagsFromObject(elem as Record<string, unknown>, elemResult, '');
            Object.assign(result, elemResult);
          } else {
            if (!result[tagName]) result[tagName] = [];
            (result[tagName] as string[]).push(String(elem));
          }
        }
      } else if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
        extractC2PATagsFromObject(value as Record<string, unknown>, result, fullKey);
      } else if (value instanceof Uint8Array) {
        // Convert binary data to hex string
        result[tagName] = Buffer.from(value).toString('hex');
      } else {
        result[tagName] = value as string | number | boolean;
      }
    } else if (value instanceof Map) {
      extractC2PATags(value, result, fullKey);
    } else if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
      extractC2PATagsFromObject(value as Record<string, unknown>, result, fullKey);
    }
  }
}

/**
 * Map C2PA claim keys to ExifTool tag names.
 * Based on ExifTool's CBOR.pm tag table and C2PA spec.
 */
function mapC2PAKey(key: string): string | null {
  const keyMap: Record<string, string> = {
    // DCI (Dublin Core) tags
    'dc:title': 'Title',
    'dc:format': 'Format',
    'dc:creator': 'Creator',
    'dc:description': 'Description',
    'dc:identifier': 'Identifier',
    'dc:language': 'Language',
    'dc:publisher': 'Publisher',
    'dc:relation': 'Relation',
    'dc:rights': 'Rights',
    'dc:source': 'Source',
    'dc:subject': 'Subject',
    'dc:type': 'Type',
    'dc:date': 'Date',
    'dc:coverage': 'Coverage',
    'dc:contributor': 'Contributor',
    
    // C2PA specific - match ExifTool tag names exactly
    'claim_generator': 'Claim_generator',
    'claim_generator_info': 'Claim_Generator_Info',
    'claim_generator_info.name': 'Claim_Generator_InfoName',
    'claim_generator_info.version': 'Claim_Generator_InfoVersion',
    'claim_generator_info.com.adobe.build': 'Claim_Generator_InfoComAdobeBuild',
    'actions': 'Actions',
    'action': 'ActionsAction',
    'software_agent': 'ActionsSoftwareAgent',
    'softwareAgent': 'ActionsSoftwareAgent',
    'digital_source_type': 'ActionsDigitalSourceType',
    'digitalSourceType': 'ActionsDigitalSourceType',
    'when': 'ActionsWhen',
    'parameters': 'ActionsParameters',
    'exclusions': 'Exclusions',
    'start': 'ExclusionsStart',
    'length': 'ExclusionsLength',
    'assertions': 'Assertions',
    'url': 'AssertionsUrl',
    'hash': 'AssertionsHash',
    'signature': 'Signature',
    'items': 'Items',
    
    // Claim box fields (hdc: namespace)
    'hdc:title': 'Title',
    'dc:format': 'Format',
    'instanceID': 'InstanceID',
    
    // Additional C2PA fields
    'authorName': 'AuthorName',
    'documentID': 'DocumentID',
    'thumbnailHash': 'ThumbnailHash',
    'thumbnailUrl': 'ThumbnailURL',
    'relationship': 'Relationship',
  };
  
  // Check exact match first
  if (keyMap[key]) return keyMap[key];
  
  // Check prefix matches for nested structures
  for (const [pattern, tag] of Object.entries(keyMap)) {
    if (key.startsWith(pattern + '.') || key.startsWith(pattern)) {
      return tag;
    }
  }
  
  // Handle array indices (actions[0], items[1], etc.)
  const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    const base = mapC2PAKey(arrayMatch[1]);
    if (base) return `${base}${arrayMatch[2]}`;
  }
  
  return null;
}

/**
 * Parse C2PA merkle tree (currently returns raw structure).
 */
export function parseC2PAMerkle(cborData: Uint8Array): unknown {
  return decodeCBOR(cborData);
}