import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { formatJSON, formatCSV, formatTabular, formatXML, formatDateValue } from './output.js';
import type { FormatOptions } from './output.js';
import { TagDb } from '../tag-db.js';
import type { FileInfo } from '../types.js';
import { detectParser } from '../format/mod.js';
// Side-effect import: registers the JPEG parser with the parser registry.
import '../format/jpeg.js';

function makeDb(): TagDb {
  const db = new TagDb();
  db.registerBatch([
    {
      id: 0x010f,
      name: 'Make',
      description: 'Camera make',
      writable: true,
      groups: { family0: 'EXIF', family1: 'EXIF', family2: 'Image', family7: '' },
    },
    {
      id: 0x0110,
      name: 'Model',
      description: 'Camera model',
      writable: true,
      groups: { family0: 'EXIF', family1: 'EXIF', family2: 'Image', family7: '' },
    },
    {
      id: 0xa002,
      name: 'ImageWidth',
      description: 'Image width',
      writable: true,
      groups: { family0: 'EXIF', family1: 'EXIF', family2: 'Image', family7: '' },
    },
    {
      id: 0x0000,
      name: 'FileName',
      description: 'File name',
      writable: false,
      groups: { family0: 'File', family1: 'File', family2: 'File', family7: '' },
    },
    {
      id: 0x0001,
      name: 'FileSize',
      description: 'File size',
      writable: false,
      groups: { family0: 'File', family1: 'File', family2: 'File', family7: '' },
    },
  ]);
  return db;
}

const mockFiles: FileInfo[] = [
  {
    path: 'test.jpg',
    format: 'JPEG',
    tags: {
      FileName: 'test.jpg',
      FileSize: 12345,
      Make: 'Canon',
      Model: 'EOS R5',
      ImageWidth: 8192,
    },
  },
];

test('formatTabular — no options (backward compat)', () => {
  const result = formatTabular(mockFiles);
  assertEquals(result, 'FileName\ttest.jpg\nFileSize\t12345\nMake\tCanon\nModel\tEOS R5\nImageWidth\t8192');
});

test('formatTabular — groupHeadings (family 0)', () => {
  const opts: FormatOptions = { groupHeadings: '0', tagDb: makeDb() };
  const result = formatTabular(mockFiles, opts);
  const lines = result.split('\n');
  // Should contain GROUP headers
  assert(lines.some((l) => l.startsWith('------ GROUP:')));
  // File tags should be in the File group
  assert(lines.some((l) => l === '------ GROUP:File ----'));
  // EXIF tags should be in the EXIF group
  assert(lines.some((l) => l === '------ GROUP:EXIF ----'));
  // Tag values should still appear
  assert(lines.some((l) => l.includes('Canon')));
  assert(lines.some((l) => l.includes('test.jpg')));
});

test('formatTabular — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatTabular(mockFiles, opts);
  const lines = result.split('\n');
  // Tags should have group prefix
  assert(lines.some((l) => l.startsWith('EXIF:')));
  assert(lines.some((l) => l.startsWith('File:')));
  // Values unchanged
  assert(lines.some((l) => l.includes('Canon')));
});

test('formatJSON — no options (backward compat)', () => {
  const result = formatJSON(mockFiles);
  const parsed = JSON.parse(result);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0]['Make'], 'Canon');
  assertEquals(parsed[0]['FileName'], 'test.jpg');
});

test('formatJSON — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatJSON(mockFiles, opts);
  const parsed = JSON.parse(result);
  // Keys should be prefixed
  assertEquals(parsed[0]['EXIF:Make'], 'Canon');
  assertEquals(parsed[0]['EXIF:Model'], 'EOS R5');
  assertEquals(parsed[0]['File:FileName'], 'test.jpg');
  // Original keys should NOT exist
  assertEquals(parsed[0]['Make'], undefined);
});

