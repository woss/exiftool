import { expect, test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { decodeCBOR, parseC2PAManifest, parseC2PAMerkle } from './cbor.js';

/**
 * Minimal CBOR encoder for building test vectors.
 * Covers the subset needed by decodeCBOR: ints, strings, bytes, arrays,
 * maps, booleans, null/undefined, tagged values.
 */
function enc(v: unknown): Uint8Array {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return encInt(0, v);
  if (typeof v === 'number' && Number.isInteger(v)) return encInt(1, -1 - v);
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    return concat(encLen(3, b.length), b);
  }
  if (v instanceof Uint8Array) return concat(encLen(2, v.length), v);
  if (Array.isArray(v)) {
    const parts = [encLen(4, v.length)];
    for (const el of v) parts.push(enc(el));
    return concat(...parts);
  }
  if (v instanceof Map) {
    const parts = [encLen(5, v.size)];
    for (const [k, val] of v) parts.push(enc(k), enc(val));
    return concat(...parts);
  }
  if (v === true) return new Uint8Array([0xf5]);
  if (v === false) return new Uint8Array([0xf4]);
  if (v === null) return new Uint8Array([0xf6]);
  if (v === undefined) return new Uint8Array([0xf7]);
  if (v && typeof v === 'object' && 'tag' in v && 'value' in v) {
    const tag = v.tag;
    if (typeof tag !== 'number') throw new Error('tag must be numeric');
    return concat(encInt(6, tag), enc(v.value));
  }
  if (v && typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof Map)) {
    // plain object: encode as a map of its entries
    return enc(new Map<string, unknown>(Object.entries(v)));
  }
  throw new Error(`cannot encode ${String(v)}`);
}

