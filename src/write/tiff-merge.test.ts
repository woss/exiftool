import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { readFileSync } from 'node:fs';
import { buildTiff } from '../exif/tiff-builder.js';
import { tiffRawParser } from '../format/tiff-raw.js';
import { tiffMergeWriter } from './tiff-merge.js';
import { UnsupportedFormatError } from './writers.js';

/** buildTiff emits a standalone TIFF block (II header + IFD0) — a valid TIFF file. */
const tiff = () => buildTiff({ Make: 'TestM', Model: 'Unit 1' }).bytes;
const cr2 = () => new Uint8Array(readFileSync('assets/raw/CanonRaw.cr2'));

test('tiffMergeWriter merges XMP into the IFD0 XMP tag and keeps camera EXIF', async () => {
  const out = tiffMergeWriter(tiff(), {
    'XMP-dc:Subject': ['unit', 'tiff'],
    'XMP-dc:Title': 'Unit tiff',
  });
  assertEquals(out.skipped, []);
  assertEquals(out.written.sort(), ['XMP-dc:Subject', 'XMP-dc:Title']);
  const reread = await tiffRawParser.parse(out.bytes, '(test)');
  assertEquals(reread.tags.Subject, ['unit', 'tiff']);
  assertEquals(reread.tags.Make, 'TestM');
  assertEquals(reread.tags.Model, 'Unit 1');
});

test('tiffMergeWriter merges EXIF tags structurally', () => {
  const out = tiffMergeWriter(tiff(), { 'EXIF:Copyright': '2026 unit' });
  assertEquals(out.written, ['EXIF:Copyright']);
  // Idempotence: second write is byte-identical.
  const out2 = tiffMergeWriter(out.bytes, { 'EXIF:Copyright': '2026 unit' });
  assertEquals(Array.from(out2.bytes), Array.from(out.bytes));
});

test('tiffMergeWriter round-trips XMP idempotently', () => {
  const tags = { 'XMP-dc:Subject': ['a', 'b'], 'XMP-dc:Title': 'T' };
  const first = tiffMergeWriter(tiff(), tags);
  const second = tiffMergeWriter(first.bytes, tags);
  assertEquals(Array.from(second.bytes), Array.from(first.bytes));
});

test('tiffMergeWriter rejects camera RAW and non-TIFF input', () => {
  let raw = false;
  try {
    tiffMergeWriter(cr2(), { 'XMP-dc:Subject': ['x'] });
  } catch (e) {
    raw = e instanceof UnsupportedFormatError;
  }
  assertEquals(raw, true);
  let notTiff = false;
  try {
    tiffMergeWriter(new Uint8Array(16), { 'XMP-dc:Subject': ['x'] });
  } catch (e) {
    notTiff = e instanceof UnsupportedFormatError;
  }
  assertEquals(notTiff, true);
});

test('tiffMergeWriter refuses files with SubIFDs (raw/tile image data)', () => {
  // assets/raw/DNG.dng is a real DNG whose IFD0 carries a SubIFDs entry.
  const dng = () => new Uint8Array(readFileSync('assets/raw/DNG.dng'));
  let threw = false;
  try {
    tiffMergeWriter(dng(), { 'XMP-dc:Subject': ['x'] });
  } catch (e) {
    threw = e instanceof UnsupportedFormatError && e.message.includes('SubIFDs');
  }
  assertEquals(threw, true);
});

test('tiffMergeWriter rejects Panasonic-magic files (version 85)', () => {
  // RW2 uses magic 0x4949 + version 85; not a writable TIFF stream here.
  const rw2Magic = new Uint8Array([0x49, 0x49, 0x55, 0x00, 8, 0, 0, 0]);
  let threw = false;
  try {
    tiffMergeWriter(rw2Magic, { 'EXIF:Copyright': 'x' });
  } catch (e) {
    threw = e instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('tiffMergeWriter returns original bytes when nothing resolves', () => {
  const bytes = tiff();
  const out = tiffMergeWriter(bytes, { Bogus: 'x' });
  assertEquals(out.skipped, ['Bogus']);
  assertEquals(Array.from(out.bytes), Array.from(bytes));
});