test('formatJSON — multiple files produce array elements', () => {
  const files: FileInfo[] = [
    { path: 'a.jpg', format: 'JPEG', tags: { Make: 'Canon' } },
    { path: 'b.jpg', format: 'JPEG', tags: { Make: 'Nikon' } },
  ];
  const parsed = JSON.parse(formatJSON(files));
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0]['Make'], 'Canon');
  assertEquals(parsed[1]['Make'], 'Nikon');
});

test('formatCSV — no options (backward compat)', () => {
  const result = formatCSV(mockFiles);
  assert(result.startsWith('SourceFile'));
  assert(result.includes('Make'));
});

test('formatCSV — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatCSV(mockFiles, opts);
  // Header should have prefixed names
  const header = result.split('\n')[0];
  assert(header.includes('EXIF:Make'), `Expected EXIF:Make in header, got: ${header}`);
  assert(header.includes('File:FileName'), `Expected File:FileName in header, got: ${header}`);
  // Values row should have correct data
  const dataRow = result.split('\n')[1];
  assert(dataRow.includes('Canon'));
});

test('formatXML — no options (backward compat)', () => {
  const result = formatXML(mockFiles);
  assert(result.includes('<tag name="Make">Canon</tag>'));
  assert(result.includes('<tag name="FileName">test.jpg</tag>'));
});

test('formatXML — groupPrefix (family 1)', () => {
  const opts: FormatOptions = { groupPrefix: '1', tagDb: makeDb() };
  const result = formatXML(mockFiles, opts);
  assert(result.includes('<tag name="EXIF:Make">Canon</tag>'));
  assert(result.includes('<tag name="File:FileName">test.jpg</tag>'));
});

test('formatTabular — empty tagDb (graceful degradation)', () => {
  const opts: FormatOptions = { groupHeadings: '0', tagDb: undefined };
  const result = formatTabular(mockFiles, opts);
  // Without tagDb, group headings gracefully degrade to flat output
  // (getGroupName returns empty, no headings rendered)
  assert(!result.includes('------ GROUP:'));
  assert(result.includes('Canon'));
  assert(result.includes('Make\tCanon'));
});

test('formatTabular — both groupHeadings and groupPrefix', () => {
  const opts: FormatOptions = {
    groupHeadings: '0',
    groupPrefix: '1',
    tagDb: makeDb(),
  };
  const result = formatTabular(mockFiles, opts);
  const lines = result.split('\n');
  assert(lines.some((l) => l.startsWith('------ GROUP:File ----')));
  assert(lines.some((l) => l.startsWith('------ GROUP:EXIF ----')));
  // Tag lines should have family 1 prefix (EXIF: for EXIF-group tags)
  const exifLines = lines.filter((l) => l.startsWith('EXIF:'));
  assert(exifLines.length > 0);
});

test('formatDateValue — matches EXIF date', () => {
  const v = formatDateValue('2025:06:26 10:30:45', '%Y-%m-%d');
  assertEquals(v, '2025-06-26');
});

test('formatDateValue — non-date string unchanged', () => {
  const v = formatDateValue('Canon', '%Y-%m-%d');
  assertEquals(v, 'Canon');
});

test('formatDateValue — subseconds preserved', () => {
  const v = formatDateValue('2025:06:26 10:30:45.123', '%Y-%m-%d %H:%M:%S.%f');
  assertEquals(v, '2025-06-26 10:30:45.123');
});

test('formatTabular — with dateFormat formats dates', () => {
  const opts: FormatOptions = { dateFormat: '%Y-%m-%d' };
  const files: FileInfo[] = [{
    path: 'test.jpg',
    format: 'JPEG',
    tags: {
      DateTimeOriginal: '2025:06:26 10:30:45',
      Make: 'Canon',
    },
  }];
  const result = formatTabular(files, opts);
  assert(result.includes('DateTimeOriginal\t2025-06-26'));
  assert(result.includes('Make\tCanon'));
});