function encInt(major: number, n: number): Uint8Array {
  if (n < 24) return new Uint8Array([(major << 5) | n]);
  if (n <= 0xff) return new Uint8Array([(major << 5) | 24, n]);
  if (n <= 0xffff) return new Uint8Array([(major << 5) | 25, n >> 8, n & 0xff]);
  return new Uint8Array([(major << 5) | 26, n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function encLen(major: number, n: number): Uint8Array {
  return encInt(major, n);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) out.set(p, off), (off += p.length);
  return out;
}

test('cbor decodes integer round-trips across widths', () => {
  for (const n of [0, 1, 23, 24, 255, 256, 65535, 65536, 0x10000, 0xffffffff]) {
    assertEquals(decodeCBOR(enc(n)), n);
  }
  for (const n of [-1, -24, -25, -256, -257, -65536, -65537, -0x80000000]) {
    assertEquals(decodeCBOR(enc(n)), n);
  }
});

test('cbor decodes byte strings and text strings', () => {
  assertEquals(decodeCBOR(enc(new Uint8Array([1, 2, 3]))), new Uint8Array([1, 2, 3]));
  assertEquals(decodeCBOR(enc('')), '');
  assertEquals(decodeCBOR(enc('hello')), 'hello');
  const long = 'x'.repeat(300);
  assertEquals(decodeCBOR(enc(long)), long);
});

test('cbor decodes containers, booleans and nulls', () => {
  const containerMap = new Map<string, unknown>([['a', 1], ['b', [true, false, null, undefined]]]);
  const decoded = decodeCBOR(enc(containerMap));
  if (!(decoded instanceof Map)) throw new Error('expected map');
  assertEquals(decoded.get('a'), 1);
  assertEquals(decoded.get('b'), [true, false, null, undefined]);
});

test('cbor decodes floats', () => {
  assertEquals(decodeCBOR(new Uint8Array([0xf9, 0x3c, 0x00])), 1); // half 1.0
  assertEquals(decodeCBOR(new Uint8Array([0xfa, 0x3f, 0xc0, 0x00, 0x00])), 1.5); // float
  assertEquals(decodeCBOR(new Uint8Array([0xfb, 0x3f, 0xf4, 0, 0, 0, 0, 0, 0])), 1.25); // double
  // half subnormal, +/-infinity
  assertEquals(decodeCBOR(new Uint8Array([0xf9, 0x00, 0x01])), Math.pow(2, -24));
  assertEquals(decodeCBOR(new Uint8Array([0xf9, 0x7c, 0x00])), Infinity);
  assertEquals(decodeCBOR(new Uint8Array([0xf9, 0xfc, 0x00])), -Infinity);
  // NaN half
  assertEquals(Number.isNaN(decodeCBOR(new Uint8Array([0xf9, 0x7e, 0x00]))), true);
});

test('cbor base64/url conversions via expected-encoding tags', () => {
  // tag 21 expected base64url of a byte string
  assertEquals(decodeCBOR(enc({ tag: 21, value: new Uint8Array([0xfb, 0xff]) })), '-_8');
  // tag 22 expected base64
  assertEquals(decodeCBOR(enc({ tag: 22, value: new Uint8Array([0xfb, 0xff]) })), '+/8=');
});

test('manifest flattens unknown-tagged objects via the plain-object branch', () => {
  const tags = parseC2PAManifest(enc({ tag: 99, value: 'http://x' }));
  assertEquals(tags['__cborTag'], 99);
  assertEquals(tags['Value'], 'http://x');
});

test('cbor COSE/unwrap tags and string-ref tags decode', () => {
  // tag 18 (COSE Sign1) unwraps to its array
  const cose = decodeCBOR(enc({ tag: 18, value: [1, 'two', null] }));
  assertEquals(cose, [1, 'two', null]);
  // tag 24 (encoded CBOR) decodes the inner bytes
  const inner = decodeCBOR(enc({ tag: 24, value: enc(42) }));
  assertEquals(inner, 42);
  // tag 0/1 (date-time) pass through / convert
  assertEquals(decodeCBOR(enc({ tag: 0, value: '2024-01-01T00:00:00Z' })), '2024-01-01T00:00:00Z');
  assertEquals(decodeCBOR(enc({ tag: 1, value: 0 })), new Date(0).toISOString());
  // remaining COSE tags (16/17/19) unwrap to their inner values
  assertEquals(decodeCBOR(enc({ tag: 16, value: [1] })), [1]);
  assertEquals(decodeCBOR(enc({ tag: 17, value: [2] })), [2]);
  assertEquals(decodeCBOR(enc({ tag: 19, value: [3] })), [3]);
  // encoding-expected tags (21/22) and encoded-CBOR (24) pass non-byte values
  assertEquals(decodeCBOR(enc({ tag: 21, value: 'already-url' })), 'already-url');
  assertEquals(decodeCBOR(enc({ tag: 22, value: 'already-b64' })), 'already-b64');
  assertEquals(decodeCBOR(enc({ tag: 24, value: 'not-cbor' })), 'not-cbor');
  // tag 23 has no handler: unknown tags wrap their value
  assertEquals(decodeCBOR(enc({ tag: 23, value: 'b16' })), { __cborTag: 23, value: 'b16' });
  assertEquals(decodeCBOR(enc({ tag: 32, value: 'https://x/' })), 'https://x/');
  assertEquals(decodeCBOR(enc({ tag: 33, value: 'u' })), 'u');
  assertEquals(decodeCBOR(enc({ tag: 34, value: 'b' })), 'b');
});

test('cbor decodes indefinite-length strings, arrays and maps', () => {
  const b = new Uint8Array([0x7f, 0x62, 0x61, 0x62, 0x62, 0x63, 0x64, 0xff]); // "ab" "cd"
  assertEquals(decodeCBOR(b, { allowIndefinite: true }), 'abcd');
  const arr = new Uint8Array([0x9f, 0x01, 0x02, 0xff]);
  assertEquals(decodeCBOR(arr, { allowIndefinite: true }), [1, 2]);
  const mapBytes = new Uint8Array([0xbf, 0x61, 0x61, 0x01, 0xff]);
  const indefiniteMap = decodeCBOR(mapBytes, { allowIndefinite: true });
  if (!(indefiniteMap instanceof Map)) throw new Error('expected map');
  assertEquals(indefiniteMap.get('a'), 1);
  const bytes = new Uint8Array([0x5f, 0x41, 0x01, 0x41, 0x02, 0xff]);
  assertEquals(decodeCBOR(bytes, { allowIndefinite: true }), new Uint8Array([1, 2]));
  // indefinite requires the option
  expect(() => decodeCBOR(b)).toThrow(/Indefinite/);
});

test('cbor reports structural errors', () => {
  expect(() => decodeCBOR(new Uint8Array(0))).toThrow(/Truncated CBOR data/);
  expect(() => decodeCBOR(new Uint8Array([0x9f, 0x81, 0xff, 0xff]))).toThrow(/Indefinite length not supported/);
  // reserved simple value 0xfc (major 7, info 28)
  expect(() => decodeCBOR(new Uint8Array([0xfc]))).toThrow(/Invalid CBOR simple value/);
  // nesting deeper than the default limit (128)
  let deep: Uint8Array = new Uint8Array([0x00]);
  for (let i = 0; i < 200; i++) deep = concat(new Uint8Array([0x81]), deep);
  expect(() => decodeCBOR(deep)).toThrow(/CBOR nesting depth exceeded/);
  // 64-bit length encodings, both truncated and overflowing 32-bit
  assertEquals(decodeCBOR(new Uint8Array([0x1b, 0, 0, 0, 0, 0, 0, 0, 0x0f])), 15);
  expect(() => decodeCBOR(new Uint8Array([0x1b, 0, 0]))).toThrow(/Truncated CBOR length/);
  expect(() => decodeCBOR(new Uint8Array([0x1b, 0, 0, 0, 1, 0, 0, 0, 0]))).toThrow(/CBOR length exceeds 32-bit/);
});

test('cbor extended one-byte simple values', () => {
  assertEquals(decodeCBOR(new Uint8Array([0xf8, 0x20])), { __cborSimple: 32 });
  expect(() => decodeCBOR(new Uint8Array([0xf8, 0x18]))).toThrow(/Invalid CBOR simple value/);
  expect(() => decodeCBOR(new Uint8Array([0xf8]))).toThrow(/Truncated CBOR simple value/);
});

test('cbor rejects mismatched indefinite chunks', () => {
  // indefinite byte string containing a text chunk
  expect(() => decodeCBOR(new Uint8Array([0x5f, 0x61, 0x61, 0xff]), { allowIndefinite: true }))
    .toThrow(/Expected byte string chunk/);
  // indefinite text string containing a byte chunk
  expect(() => decodeCBOR(new Uint8Array([0x7f, 0x41, 0x61, 0xff]), { allowIndefinite: true }))
    .toThrow(/Expected text string chunk/);
  // indefinite major type without a defined representation
  expect(() => decodeCBOR(new Uint8Array([0x1f]), { allowIndefinite: true }))
    .toThrow(/Indefinite length not supported for major type/);
});

test('manifest flattens claim map into exiftool tag names', () => {
  const claimMap = new Map<string, unknown>([
    ['claim_generator', 'Adobe Photoshop/25.5.1'],
    ['claim_generator_info', [{ name: 'Adobe Photoshop', version: '25.5.1', 'com.adobe.build': '20240302.r.408' }]],
    ['actions', [{ action: 'c2pa.edited', softwareAgent: 'Adobe Firefly', digitalSourceType: 'http://cv.iptc.org/x' }]],
    ['exclusions', [{ start: 57, length: 11443 }]],
    ['signature', 'self#jumbf=c2pa.signature'],
    ['assertions', [
      { url: 'self#jumbf=c2pa.assertions/c2pa.actions', hash: new Uint8Array(32) },
      { url: 'self#jumbf=c2pa.assertions/c2pa.hash.data', hash: new Uint8Array(32) },
    ]],
    ['dc:title', 'Generated Image'],
    ['dc:format', 'image/jpeg'],
    ['instanceID', '1.0'],
  ]);
  const data = enc(claimMap);
  const tags = parseC2PAManifest(data);
  assertEquals(tags['Claim_generator'], 'Adobe Photoshop/25.5.1');
  assertEquals(tags['Claim_Generator_InfoName'], 'Adobe Photoshop');
  assertEquals(tags['Claim_Generator_InfoVersion'], '25.5.1');
  assertEquals(tags['Claim_Generator_InfoComAdobeBuild'], '20240302.r.408');
  assertEquals(tags['ActionsAction'], 'c2pa.edited');
  assertEquals(tags['ActionsSoftwareAgent'], 'Adobe Firefly');
  assertEquals(tags['ActionsDigitalSourceType'], 'http://cv.iptc.org/x');
  assertEquals(tags['ExclusionsStart'], 57);
  assertEquals(tags['ExclusionsLength'], 11443);
  assertEquals(tags['Signature'], 'self#jumbf=c2pa.signature');
  assertEquals(tags['AssertionsUrl'], ['self#jumbf=c2pa.assertions/c2pa.actions', 'self#jumbf=c2pa.assertions/c2pa.hash.data']);
  assertEquals(tags['AssertionsHash'], ['(Binary data 32 bytes, use -b option to extract)', '(Binary data 32 bytes, use -b option to extract)']);
  assertEquals(tags['Title'], 'Generated Image');
  assertEquals(tags['Format'], 'image/jpeg');
  assertEquals(tags['InstanceID'], '1.0');
});

test('manifest tags top-level arrays as Item0..N (COSE signature box)', () => {
  const coseItems: unknown[] = [
    new Uint8Array([1, 2, 3]),
    new Map<string, unknown>([['pad', new Uint8Array(8)], ['sigTst', new Map<string, unknown>([['tstTokens', [new Map<string, unknown>([['val', new Uint8Array(4)]])]]])]]),
    null,
    new Uint8Array([9, 9, 9]),
  ];
  const tags = parseC2PAManifest(enc(coseItems));
  assertEquals(tags['Item0'], '(Binary data 3 bytes, use -b option to extract)');
  assertEquals(tags['Item1Pad'], '(Binary data 8 bytes, use -b option to extract)');
  assertEquals(tags['Item1SigTstTstTokensVal'], '(Binary data 4 bytes, use -b option to extract)');
  assertEquals(tags['Item2'], 'null');
  assertEquals(tags['Item3'], '(Binary data 3 bytes, use -b option to extract)');
});

test('manifest tag table overrides bare key names', () => {
  const tableMap = new Map<string, unknown>([
    ['dc:title', 'T'],
    ['dc:format', 'image/png'],
    ['documentID', 'doc-1'],
    ['thumbnailUrl', 'http://x/y.png'],
    ['relationship', 'rel'],
    ['pad', new Uint8Array(1)],
  ]);
  const tags = parseC2PAManifest(enc(tableMap));
  assertEquals(tags['Title'], 'T');
  assertEquals(tags['Format'], 'image/png');
  assertEquals(tags['DocumentID'], 'doc-1');
  assertEquals(tags['ThumbnailURL'], 'http://x/y.png');
  assertEquals(tags['Relationship'], 'rel');
  assertEquals(tags['Pad'], '(Binary data 1 bytes, use -b option to extract)');
});

test('merkle helper returns raw decode', () => {
  const merkle = parseC2PAMerkle(enc({ a: 1 }));
  if (!(merkle instanceof Map)) throw new Error('expected map');
  assertEquals(merkle.get('a'), 1);
});