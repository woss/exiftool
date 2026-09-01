import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { parseJUMBF, parseJUMBFFromSegment, C2PA_UUID } from './jumbf.js';

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Standard JUMBF box header: u32be size + 4-char type. */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, 8 + payload.length, false);
  out.set(encoder.encode(type), 4);
  out.set(payload, 8);
  return out;
}

/** JUMD payload: 16-byte type UUID, 1-byte flags, optional null-terminated label. */
function jumd(type16: Uint8Array, flags = 0x02, label?: string): Uint8Array {
  const labelPart =
    label !== undefined ? concat(encoder.encode(label), new Uint8Array([0])) : new Uint8Array(0);
  return concat(type16, new Uint8Array([flags]), labelPart);
}

/** Minimal CBOR map encoder: string keys, string/number/null/Uint8Array values. */
function cborSimple(obj: Record<string, unknown>): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xa0 | Object.keys(obj).length])];
  for (const [k, v] of Object.entries(obj)) {
    const kb = encoder.encode(k);
    parts.push(new Uint8Array([0x60 | kb.length]), kb);
    if (typeof v === 'string') {
      const vb = encoder.encode(v);
      parts.push(new Uint8Array([0x60 | vb.length]), vb);
    } else if (typeof v === 'number') {
      parts.push(new Uint8Array([0x18, v]));
    } else if (v instanceof Uint8Array) {
      parts.push(new Uint8Array([0x40 | v.length]), v);
    } else if (v === null) {
      parts.push(new Uint8Array([0xf6]));
    }
  }
  return concat(...parts);
}

/** 16-byte type UUID matching the real Adobe C2PA file: 'c2pa' + 12 bytes. */
function c2paType16(): Uint8Array {
  return new Uint8Array([
    0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10,
    0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
  ]);
}

test('jumbf parses nested jumb containers with header prefix', () => {
  const manifest = box('cbor', cborSimple({ claim_generator: 'g/1.0' }));
  const innerJumb = box('jumb', concat(box('jumd', jumd(c2paType16(), 0x02, 'c2pa.claim')), manifest));
  const outerJumb = box('jumb', concat(box('jumd', jumd(c2paType16(), 0x02, 'c2pa')), innerJumb));
  const data = concat(new Uint8Array([0x02, 0x11, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]), outerJumb);
  const tags = parseJUMBF(data);
  assertEquals(tags['JUMDType'], '(c2pa)-0011-0010-800000aa00389b71');
  assertEquals(tags['JUMDLabel'], 'c2pa');
  assertEquals(tags['Claim_generator'], 'g/1.0');
});

test('jumbf JUMDType falls back to raw hex for non-ascii types', () => {
  const type16 = new Uint8Array(16).fill(0xab);
  const tags = parseJUMBF(box('jumb', box('jumd', jumd(type16, 0x02, 'lbl'))));
  assertEquals(tags['JUMDType'], 'abababab-abab-abab-abababababababab');
  assertEquals(tags['JUMDLabel'], 'lbl');
});

test('jumbf associates cbor payloads only with content-labeled jumd boxes', () => {
  const data = box('jumb', concat(
    box('jumd', jumd(c2paType16(), 0x02, 'c2pa')),
    box('cbor', cborSimple({ action: 'ignored' })),
    box('jumd', jumd(c2paType16(), 0x02, 'c2pa.actions')),
    box('cbor', cborSimple({ action: 'c2pa.created' })),
  ));
  const tags = parseJUMBF(data);
  // cbor after the bare 'c2pa' jumd is skipped; only the actions-labeled box parses
  assertEquals(tags['Action'], 'c2pa.created');
});

test('jumbf parses flat jumd boxes without a container', () => {
  const c2ma = new Uint8Array([0x63, 0x32, 0x6d, 0x61, ...c2paType16().slice(4)]);
  const tags = parseJUMBF(concat(
    box('jumd', jumd(c2paType16(), 0x02, 'c2pa')),
    box('jumd', jumd(c2ma, 0x02, 'adobe:urn:uuid:5beddb05-b0ab-417c-97e1-b30da5ab15c3')),
  ));
  assertEquals(tags['JUMDType'], '(c2pa)-0011-0010-800000aa00389b71');
  assertEquals(tags['JUMDLabel'], 'c2pa');
});

test('jumbf c2cs signature label parses COSE array box', () => {
  const cose = box('cbor', new Uint8Array([0x84, 0xf6, 0xa0, 0xf6, 0xf6])); // [null, {}, null, null]
  const data = box('jumb', concat(
    box('jumd', jumd(c2paType16(), 0x02, 'c2pa.signature')),
    cose,
  ));
  const tags = parseJUMBF(data);
  assertEquals('Item0' in tags, true);
  assertEquals(tags['Item2'], 'null');
});

test('jumbf UUID box with the C2PA UUID recurses', () => {
  const uuidPayload = concat(C2PA_UUID, box('jumd', jumd(c2paType16(), 0x02, 'c2pa')));
  const tags = parseJUMBF(box('uuid', uuidPayload));
  assertEquals(tags['JUMDLabel'], 'c2pa');
});

test('jumbf ignores garbage and truncated boxes', () => {
  assertEquals(parseJUMBF(new Uint8Array(5)), {});
  assertEquals(parseJUMBF(concat(new Uint8Array(8), box('jumd', new Uint8Array(4)))), {});
  // invalid trailing bytes after a valid box walk the skip path
  const valid = box('jumb', box('jumd', jumd(c2paType16(), 0x02, 'c2pa')));
  const tags = parseJUMBF(concat(valid, new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05])));
  assertEquals(tags['JUMDLabel'], 'c2pa');
});

test('jumbf parses top-level cbor payloads associated by label', () => {
  const data = concat(
    box('jumd', jumd(c2paType16(), 0x02, 'c2pa.actions')),
    box('cbor', cborSimple({ action: 'c2pa.created' })),
  );
  const tags = parseJUMBF(data);
  assertEquals(tags['Action'], 'c2pa.created');
});

test('jumbf JUMD flags parse label, ID and signature fields', () => {
  // flags 0x0e: label + ID + signature; payload has label, 4-byte ID, 32-byte sig
  const idSig = concat(
    jumd(c2paType16(), 0x0e, 'c2pa'),
    new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    new Uint8Array(32).fill(0xaa),
  );
  const tags = parseJUMBF(box('jumd', idSig));
  assertEquals(tags['JUMDLabel'], 'c2pa');
  // flags 0x04 without enough bytes for the ID -> jumd rejected
  assertEquals(parseJUMBF(box('jumb', box('jumd', concat(c2paType16(), new Uint8Array([0x04]))))), {});
});

test('segment entry strips the JP prefix only', () => {
  const seg = concat(encoder.encode('JP'), box('jumb', box('jumd', jumd(c2paType16(), 0x02, 'c2pa'))));
  assertEquals(parseJUMBFFromSegment(seg)['JUMDLabel'], 'c2pa');
  assertEquals(parseJUMBFFromSegment(encoder.encode('notJP')), {});
});