test('formatJSON — with dateFormat formats dates', () => {
  const opts: FormatOptions = { dateFormat: '%Y-%m-%d' };
  const files: FileInfo[] = [{
    path: 'test.jpg',
    format: 'JPEG',
    tags: {
      DateTimeOriginal: '2025:06:26 10:30:45',
      Make: 'Canon',
    },
  }];
  const result = formatJSON(files, opts);
  const parsed = JSON.parse(result);
  assertEquals(parsed[0]['DateTimeOriginal'], '2025-06-26');
  assertEquals(parsed[0]['Make'], 'Canon');
});

// --- Binary extraction (-b) coverage ---

test('formatTabular — Uint8Array value renders binary placeholder without mutating value', () => {
  const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const snapshot = new Uint8Array(original);
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: original },
  }];
  const result = formatTabular(files);
  assert(result.includes('ThumbnailImage\t(Binary data 8 bytes, use -b option to extract)'));
  // The renderer must not mutate the value object it was handed.
  assertEquals(original, snapshot);
});

test('formatJSON — Uint8Array value serialized without mutating value', () => {
  const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const snapshot = new Uint8Array(original);
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: original },
  }];
  const result = formatJSON(files);
  const parsed = JSON.parse(result);
  // The JSON renderer renders binary tags as the same "(Binary data N bytes,
  // use -b option to extract)" placeholder used by text renderers (tabular/XML).
  assertEquals(parsed[0]['ThumbnailImage'], '(Binary data 4 bytes, use -b option to extract)');
  // The renderer must not mutate the value object it was handed.
  assertEquals(original, snapshot);
});

/**
 * Builds a synthetic JPEG containing an APP1 EXIF segment whose TIFF
 * structure has an IFD0 (Make only) and an IFD1 carrying ThumbnailOffset /
 * ThumbnailLength pointing at `thumb`, which is embedded inside the TIFF
 * blob (the layout real cameras use). Follows the in-code buffer-builder
 * pattern from src/format/format.test.ts.
 */
