import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { parseAPP13 } from './app13.js';
import { md5Hex } from '../utils/md5.js';

const enc = new TextEncoder();

function b(...nums: number[]): Uint8Array {
  return Uint8Array.from(nums);
}

function u16(n: number): Uint8Array {
  return b((n >> 8) & 0xff, n & 0xff);
}

function u32(n: number): Uint8Array {
  return b((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** IPTC dataset: 0x1C marker + record number + dataset number + BE u16 length + value. */
function iptcField(recNum: number, dsNum: number, value: string | Uint8Array): Uint8Array {
  const raw = typeof value === 'string' ? enc.encode(value) : value;
  return concatBytes([b(0x1c, recNum, dsNum), u16(raw.length), raw]);
}

/**
 * Photoshop image resource ("8BIM" + BE u16 id + Pascal name padded to even
 * length + BE u32 size + data, data itself padded to even length).
 */
function photoshopResource(resId: number, data: Uint8Array, name = ''): Uint8Array {
  const nameBytes = enc.encode(name);
  const parts: Uint8Array[] = [enc.encode('8BIM'), u16(resId), b(nameBytes.length), nameBytes];
  if (nameBytes.length % 2 === 0) parts.push(b(0)); // pad name to odd total length
  parts.push(u32(data.length), data);
  if (data.length % 2 !== 0) parts.push(b(0)); // even-align next resource
  return concatBytes(parts);
}

test('parseAPP13 decodes record 2 keywords, object name and caption', () => {
  const iptc = concatBytes([
    iptcField(2, 0, b(0x00, 0x04)), // ApplicationRecordVersion
    iptcField(2, 5, 'Scene'), // ObjectName
    iptcField(2, 25, 'sunset'),
    iptcField(2, 25, 'beach'),
    iptcField(2, 120, 'A sunset over water'), // Caption-Abstract
  ]);
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc)), {
    ApplicationRecordVersion: '4',
    ObjectName: 'Scene',
    Keywords: ['sunset', 'beach'],
    'Caption-Abstract': 'A sunset over water',
    CurrentIPTCDigest: md5Hex(iptc),
  });
});

test('parseAPP13 decodes by-line, copyright notice and coded character set', () => {
  const iptc = concatBytes([
    iptcField(1, 90, '\x1b%G'), // CodedCharacterSet — value is replaced with the fixed 'UTF8'
    iptcField(2, 80, 'Jane Doe'), // By-line
    iptcField(2, 116, '© 2026 Acme Corp'), // CopyrightNotice
  ]);
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc)), {
    CodedCharacterSet: 'UTF8',
    'By-line': 'Jane Doe',
    CopyrightNotice: '© 2026 Acme Corp',
    CurrentIPTCDigest: md5Hex(iptc),
  });
});

test('parseAPP13 renders IIM dates and times in exiftool format', () => {
  const iptc = concatBytes([
    iptcField(2, 55, '2026:08:25'), // DateCreated (already formatted)
    iptcField(2, 60, '12:34:56'), // TimeCreated
    iptcField(2, 62, '20260825'), // DigitalCreationDate (compact digits)
  ]);
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc)), {
    DateCreated: '2026:08:25',
    TimeCreated: '12:34:56',
    DigitalCreationDate: '2026:08:25',
    CurrentIPTCDigest: md5Hex(iptc),
  });
});

test('parseAPP13 expands the 19-digit DateCreated form', () => {
  const iptc = concatBytes([iptcField(2, 55, '20260825123456+0200')]);
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc)), {
    DateCreated: '2026:08:25 12:34:56',
    CurrentIPTCDigest: md5Hex(iptc),
  });
});
test('parseAPP13 ignores datasets whose numbers are not in the lookup table', () => {
  // Dataset 45 (0x2D) has no mapping in IPTC_LOOKUP, so it is skipped entirely.
  const iptc = concatBytes([
    iptcField(2, 25, 'kept'),
    iptcField(2, 45, '2026:08:25 12:00:00'),
    iptcField(10, 25, 'record 10 is skipped too'),
  ]);
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc)), {
    Keywords: ['kept'],
    CurrentIPTCDigest: md5Hex(iptc),
  });
});

test('parseAPP13 decodes Photoshop display units resources', () => {
  assertEquals(
    parseAPP13(concatBytes([photoshopResource(0x0417, b(2)), photoshopResource(0x0418, b(1))])),
    { DisplayedUnitsX: 'inches', DisplayedUnitsY: 'cm' },
  );
});

test('parseAPP13 skips unknown resources and survives odd-length padding', () => {
  // Unknown resource id 0x2710 with odd-size data must be stepped over (with
  // its pad byte) so that the following resource still parses.
  const block = concatBytes([
    photoshopResource(0x2710, b(0xde, 0xad, 0xbe)),
    photoshopResource(0x0417, b(2)),
  ]);
  assertEquals(parseAPP13(block), { DisplayedUnitsX: 'inches' });
});