function makeJpegWithExifThumbnail(thumb: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const makeStr = encoder.encode('TestMake\0'); // 9 bytes → stored out-of-line

  // Big-endian TIFF layout:
  //   [0..8)    header ("MM", 42, IFD0 offset)
  //   [8..26)   IFD0: 1 entry (Make), next-IFD pointer → IFD1
  //   [26..56)  IFD1: ThumbnailOffset + ThumbnailLength, next-IFD pointer = 0
  //   [56..65)  extra data: Make string
  //   [65..)    thumbnail bytes
  const ifd0Offset = 8;
  const ifd1Offset = ifd0Offset + 2 + 12 + 4; // 26
  const extraOffset = ifd1Offset + 2 + 2 * 12 + 4; // 56
  const thumbRelOffset = extraOffset + makeStr.length; // 65

  const tiff = new Uint8Array(thumbRelOffset + thumb.length);
  const dv = new DataView(tiff.buffer);

  tiff[0] = 0x4d;
  tiff[1] = 0x4d;
  dv.setUint16(2, 42, false);
  dv.setUint32(4, ifd0Offset, false);

  dv.setUint16(ifd0Offset, 1, false); // entry count
  dv.setUint16(ifd0Offset + 2, 0x010f, false); // Make
  dv.setUint16(ifd0Offset + 4, 2, false); // type ASCII
  dv.setUint32(ifd0Offset + 6, makeStr.length, false);
  dv.setUint32(ifd0Offset + 10, extraOffset, false);
  dv.setUint32(ifd0Offset + 14, ifd1Offset, false); // next IFD

  dv.setUint16(ifd1Offset, 2, false); // entry count
  dv.setUint16(ifd1Offset + 2, 0x0201, false); // ThumbnailOffset
  dv.setUint16(ifd1Offset + 4, 4, false); // type LONG
  dv.setUint32(ifd1Offset + 6, 1, false);
  dv.setUint32(ifd1Offset + 10, thumbRelOffset, false);
  dv.setUint16(ifd1Offset + 14, 0x0202, false); // ThumbnailLength
  dv.setUint16(ifd1Offset + 16, 4, false); // type LONG
  dv.setUint32(ifd1Offset + 18, 1, false);
  dv.setUint32(ifd1Offset + 22, thumb.length, false);
  dv.setUint32(ifd1Offset + 26, 0, false); // no IFD2

  tiff.set(makeStr, extraOffset);
  tiff.set(thumb, thumbRelOffset);

  const app1Payload = new Uint8Array(6 + tiff.length);
  app1Payload.set(encoder.encode('Exif\0\0'), 0);
  app1Payload.set(tiff, 6);

  const bytes = new Uint8Array(2 + 2 + 2 + app1Payload.length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8; // SOI
  bytes[2] = 0xff;
  bytes[3] = 0xe1; // APP1
  new DataView(bytes.buffer).setUint16(4, 2 + app1Payload.length, false);
  bytes.set(app1Payload, 6);

  return bytes;
}

test('JPEG parse — EXIF IFD1 thumbnail extracted as exact bytes (ThumbnailImage)', async () => {
  const thumbBytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03,
    0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02,
  ]);
  const bytes = makeJpegWithExifThumbnail(thumbBytes);

  const parser = detectParser(bytes)!;
  const info = await parser.parse(bytes, 'thumb.jpg');

  assertEquals(info.format, 'JPEG');
  assertEquals(info.tags['Make'], 'TestMake');
  // ThumbnailLength comes straight from IFD1 tag 0x0202.
  assertEquals(info.tags['ThumbnailLength'], thumbBytes.length);
  // jpeg.ts rewrites ThumbnailOffset from TIFF-relative to absolute file offset:
  // tiffFileOffset (12: SOI + APP1 marker + length + "Exif\0\0") + thumbRelOffset (65).
  assertEquals(info.tags['ThumbnailOffset'], 12 + 65);
  const thumbImage = info.tags['ThumbnailImage'];
  assert(thumbImage instanceof Uint8Array);
  assertEquals(thumbImage.length, thumbBytes.length);
  assertEquals(Array.from(thumbImage), Array.from(thumbBytes));
});

function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// --- Binary representation parity (-b / binary tags across formats) ---

test('formatJSON — Uint8Array without binary flag uses placeholder, no object leakage', () => {
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: new Uint8Array([104, 105]) },
  }];
  const result = formatJSON(files);
  assert(result.includes('"ThumbnailImage": "(Binary data 2 bytes, use -b option to extract)"'));
  assert(!result.includes('"0"'));
});

test('formatJSON — binary:true emits base64 for known vector', () => {
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: new Uint8Array([104, 105]) },
  }];
  const result = formatJSON(files, { binary: true });
  const parsed = JSON.parse(result);
  assertEquals(parsed[0]['ThumbnailImage'], 'aGk=');
});

test('formatJSON — binary:true base64 correct for chunked large buffer', () => {
  // >32KB forces multiple String.fromCharCode chunks in toBase64
  const bytes = new Uint8Array(100_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
  const files: FileInfo[] = [{
    path: 'big.bin',
    format: 'JPEG',
    tags: { ExifImageData: bytes },
  }];
  const expected = btoa(String.fromCharCode(...bytes));
  const result = formatJSON(files, { binary: true });
  const parsed = JSON.parse(result);
  assertEquals(parsed[0]['ExifImageData'], expected);
});

test('formatJSON — zero-length Uint8Array key omitted', () => {
  const files: FileInfo[] = [{
    path: 'empty.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: new Uint8Array(0), Make: 'TestCam' },
  }];
  const result = formatJSON(files);
  const parsed = JSON.parse(result);
  assert(!('ThumbnailImage' in parsed[0]));
  assertEquals(parsed[0]['Make'], 'TestCam');
});

test('formatXML — Uint8Array placeholder matches tabular wording; binary:true gives base64', () => {
  const value = new Uint8Array([104, 105]);
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: value },
  }];
  const xml = formatXML(files);
  const tabular = formatTabular(files);
  const placeholder = '(Binary data 2 bytes, use -b option to extract)';
  assert(tabular.includes(`ThumbnailImage\t${placeholder}`));
  assert(xml.includes(`>${placeholder}</tag>`));
  const xmlB64 = formatXML(files, { binary: true });
  assert(xmlB64.includes('>aGk=</tag>'));
});

test('formatCSV — Uint8Array placeholder matches shared wording; binary:true gives base64', () => {
  const value = new Uint8Array([104, 105]);
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    tags: { ThumbnailImage: value },
  }];
  const csv = formatCSV(files);
  assert(csv.includes('"(Binary data 2 bytes, use -b option to extract)"'));
  const csvB64 = formatCSV(files, { binary: true });
  assert(csvB64.includes('"aGk="'));
});

test('formatJSON — groupPrefix applies to binary placeholder keys', () => {
  const files: FileInfo[] = [{
    path: 'thumb.jpg',
    format: 'JPEG',
    // Make is registered in makeDb(); value kind is irrelevant to key handling.
    tags: { Make: new Uint8Array([104, 105]) },
  }];
  const result = formatJSON(files, { groupPrefix: true, tagDb: makeDb() });
  const parsed = JSON.parse(result);
  assertEquals(parsed[0]['EXIF:Make'], '(Binary data 2 bytes, use -b option to extract)');
});

// --- getGroupName fallback arms (no tagDb / unknown tag) ---

test('formatTabular — groupPrefix without tagDb degrades to unprefixed names', () => {
  const opts: FormatOptions = { groupPrefix: '1' };
  const result = formatTabular(mockFiles, opts);
  assert(!result.includes('EXIF:Make'));
  assert(result.includes('Make\tCanon'));
});

test('formatTabular — headings with tagDb missing the tag yields unknown group', () => {
  const files: FileInfo[] = [{ path: 'x.jpg', format: 'JPEG', tags: { UnknownTag: 'v' } }];
  const opts: FormatOptions = { groupHeadings: '0', tagDb: makeDb() };
  const result = formatTabular(files, opts);
  assert(result.includes('------ GROUP:(unknown) ----'));
});

// --- tagValueToString null/undefined and array arms ---

test('formatTabular — null value renders as dash', () => {
  const files: FileInfo[] = [{
    path: 'n.jpg',
    format: 'JPEG',
    tags: { NullTag: null },
  }];
  const result = formatTabular(files);
  const lines = result.split('\n');
  assert(lines.includes('NullTag\t-'));
});

test('formatTabular — array values render comma-separated recursively', () => {
  const files: FileInfo[] = [{
    path: 'a.jpg',
    format: 'JPEG',
    tags: { Curve: ['0, 0', '255, 255'], Nested: [1, [2, 3]] },
  }];
  const result = formatTabular(files);
  const lines = result.split('\n');
  assert(lines.includes('Curve\t0, 0, 255, 255'));
  assert(lines.includes('Nested\t1, 2, 3'));
});

test('formatTabular — group family absent on entry falls back to no prefix', () => {
  const db = new TagDb();
  db.registerBatch([
    {
      id: 0x010f,
      name: 'Make',
      description: 'Camera make',
      writable: true,
      groups: { family0: 'EXIF' }, // family1 intentionally missing
    },
  ]);
  const files: FileInfo[] = [{ path: 'm.jpg', format: 'JPEG', tags: { Make: 'Canon' } }];
  const opts: FormatOptions = { groupPrefix: '1', tagDb: db };
  const result = formatTabular(files, opts);
  assert(!result.includes('EXIF:'));
  assert(result.includes('Make\tCanon'));
});