test('parseAPP13 handles non-empty Pascal names in resources', () => {
  const iptc = iptcField(2, 5, 'Named');
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc, 'AB')), {
    ObjectName: 'Named',
    CurrentIPTCDigest: md5Hex(iptc),
  });
  assertEquals(parseAPP13(photoshopResource(0x0404, iptc, 'ABC')), {
    ObjectName: 'Named',
    CurrentIPTCDigest: md5Hex(iptc),
  });
});

test('parseAPP13 returns empty for buffers shorter than one resource header', () => {
  assertEquals(parseAPP13(new Uint8Array(0)), {});
  assertEquals(parseAPP13(b(0x38)), {});
  assertEquals(parseAPP13(enc.encode('8BIM\x00')), {});
});

test('parseAPP13 returns empty when the signature is not 8BIM', () => {
  assertEquals(parseAPP13(enc.encode('hello world this is not a photoshop block')), {});
  assertEquals(
    parseAPP13(concatBytes([b(0x38, 0x42, 0x49, 0x58), u16(0x0404), b(0), u32(4), b(1, 2, 3, 4)])),
    {},
  );
});

test('parseAPP13 stops cleanly on a truncated resource header or size overrun', () => {
  // Header complete but size field cut off.
  assertEquals(parseAPP13(enc.encode('8BIM\x04\x04\x00\x00')), {});
  // Declared size exceeds the bytes actually present.
  assertEquals(
    parseAPP13(concatBytes([b(0x38, 0x42, 0x49, 0x4d), u16(0x0404), b(0), u32(100), b(1, 2)])),
    {},
  );
});

test('parseAPP13 keeps fields parsed before a truncated IPTC dataset without throwing', () => {
  // Second keyword claims 50 payload bytes but only 2 are present.
  const truncated = concatBytes([
    iptcField(2, 25, 'sun'),
    b(0x1c, 2, 25),
    u16(50),
    enc.encode('su'),
  ]);
  assertEquals(parseAPP13(photoshopResource(0x0404, truncated)), {
    Keywords: ['sun'],
    CurrentIPTCDigest: md5Hex(truncated),
  });
});

test('parseAPP13 ignores IPTC payloads that do not start with a dataset marker', () => {
  const data = photoshopResource(0x0404, b(0x00, 0x01, 0x02, 0x03, 0x04));
  assertEquals(parseAPP13(data), { CurrentIPTCDigest: md5Hex(b(0x00, 0x01, 0x02, 0x03, 0x04)) });
});

test('parseAPP13 maps non-inch display unit codes to centimetres', () => {
  const data = concatBytes([
    photoshopResource(0x0417, b(1)),
    photoshopResource(0x0418, b(0)),
  ]);
  assertEquals(parseAPP13(data), { DisplayedUnitsX: 'cm', DisplayedUnitsY: 'cm' });
});

test('parseAPP13 maps inch codes for both display unit axes', () => {
  const data = concatBytes([
    photoshopResource(0x0417, b(2)),
    photoshopResource(0x0418, b(2)),
  ]);
  assertEquals(parseAPP13(data), { DisplayedUnitsX: 'inches', DisplayedUnitsY: 'inches' });
});

test('parseAPP13 keeps earlier fields when an IPTC dataset length overruns the buffer', () => {
  const truncated = concatBytes([b(0x1c, 2, 120), u16(5)]); // declares 5 bytes that never arrive
  const data = photoshopResource(0x0404, concatBytes([iptcField(2, 120, 'Caption'), truncated]));
  assertEquals(parseAPP13(data), {
    'Caption-Abstract': 'Caption',
    CurrentIPTCDigest: md5Hex(concatBytes([iptcField(2, 120, 'Caption'), truncated])),
  });
});

test('parseAPP13 stops cleanly when the buffer ends right after an 8BIM signature', () => {
  assertEquals(parseAPP13(concatBytes([enc.encode('8BIM'), b(0x04)])), {});
});

test('parseAPP13 emits PhotoshopThumbnail without its 28-byte header', () => {
  const header = new Uint8Array(28);
  const jpeg = b(0xff, 0xd8, 0xff, 0xd9);
  const data = concatBytes([
    photoshopResource(0x040c, concatBytes([header, jpeg])),
    photoshopResource(0x0417, b(2)), // walk continues past the thumbnail
  ]);
  const r = parseAPP13(data);
  assertEquals([...(r['PhotoshopThumbnail'] as Uint8Array)], [0xff, 0xd8, 0xff, 0xd9]);
  assertEquals(r['DisplayedUnitsX'], 'inches');
});
