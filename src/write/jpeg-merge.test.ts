import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm, writeFile } from 'node:fs/promises';
import { tempFile } from '../test/tmp.js';
import { UnsupportedFormatError } from './writers.js';
import {
  jpegMergeWriter,
  mergeExifTiff,
  parseRawTiff,
  parseJpegSegments,
  resolveMergeRequests,
} from './jpeg-merge.js';
import { parseXMP } from '../exif/xmp.js';
import { extractExifFromTiff } from '../exif/tiff.js';
import { jpegParser } from '../format/jpeg.js';
import { mergeDucky, parseDucky } from '../exif/ducky.js';

const execFileP = promisify(execFile);

test('jpegMergeWriter writes ExifIFD SpectralSensitivity', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:SpectralSensitivity': 'Visible light band' });
  assertEquals(result.written, ['EXIF:SpectralSensitivity']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-SpectralSensitivity', file]);
    assertEquals(JSON.parse(stdout)[0].SpectralSensitivity, 'Visible light band');
  } finally {
    await rm(file, { force: true });
  }
});
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

function jpegWithJfif(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0,
    1, 2, 1, 0, 72, 0, 72, 0, 0,
    0xff, 0xd9,
  ]);
}

test('jpegMergeWriter preserves every non-EXIF/XMP segment byte-for-byte', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const before = parseJpegSegments(original);
  const out = jpegMergeWriter(original, {
    Copyright: 'Copyright 2026 Test Author',
    Orientation: 1,
    Rights: 'All rights reserved',
    WebStatement: 'https://example.com/license',
  });
  const after = parseJpegSegments(out.bytes);
  assertEquals(out.skipped, []);
  assertEquals(out.written.sort(), [
    'EXIF:Copyright',
    'EXIF:Orientation',
    'XMP-dc:Rights',
    'XMP-xmpRights:WebStatement',
  ]);
  // Same segment count: both APP1s existed and were replaced in place.
  assertEquals(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assertEquals(after[i].marker, before[i].marker);
    const isExifApp1 = before[i].marker === 0xe1;
    if (!isExifApp1) {
      // APP1 XMP payload legitimately changes (spliced properties); the
      // remaining bytes of every other segment must be identical.
      const a = original.subarray(before[i].start, before[i].end);
      const b = out.bytes.subarray(after[i].start, after[i].end);
      const xmpApp1 =
        before[i].marker === 0xe1 &&
        a.length > 29 &&
        String.fromCharCode(...a.subarray(4, 33)).startsWith('http://ns.adobe.com/xap/1.0/');
      if (!xmpApp1) assertEquals(Array.from(b), Array.from(a), `segment ${i} changed`);
    }
  }
});

test('jpegMergeWriter refuses EXIF rewrites that can invalidate Olympus MakerNote offsets', () => {
  const original = new Uint8Array(readFileSync('assets/raw/Olympus.jpg'));
  let error: unknown;
  try {
    jpegMergeWriter(original, { 'ExifIFD:UserComment': 'offset safety check' });
  } catch (caught) {
    error = caught;
  }
  assertEquals(error instanceof UnsupportedFormatError, true);
  assertEquals(String(error).includes('Olympus MakerNote'), true);
});

test('jpegMergeWriter preserves EXIF values and creates XMP when absent', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const before = extractExifFromTiff(
    original.subarray(parseJpegSegments(original)[0].payloadStart + 6, parseJpegSegments(original)[0].payloadEnd),
  );
  const out = jpegMergeWriter(original, { Copyright: 'New (c) notice' });
  const exifSeg = parseJpegSegments(out.bytes).find((s) => s.marker === 0xe1)!;
  const after = extractExifFromTiff(out.bytes.subarray(exifSeg.payloadStart + 6, exifSeg.payloadEnd));
  assertEquals(after.Make, before.Make);
  assertEquals(after.Model, before.Model);
  assertEquals(after.DateTimeOriginal, before.DateTimeOriginal);
  assertEquals(after.Copyright, 'New (c) notice');
  // Thumbnail survived the structural rebuild.
  assertEquals(after.ThumbnailImage !== undefined, before.ThumbnailImage !== undefined);
  const xmpSeg = parseJpegSegments(out.bytes).find(
    (s) => s.marker === 0xe1 && s.end - s.payloadStart > 29,
  );
  assertEquals(xmpSeg !== undefined, true);
});

test('jpegMergeWriter deletes one XMP property and preserves other properties', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const seeded = jpegMergeWriter(original, {
    'XMP-dc:Title': 'Remove me',
    'XMP-dc:Description': 'Keep me',
  });
  const deleted = jpegMergeWriter(seeded.bytes, { 'XMP-dc:Title': null });
  const local = await jpegParser.parse(deleted.bytes, 'xmp-delete.jpg');
  assertEquals(local.tags.Title, undefined);
  assertEquals(local.tags.Description, 'Keep me');
  assertEquals(deleted.written, ['XMP-dc:Title']);
  assertEquals(deleted.skipped, []);

  const file = await tempFile('.jpg');
  try {
    await writeFile(file, deleted.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-dc:Title', '-XMP-dc:Description', file]);
    const upstream = JSON.parse(stdout)[0];
    assertEquals(upstream.Title, undefined);
    assertEquals(upstream.Description, 'Keep me');
  } finally {
    await rm(file, { force: true });
  }
  const sensitivityValues = [
    ['Unknown', 0],
    ['Standard Output Sensitivity', 1],
    ['Recommended Exposure Index', 2],
    ['ISO Speed', 3],
    ['Standard Output Sensitivity and Recommended Exposure Index', 4],
    ['Standard Output Sensitivity and ISO Speed', 5],
    ['Recommended Exposure Index and ISO Speed', 6],
    ['Standard Output Sensitivity, Recommended Exposure Index and ISO Speed', 7],
  ] as const;
  for (const [label, numeric] of sensitivityValues) {
    const enumResult = jpegMergeWriter(original, { 'ExifIFD:SensitivityType': label });
    assertEquals(enumResult.written, ['EXIF:SensitivityType']);
    const enumFile = await tempFile('.jpg');
    try {
      await writeFile(enumFile, enumResult.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-SensitivityType', enumFile]);
      assertEquals(JSON.parse(stdout)[0].SensitivityType, numeric);
    } finally {
      await rm(enumFile, { force: true });
    }
  }
});

test('jpegMergeWriter replaces and deletes COM comment segments', async () => {
  const original = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xfe, 0x00, 0x05, 0x6f, 0x6c, 0x64,
    0xff, 0xfe, 0x00, 0x05, 0x61, 0x67, 0x65,
    0xff, 0xd9,
  ]);
  const replaced = jpegMergeWriter(original, { Comment: 'new comment' });
  assertEquals(replaced.written, ['Comment']);
  assertEquals(replaced.skipped, []);
  const commentSegments = parseJpegSegments(replaced.bytes).filter((segment) => segment.marker === 0xfe);
  assertEquals(commentSegments.length, 1);
  assertEquals(
    new TextDecoder().decode(replaced.bytes.subarray(commentSegments[0]!.payloadStart, commentSegments[0]!.payloadEnd)),
    'new comment',
  );

  const deleted = jpegMergeWriter(replaced.bytes, { 'JPEG:Comment': null });
  assertEquals(parseJpegSegments(deleted.bytes).filter((segment) => segment.marker === 0xfe).length, 0);
});

test('jpegMergeWriter replaces multiple COM segments with a segmented empty-safe comment', () => {
  const original = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xfe, 0, 5, 0x6f, 0x6c, 0x64,
    0xff, 0xfe, 0, 5, 0x61, 0x67, 0x65,
    0xff, 0xd9,
  ]);
  const result = jpegMergeWriter(original, { Comment: 'x'.repeat(65_534) });
  const comments = parseJpegSegments(result.bytes).filter((segment) => segment.marker === 0xfe);
  assertEquals(comments.length, 2);
  assertEquals(comments[0]!.payloadEnd - comments[0]!.payloadStart, 65_533);
  assertEquals(comments[1]!.payloadEnd - comments[1]!.payloadStart, 1);
});

test('jpegMergeWriter matches ExifTool when deleting the last GPS data tag', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const oursFile = await tempFile('.jpg');
  const upstreamFile = await tempFile('.jpg');
  try {
    const created = jpegMergeWriter(original, { 'GPS:GPSDOP': 1.5 });
    const deleted = jpegMergeWriter(created.bytes, { 'GPS:GPSDOP': null });
    await writeFile(oursFile, deleted.bytes);
    await writeFile(upstreamFile, original);
    await execFileP(upstreamExifTool, ['-overwrite_original', '-GPS:GPSDOP=1.5', upstreamFile]);
    await execFileP(upstreamExifTool, ['-overwrite_original', '-GPS:GPSDOP=', upstreamFile]);
    const args = ['-j', '-GPS:GPSVersionID', '-GPS:GPSDOP'];
    const { stdout: oursJson } = await execFileP(upstreamExifTool, [...args, oursFile]);
    const { stdout: upstreamJson } = await execFileP(upstreamExifTool, [...args, upstreamFile]);
    const ours = JSON.parse(oursJson)[0];
    const upstream = JSON.parse(upstreamJson)[0];
    assertEquals(ours.GPSDOP, upstream.GPSDOP);
    assertEquals(ours.GPSVersionID, upstream.GPSVersionID);
  } finally {
    await rm(oursFile, { force: true });
    await rm(upstreamFile, { force: true });
  }
});

test('jpegMergeWriter matches ExifTool when deleting the last ordinary ExifIFD tag', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const exifSegments = parseJpegSegments(original).filter((segment) =>
    segment.marker === 0xe1 && new TextDecoder().decode(
      original.subarray(segment.payloadStart, segment.payloadStart + 6),
    ) === 'Exif\0\0',
  );
  const originalParts: Uint8Array[] = [original.subarray(0, 2)];
  let cursor = 2;
  for (const segment of exifSegments) {
    originalParts.push(original.subarray(cursor, segment.start));
    cursor = segment.end;
  }
  originalParts.push(original.subarray(cursor));
  const withoutExif = new Uint8Array(Buffer.concat(originalParts));
  const seeded = jpegMergeWriter(withoutExif, {
    'ExifIFD:DateTimeOriginal': '2026:10:14 12:34:56',
  });
  const deleted = jpegMergeWriter(seeded.bytes, { 'ExifIFD:DateTimeOriginal': null });
  const oursFile = await tempFile('.jpg');
  const upstreamFile = await tempFile('.jpg');
  try {
    await writeFile(oursFile, deleted.bytes);
    await writeFile(upstreamFile, seeded.bytes);
    await execFileP(upstreamExifTool, ['-overwrite_original', '-DateTimeOriginal=', upstreamFile]);
    const args = ['-j', '-n', '-ExifVersion', '-ComponentsConfiguration', '-ColorSpace', '-DateTimeOriginal'];
    const { stdout: oursJson } = await execFileP(upstreamExifTool, [...args, oursFile]);
    const { stdout: upstreamJson } = await execFileP(upstreamExifTool, [...args, upstreamFile]);
    const ours = JSON.parse(oursJson)[0];
    const upstream = JSON.parse(upstreamJson)[0];
    assertEquals(ours.DateTimeOriginal, upstream.DateTimeOriginal);
    assertEquals(ours.ExifVersion, upstream.ExifVersion);
    assertEquals(ours.ComponentsConfiguration, upstream.ComponentsConfiguration);
    assertEquals(ours.ColorSpace, upstream.ColorSpace);
  } finally {
    await rm(oursFile, { force: true });
    await rm(upstreamFile, { force: true });
  }
});

test('jpegMergeWriter stores oversized XMP using Adobe Extended XMP APP1 segments', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const description = 'x'.repeat(70_000);
  const result = jpegMergeWriter(original, { 'XMP-dc:Description': description });
  assertEquals(result.written, ['XMP-dc:Description']);
  assertEquals(result.skipped, []);
  const segments = parseJpegSegments(result.bytes).filter((segment) => segment.marker === 0xe1);
  const standardHeader = 'http://ns.adobe.com/xap/1.0/\0';
  const extensionHeader = 'http://ns.adobe.com/xmp/extension/\0';
  const startsWith = (segment: (typeof segments)[number], header: string) => {
    const bytes = new TextEncoder().encode(header);
    return bytes.every((byte, index) => result.bytes[segment.payloadStart + index] === byte);
  };
  const standard = segments.find((segment) => startsWith(segment, standardHeader));
  const extensions = segments.filter((segment) => startsWith(segment, extensionHeader));
  assertEquals(standard !== undefined, true);
  assertEquals(extensions.length > 1, true);
  assertEquals(segments.every((segment) => segment.end - segment.start - 2 <= 0xffff), true);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-dc:Description', file]);
    assertEquals(JSON.parse(stdout)[0].Description, description);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter inserts oversized XMP after an existing EXIF segment', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const segments = parseJpegSegments(original);
  const xmp = segments.find((segment) => segment.marker === 0xe1 && !payloadIsExif(original, segment))!;
  const stripped = new Uint8Array(original.length - (xmp.end - xmp.start));
  stripped.set(original.subarray(0, xmp.start));
  stripped.set(original.subarray(xmp.end), xmp.start);
  const result = jpegMergeWriter(stripped, { 'XMP-dc:Description': 'x'.repeat(70_000) });
  const outputSegments = parseJpegSegments(result.bytes);
  const exifIndex = outputSegments.findIndex((segment) => segment.marker === 0xe1 && payloadIsExif(result.bytes, segment));
  const xmpIndexes = outputSegments.flatMap((segment, index) =>
    segment.marker === 0xe1 && !payloadIsExif(result.bytes, segment) ? [index] : []
  );
  assertEquals(xmpIndexes[0], exifIndex + 1);
  assertEquals(xmpIndexes.length > 1, true);
});

test('jpegMergeWriter rejects EXIF payloads that exceed the APP1 segment limit', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  let message: string | undefined;
  try {
    jpegMergeWriter(original, { 'EXIF:ImageDescription': 'x'.repeat(70_000) });
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'APP1 segment exceeds 64 KiB JPEG limit');
});

test('jpegMergeWriter updates and deletes properties in existing Extended XMP packets', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const extended = jpegMergeWriter(original, {
    'XMP-dc:Description': 'x'.repeat(70_000),
    'XMP-dc:Title': 'Keep this title',
  });
  const updated = jpegMergeWriter(extended.bytes, { 'XMP-dc:Title': 'Updated title' });
  const updatedSegments = parseJpegSegments(updated.bytes).filter(
    (segment) => segment.marker === 0xe1,
  );
  const extensionHeader = new TextEncoder().encode('http://ns.adobe.com/xmp/extension/\0');
  const hasExtension = (segment: (typeof updatedSegments)[number]) =>
    extensionHeader.every((byte, index) => updated.bytes[segment.payloadStart + index] === byte);
  assertEquals(updatedSegments.some(hasExtension), true);

  const deleted = jpegMergeWriter(updated.bytes, { 'XMP-dc:Description': null });
  assertEquals(
    parseJpegSegments(deleted.bytes).filter((segment) =>
      segment.marker === 0xe1 && hasExtension(segment),
    ).length,
    0,
  );
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, deleted.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-dc:Description', '-XMP-dc:Title', file]);
    const metadata = JSON.parse(stdout)[0];
    assertEquals(metadata.Description, undefined);
    assertEquals(metadata.Title, 'Updated title');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter rejects corrupted Extended XMP chunks', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const extended = jpegMergeWriter(original, { 'XMP-dc:Description': 'x'.repeat(70_000) });
  const corrupted = extended.bytes.slice();
  const extensionHeader = new TextEncoder().encode('http://ns.adobe.com/xmp/extension/\0');
  const extension = parseJpegSegments(corrupted).find((segment) =>
    segment.marker === 0xe1 && extensionHeader.every(
      (byte, index) => corrupted[segment.payloadStart + index] === byte,
    ),
  );
  if (!extension) throw new Error('expected an Extended XMP APP1 segment');
  corrupted[extension.payloadEnd - 1] ^= 1;
  let message: string | undefined;
  try {
    jpegMergeWriter(corrupted, { 'XMP-dc:Title': 'replacement' });
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'Extended XMP packet does not match its MD5 GUID');
});

test('jpegMergeWriter rejects malformed Extended XMP pointers and chunks', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const extended = jpegMergeWriter(original, { 'XMP-dc:Description': 'x'.repeat(70_000) });
  const segments = parseJpegSegments(extended.bytes);
  const standard = segments.find((segment) => segment.marker === 0xe1 && !payloadIsExif(extended.bytes, segment))!;
  const extensionHeader = new TextEncoder().encode('http://ns.adobe.com/xmp/extension/\0');
  const extensions = segments.filter((segment) => segment.marker === 0xe1 &&
    extensionHeader.every((byte, index) => extended.bytes[segment.payloadStart + index] === byte));
  const standardPayload = extended.bytes.slice(standard.payloadStart, standard.payloadEnd);
  const extensionPayloads = extensions.map((segment) =>
    extended.bytes.slice(segment.payloadStart, segment.payloadEnd)
  );
  const assemble = (includeStandard: boolean, payloads: Uint8Array[]) => {
    const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
    const append = (payload: Uint8Array) => {
      const length = payload.length + 2;
      parts.push(new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff]), payload);
    };
    if (includeStandard) append(standardPayload);
    for (const payload of payloads) append(payload);
    parts.push(new Uint8Array([0xff, 0xd9]));
    return new Uint8Array(Buffer.concat(parts));
  };
  const rejectsUpdate = (bytes: Uint8Array) => {
    let error: unknown;
    try {
      jpegMergeWriter(bytes, { 'XMP-dc:Title': 'replacement' });
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof UnsupportedFormatError, true);
  };

  rejectsUpdate(assemble(false, extensionPayloads));
  rejectsUpdate(assemble(true, []));

  const missingPointer = standardPayload.slice();
  const pointerText = new TextEncoder().encode('xmpNote:HasExtendedXMP');
  const pointerOffset = missingPointer.findIndex((byte, index) =>
    pointerText.every((value, position) => missingPointer[index + position] === value)
  );
  if (pointerOffset < 0) throw new Error('expected the Extended XMP pointer');
  missingPointer[pointerOffset] = 0x7a;
  const pointerBytes = assemble(true, extensionPayloads);
  const standardSegment = parseJpegSegments(pointerBytes).find((segment) =>
    segment.marker === 0xe1 && !payloadIsExif(pointerBytes, segment)
  )!;
  pointerBytes.set(missingPointer, standardSegment.payloadStart);
  rejectsUpdate(pointerBytes);

  const wrongGuid = extensionPayloads.map((payload) => payload.slice());
  wrongGuid[0]![extensionHeader.length] ^= 1;
  rejectsUpdate(assemble(true, wrongGuid));

  const inconsistentLengths = extensionPayloads.map((payload) => payload.slice());
  inconsistentLengths[0]![extensionHeader.length + 32] ^= 1;
  rejectsUpdate(assemble(true, inconsistentLengths));

  const overlapping = extensionPayloads.map((payload) => payload.slice());
  overlapping[0]![extensionHeader.length + 39] = 1;
  rejectsUpdate(assemble(true, overlapping));

  const truncated = extensionPayloads[0]!.subarray(0, extensionHeader.length + 32 + 7);
  rejectsUpdate(assemble(true, [truncated]));
});

test('jpegMergeWriter handles invalid resource requests and empty comments', () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const result = jpegMergeWriter(bare, {
    'JPEG:Comment': 42,
    'JFIF:XResolution': 0x1_0000,
    ICC_Profile: 'not bytes',
    'Photoshop:NotAResource': 'value',
    'Ducky:Comment': 42,
  });
  assertEquals(result.bytes, bare);
  assertEquals(result.written, []);
  assertEquals(result.skipped, [
    'JPEG:Comment', 'JFIF:XResolution', 'ICC_Profile', 'Photoshop:NotAResource', 'Ducky:Comment',
  ]);

  const emptyComment = jpegMergeWriter(bare, { Comment: '' });
  const segment = parseJpegSegments(emptyComment.bytes).find((item) => item.marker === 0xfe)!;
  assertEquals(segment.payloadEnd - segment.payloadStart, 0);
});

test('jpegMergeWriter writes enum-backed EXIF fields and unqualified Interop tags', () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const result = jpegMergeWriter(bare, {
    'ExifIFD:FileSource': '3',
    'ExifIFD:SceneType': 3,
    InteropIndex: 'R98',
  });
  assertEquals(result.skipped, []);
  assertEquals(result.written.includes('EXIF:InteropIndex'), true);
  assertEquals(resolveMergeRequests({ InteropIndex: 'R98' }).exif[0]?.home, 0xa005);
  const exif = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const raw = parseRawTiff(result.bytes.subarray(exif.payloadStart + 6, exif.payloadEnd))!;
  const exifIfd = raw.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  assertEquals(exifIfd.entries.some((entry) => entry.tag === 0xA300), true);
  assertEquals(exifIfd.entries.some((entry) => entry.tag === 0xA301), true);
});

test('jpegMergeWriter rejects Ducky APP12 blocks over the segment limit', () => {
  let message = '';
  try {
    jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      'Ducky:Comment': 'x'.repeat(32_764),
    });
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'Ducky APP12 segment exceeds 65,533 bytes');
});

test('vendored ExifTool reads JPEG comments written by the merger', async () => {
  const file = await tempFile('.jpg');
  try {
    const original = new Uint8Array(readFileSync('assets/01.jpg'));
    const result = jpegMergeWriter(original, { Comment: 'JPEG comment parity' });
    const local = await jpegParser.parse(result.bytes, 'comment.jpg');
    assertEquals(local.tags.Comment, 'JPEG comment parity');
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Comment', file]);
    assertEquals(JSON.parse(stdout)[0].Comment, 'JPEG comment parity');
  } finally {
    await rm(file, { force: true });
  }
});

test('mergeExifTiff writes big-endian (MM) TIFF structures', () => {
  // Hand-built MM TIFF: IFD0 with Make (ASCII offset) + Orientation (inline SHORT).
  const make = new TextEncoder().encode('TestCo\0');
  const tiff = new Uint8Array(8 + 2 + 2 * 12 + 4 + make.length);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x4d; tiff[1] = 0x4d; // 'MM'
  dv.setUint16(2, 0x2a, false);
  dv.setUint32(4, 8, false);
  dv.setUint16(8, 2, false);
  const valueArea = 8 + 2 + 2 * 12 + 4;
  dv.setUint16(10, 0x010f, false); dv.setUint16(12, 2, false); dv.setUint32(14, 7, false); dv.setUint32(18, valueArea, false);
  dv.setUint16(22, 0x0112, false); dv.setUint16(24, 3, false); dv.setUint32(26, 1, false);
  tiff.set([0, 6], 30); // Orientation 6 inline (big-endian SHORT)
  tiff.set(make, valueArea);

  const merged = mergeExifTiff(tiff, [
    { key: 'EXIF:Orientation', spec: { id: 0x0112, type: 3, name: 'Orientation' }, value: 1, home: 0 },
    { key: 'EXIF:Make', spec: { id: 0x010f, type: 2, name: 'Make' }, value: 'Other\0'.slice(0, 6), home: 0 },
  ]);
  const dv2 = new DataView(merged.bytes.buffer);
  assertEquals(merged.bytes[0], 0x4d);
  // Make value re-encoded big-endian-safe (ASCII is endian-neutral).
  assertEquals(merged.written, ['EXIF:Orientation', 'EXIF:Make']);
  // Orientation now 1 as inline BE SHORT.
  assertEquals(dv2.getUint16(10 + 12 + 8, false), 1);
});

test('reverse parity: reference exiftool sees the same 4 values we write', async () => {
  let exiftoolAvailable = false;
  try {
    await execFileP('exiftool', ['-ver']);
    exiftoolAvailable = true;
  } catch {
    /* not installed */
  }
  if (!exiftoolAvailable) {
    console.log('reverse parity skipped (exiftool not installed)');
    return;
  }
  const { writeFile, readFile, rm } = await import('node:fs/promises');
  const { tempFile } = await import('../test/tmp.js');
  const tags = {
    Copyright: 'Copyright 2026 Reverse Check',
    Orientation: 1,
    Rights: 'Reverse rights',
    WebStatement: 'https://example.com/reverse',
  };
  // 1. We write, real exiftool reads.
  const ours = await tempFile('.jpg');
  try {
    await writeFile(ours, readFileSync('assets/01.jpg'));
    const out = jpegMergeWriter(new Uint8Array(readFileSync('assets/01.jpg')), tags);
    await writeFile(ours, out.bytes);
    const { stdout: oursJson } = await execFileP('exiftool', ['-j', '-G1', '-a', ours]);
    const oursView = JSON.parse(oursJson)[0];
    assertEquals(oursView['IFD0:Copyright'], 'Copyright 2026 Reverse Check');
    assertEquals(oursView['XMP-dc:Rights'], 'Reverse rights');
    assertEquals(oursView['XMP-xmpRights:WebStatement'], 'https://example.com/reverse');
  } finally {
    await rm(ours, { force: true });
  }
  // 2. Real exiftool writes the same tags, we read.
  const theirs = await tempFile('.jpg');
  try {
    await writeFile(theirs, readFileSync('assets/01.jpg'));
    await execFileP('exiftool', [
      '-overwrite_original', '-q',
      `-XMP-dc:Rights=${tags.Rights}`,
      `-XMP-xmpRights:WebStatement=${tags.WebStatement}`,
      `-EXIF:Copyright=${tags.Copyright}`,
      '-EXIF:Orientation#=1',
      theirs,
    ]);
    const info = await new (await import('../exiftool.js')).ExifTool().read(theirs);
    assertEquals(info.tags.Copyright, 'Copyright 2026 Reverse Check');
    assertEquals(info.tags.Rights, 'Reverse rights');
    assertEquals(info.tags.WebStatement, 'https://example.com/reverse');
  } finally {
    await rm(theirs, { force: true });
  }
});

test('resolver: non-string XMP values, unknown keys, and generic EXIF tags', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const bad = jpegMergeWriter(original, { Rights: 42, WebStatement: 7, Bogus: 1 });
  assertEquals(bad.skipped.sort(), ['Bogus', 'Rights', 'WebStatement']);
  const generic = jpegMergeWriter(original, { 'EXIF:Make': 'Rewritten' });
  assertEquals(generic.written, ['EXIF:Make']);
  const exifSeg = parseJpegSegments(generic.bytes).find((s) => s.marker === 0xe1)!;
  const tags = extractExifFromTiff(generic.bytes.subarray(exifSeg.payloadStart + 6, exifSeg.payloadEnd));
  assertEquals(tags.Make, 'Rewritten');
  // Missing GPS IFDs are created when GPS tags are first written.
  const sub = jpegMergeWriter(original, {
    'EXIF:DateTimeOriginal': '2024:01:02 03:04:05',
    'EXIF:GPSLatitude': [43, 1, 0],
    'EXIF:GPSLatitudeRef': 'N',
  });
  assertEquals(sub.written, ['EXIF:DateTimeOriginal', 'EXIF:GPSLatitude', 'EXIF:GPSLatitudeRef']);
  assertEquals(sub.skipped, []);
  const gps = extractExifFromTiff(
    sub.bytes.subarray(
      parseJpegSegments(sub.bytes).find((s) => s.marker === 0xe1)!.payloadStart + 6,
      parseJpegSegments(sub.bytes).find((s) => s.marker === 0xe1)!.payloadEnd,
    ),
  );
  assertEquals(gps.GPSLatitude !== undefined, true);
  assertEquals(gps.GPSLatitudeRef, 'North');
  // Unencodable value -> skipped, no throw.
  const unencodable = jpegMergeWriter(original, { Orientation: 'not-a-number' });
  assertEquals(unencodable.skipped, ['EXIF:Orientation']);
});

test('jpegMergeWriter routes explicit EXIF IFD groups', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'IFD0:Make': 'GroupTest',
    'ExifIFD:DateTimeOriginal': '2021:02:03 04:05:06',
    'GPS:GPSMapDatum': 'WGS-84',
    'IFD0:DateTimeOriginal': 'wrong group',
  });
  assertEquals(result.written, [
    'EXIF:Make', 'EXIF:DateTimeOriginal', 'EXIF:GPSMapDatum',
  ]);
  assertEquals(result.skipped, ['IFD0:DateTimeOriginal']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-G1', '-Make', '-DateTimeOriginal', '-GPSMapDatum', file,
    ]);
    assertEquals(/\[IFD0\]\s+Make\s+: GroupTest/.test(stdout), true);
    assertEquals(/\[ExifIFD\]\s+Date\/Time Original\s+: 2021:02:03 04:05:06/.test(stdout), true);
    assertEquals(stdout.includes('[GPS]'), true);
    assertEquals(stdout.includes('GPS Map Datum'), true);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter routes explicit InteropIFD tags through ExifIFD', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'InteropIFD:InteropIndex': 'R98' });
  assertEquals(result.written, ['EXIF:InteropIndex', 'InteropVersion']);
  assertEquals(result.skipped, []);
  const mismatched = jpegMergeWriter(original, {
    'ExifIFD:InteropIndex': 'R98',
    'InteropIFD:DateTimeOriginal': '2026:10:14 12:34:56',
  });
  assertEquals(mismatched.written, []);
  assertEquals(mismatched.skipped, ['ExifIFD:InteropIndex', 'InteropIFD:DateTimeOriginal']);
  assertEquals(Array.from(mismatched.bytes), Array.from(original));
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-InteropIndex', '-InteropVersion', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.InteropIndex, 'R98 - DCF basic file (sRGB)');
    assertEquals(tags.InteropVersion, '0100');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts the ExifTool FocalLength mm suffix', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:FocalLength': '50 mm' });
  assertEquals(result.written, ['EXIF:FocalLength']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-n', '-FocalLength', file]);
    assertEquals(stdout.trim().split(':').at(-1)?.trim(), '50');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts the ExifTool GPSHPositioningError m suffix', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'GPS:GPSHPositioningError': '5 m' });
  assertEquals(result.written, ['EXIF:GPSHPositioningError']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-n', '-GPSHPositioningError', file]);
    assertEquals(stdout.trim().split(':').at(-1)?.trim(), '5');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter applies ExifTool text headers to GPS undefined text', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'GPS:GPSProcessingMethod': 'GPS',
    'GPS:GPSAreaInformation': 'München',
  });
  assertEquals(result.written, ['EXIF:GPSProcessingMethod', 'EXIF:GPSAreaInformation']);
  const exif = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(result.bytes.subarray(exif.payloadStart + 6, exif.payloadEnd))!;
  const gps = tiff.ifd0.entries.find((entry) => entry.tag === 0x8825)!.sub!;
  const processingMethod = gps.entries.find((entry) => entry.tag === 0x001b)!.data!;
  const areaInformation = gps.entries.find((entry) => entry.tag === 0x001c)!.data!;
  assertEquals(Buffer.compare(Buffer.from(processingMethod), Buffer.from('ASCII\0\0\0GPS')), 0);
  assertEquals(Buffer.compare(
    Buffer.from(areaInformation),
    Buffer.from([
      0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0,
      0x4d, 0, 0xfc, 0, 0x6e, 0, 0x63, 0, 0x68, 0, 0x65, 0, 0x6e, 0,
    ]),
  ), 0);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-G1', '-GPSProcessingMethod', '-GPSAreaInformation', file,
    ]);
    assertEquals(stdout.includes('[GPS]'), true);
    assertEquals(stdout.includes('GPS Processing Method'), true);
    assertEquals(stdout.includes('München'), true);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter encodes Unicode UserComment as EXIF UTF-16 text', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:UserComment': 'München' });
  assertEquals(result.written, ['EXIF:UserComment']);
  assertEquals(result.skipped, []);
  const exifSegment = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(result.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd))!;
  const exifIfd = tiff.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  const bytes = exifIfd.entries.find((entry) => entry.tag === 0x9286)!.data!;
  assertEquals(Buffer.compare(Buffer.from(bytes.subarray(0, 8)), Buffer.from('UNICODE\0')), 0);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-UserComment', file]);
    assertEquals(JSON.parse(stdout)[0].UserComment, 'München');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts ExifTool SubjectDistance in meters', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:SubjectDistance': '3.5 m' });
  assertEquals(result.written, ['EXIF:SubjectDistance']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-n', '-SubjectDistance', file]);
    assertEquals(Number(stdout.match(/Subject Distance\s*:\s*([\d.]+)/)?.[1]), 3.5);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes rational ExposureIndex', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ExposureIndex': 100 });
  assertEquals(result.written, ['EXIF:ExposureIndex']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ExposureIndex', file]);
    assertEquals(JSON.parse(stdout)[0].ExposureIndex, 100);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes the ExifIFD 0xA436 string tags', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values: Record<string, string> = {
    ImageTitle: 'Title value',
    Photographer: 'Photographer value',
    ImageEditor: 'Editor value',
    CameraFirmware: 'Firmware value',
    RAWDevelopingSoftware: 'RAW software value',
    ImageEditingSoftware: 'Image software value',
    MetadataEditingSoftware: 'Metadata software value',
  };
  const result = jpegMergeWriter(original, Object.fromEntries(
    Object.entries(values).map(([tag, value]) => [`ExifIFD:${tag}`, value]),
  ));
  assertEquals(result.written, Object.keys(values).map((tag) => `EXIF:${tag}`));
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', ...Object.keys(values).flatMap((tag) => [`-${tag}`]), file,
    ]);
    assertEquals(JSON.parse(stdout)[0], { SourceFile: file, ...values });
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter stores ExifImageWidth as an EXIF SHORT', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ExifImageWidth': 4000 });
  assertEquals(result.written, ['EXIF:ExifImageWidth']);
  const exifSegment = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(result.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd))!;
  const exifIfd = tiff.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  assertEquals(exifIfd.entries.find((entry) => entry.tag === 0xA002)!.type, 3);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ExifImageWidth', file]);
    assertEquals(Number(JSON.parse(stdout)[0].ExifImageWidth), 4000);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter stores ExifImageHeight as an EXIF SHORT', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ExifImageHeight': 3000 });
  const exifSegment = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(result.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd))!;
  const exifIfd = tiff.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  assertEquals(exifIfd.entries.find((entry) => entry.tag === 0xA003)!.type, 3);
});

test('jpegMergeWriter writes GPS destination bearing and distance tags', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'GPS:GPSDestBearingRef': 'True North',
    'GPS:GPSDestBearing': 135.5,
    'GPS:GPSDestDistanceRef': 'Kilometers',
    'GPS:GPSDestDistance': 12.5,
  });
  assertEquals(result.written, [
    'EXIF:GPSDestBearingRef', 'EXIF:GPSDestBearing',
    'EXIF:GPSDestDistanceRef', 'EXIF:GPSDestDistance',
  ]);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-n', '-GPS:GPSDestBearingRef', '-GPS:GPSDestBearing',
      '-GPS:GPSDestDistanceRef', '-GPS:GPSDestDistance', file,
    ]);
    assertEquals(/GPS Dest Bearing Ref\s+: T/.test(stdout), true);
    assertEquals(/GPS Dest Bearing\s+: 135\.5/.test(stdout), true);
    assertEquals(/GPS Dest Distance Ref\s+: K/.test(stdout), true);
    assertEquals(/GPS Dest Distance\s+: 12\.5/.test(stdout), true);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter converts ApertureValue and ShutterSpeedValue into APEX', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:ApertureValue': 2.8,
    'ExifIFD:ShutterSpeedValue': '1/32',
  });
  assertEquals(result.written, ['EXIF:ApertureValue', 'EXIF:ShutterSpeedValue']);
  const exifSegment = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(result.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd))!;
  const exifIfd = tiff.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  const apertureData = exifIfd.entries.find((entry) => entry.tag === 0x9202)!.data!;
  const shutterData = exifIfd.entries.find((entry) => entry.tag === 0x9201)!.data!;
  const apertureView = new DataView(apertureData.buffer, apertureData.byteOffset, apertureData.byteLength);
  const shutterView = new DataView(shutterData.buffer, shutterData.byteOffset, shutterData.byteLength);
  assertEquals(Math.abs(apertureView.getUint32(0, true) / apertureView.getUint32(4, true) - 2 * Math.log2(2.8)) < 0.002, true);
  assertEquals(shutterView.getInt32(0, true) / shutterView.getInt32(4, true), 5);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-ApertureValue', '-ShutterSpeedValue', file,
    ]);
    assertEquals(/Aperture Value\s*:\s*2\.8/.test(stdout), true);
    assertEquals(/Shutter Speed Value\s*:\s*1\/32/.test(stdout), true);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter converts MaxApertureValue to APEX', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:MaxApertureValue': 4 });
  assertEquals(result.written, ['EXIF:MaxApertureValue']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-MaxApertureValue', file]);
    assertEquals(Number(JSON.parse(stdout)[0].MaxApertureValue), 2 * Math.log2(4));
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter maps nonpositive aperture values to APEX zero', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:ApertureValue': -1,
    'ExifIFD:MaxApertureValue': -1,
  });
  assertEquals(result.written, ['EXIF:ApertureValue', 'EXIF:MaxApertureValue']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-ApertureValue', '-MaxApertureValue', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ApertureValue, 1);
    assertEquals(tags.MaxApertureValue, 1);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts zero aperture as a finite APEX value', () => {
  const result = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'ExifIFD:ApertureValue': 0,
  });
  assertEquals(result.written, ['EXIF:ApertureValue']);
  assertEquals(result.skipped, []);
});

test('jpegMergeWriter writes signed-rational BrightnessValue', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:BrightnessValue': [-1, 3] });
  assertEquals(result.written, ['EXIF:BrightnessValue']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-BrightnessValue', file]);
    assertEquals(Math.abs(Number(JSON.parse(stdout)[0].BrightnessValue) + 1 / 3) < 1e-6, true);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter converts GPS reference and mode PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'GPS:GPSStatus': 'Measurement Active',
    'GPS:GPSMeasureMode': '3-Dimensional Measurement',
    'GPS:GPSSpeedRef': 'km/h',
    'GPS:GPSTrackRef': 'True North',
    'GPS:GPSImgDirectionRef': 'Magnetic North',
  });
  assertEquals(result.written, [
    'EXIF:GPSStatus', 'EXIF:GPSMeasureMode', 'EXIF:GPSSpeedRef',
    'EXIF:GPSTrackRef', 'EXIF:GPSImgDirectionRef',
  ]);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-n', '-GPSStatus', '-GPSMeasureMode', '-GPSSpeedRef', '-GPSTrackRef',
      '-GPSImgDirectionRef', file,
    ]);
    assertEquals(/GPS Status\s+: A/.test(stdout), true);
    assertEquals(/GPS Measure Mode\s+: 3/.test(stdout), true);
    assertEquals(/GPS Speed Ref\s+: K/.test(stdout), true);
    assertEquals(/GPS Track Ref\s+: T/.test(stdout), true);
    assertEquals(/GPS Img Direction Ref\s+: M/.test(stdout), true);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter normalizes EXIF version PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:ExifVersion': '2.31',
    'ExifIFD:FlashpixVersion': '0100',
  });
  assertEquals(result.written, ['EXIF:ExifVersion', 'EXIF:FlashpixVersion']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-ExifVersion', '-FlashpixVersion', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ExifVersion, '0231');
    assertEquals(tags.FlashpixVersion, '0100');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts ExifTool Orientation PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['Horizontal (normal)', 1],
    ['Mirror horizontal', 2],
    ['Rotate 180', 3],
    ['Mirror vertical', 4],
    ['Mirror horizontal and rotate 270 CW', 5],
    ['Rotate 90 CW', 6],
    ['Mirror horizontal and rotate 90 CW', 7],
    ['Rotate 270 CW', 8],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'EXIF:Orientation': label });
    assertEquals(result.written, ['EXIF:Orientation']);
    assertEquals(result.skipped, []);
    const info = await jpegParser.parse(result.bytes, 'orientation.jpg');
    assertEquals(info.tags.Orientation, label);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-Orientation', file]);
      assertEquals(stdout.trim().split(':').at(-1)?.trim(), String(numeric));
    } finally {
      await rm(file, { force: true });
    }
  }
  const prefix = jpegMergeWriter(original, { 'EXIF:Orientation': 'Rotate 90' });
  assertEquals(prefix.written, ['EXIF:Orientation']);
  const ambiguous = jpegMergeWriter(original, { 'EXIF:Orientation': 'Rotate' });
  assertEquals(ambiguous.skipped, ['EXIF:Orientation']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, prefix.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-n', '-Orientation', file]);
    assertEquals(stdout.trim().split(':').at(-1)?.trim(), '6');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts the EXIF 3.0 GPSAltitudeRef sea-level values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['Above Sea Level', 0],
    ['Below Sea Level', 1],
    ['Positive Sea Level (sea-level ref)', 2],
    ['Negative Sea Level (sea-level ref)', 3],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'GPS:GPSAltitudeRef': label });
    assertEquals(result.written, ['EXIF:GPSAltitudeRef']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-GPSAltitudeRef', file]);
      assertEquals(Number(stdout.match(/GPS Altitude Ref\s*:\s*(\d+)/)?.[1]), numeric);
    } finally {
      await rm(file, { force: true });
    }
  }
});

test('jpegMergeWriter accepts ExifTool ExposureProgram PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['Not Defined', 0],
    ['Manual', 1],
    ['Program AE', 2],
    ['Aperture-priority AE', 3],
    ['Shutter speed priority AE', 4],
    ['Creative (Slow speed)', 5],
    ['Action (High speed)', 6],
    ['Portrait', 7],
    ['Landscape', 8],
    ['Bulb', 9],
  ] as const;
  let result = jpegMergeWriter(original, {});
  for (const [label, numeric] of values) {
    result = jpegMergeWriter(original, { 'EXIF:ExposureProgram': label });
    assertEquals(result.written, ['EXIF:ExposureProgram']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-ExposureProgram', file]);
      assertEquals(stdout.trim().split(':').at(-1)?.trim(), String(numeric));
    } finally {
      await rm(file, { force: true });
    }
  }
  const prefix = jpegMergeWriter(original, { 'EXIF:ExposureProgram': 'Aperture-priority' });
  assertEquals(prefix.written, ['EXIF:ExposureProgram']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, prefix.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-n', '-ExposureProgram', file]);
    assertEquals(stdout.trim().split(':').at(-1)?.trim(), '3');
  } finally {
    await rm(file, { force: true });
  }
  const ambiguous = jpegMergeWriter(original, { 'EXIF:ExposureProgram': 'A' });
  assertEquals(ambiguous.skipped, ['EXIF:ExposureProgram']);
});

test('jpegMergeWriter forwards # raw enum values without PrintConv', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ExposureProgram#': '1' });
  assertEquals(result.written, ['ExifIFD:ExposureProgram#']);
  assertEquals(result.skipped, []);
  const rawLabel = jpegMergeWriter(original, { 'ExifIFD:ExposureProgram#': 'Manual' });
  assertEquals(rawLabel.written, []);
  assertEquals(rawLabel.skipped, ['ExifIFD:ExposureProgram#']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ExifIFD:ExposureProgram', file]);
    assertEquals(JSON.parse(stdout)[0].ExposureProgram, 1);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts ExifTool Flash PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['No Flash', 0x00],
    ['Fired', 0x01],
    ['Fired, Return not detected', 0x05],
    ['Fired, Return detected', 0x07],
    ['On, Did not fire', 0x08],
    ['On, Fired', 0x09],
    ['On, Return not detected', 0x0d],
    ['On, Return detected', 0x0f],
    ['Off, Did not fire', 0x10],
    ['Off, Did not fire, Return not detected', 0x14],
    ['Auto, Did not fire', 0x18],
    ['Auto, Fired', 0x19],
    ['Auto, Fired, Return not detected', 0x1d],
    ['Auto, Fired, Return detected', 0x1f],
    ['No flash function', 0x20],
    ['Off, No flash function', 0x30],
    ['Fired, Red-eye reduction', 0x41],
    ['Fired, Red-eye reduction, Return not detected', 0x45],
    ['Fired, Red-eye reduction, Return detected', 0x47],
    ['On, Red-eye reduction', 0x49],
    ['On, Red-eye reduction, Return not detected', 0x4d],
    ['On, Red-eye reduction, Return detected', 0x4f],
    ['Off, Red-eye reduction', 0x50],
    ['Auto, Did not fire, Red-eye reduction', 0x58],
    ['Auto, Fired, Red-eye reduction', 0x59],
    ['Auto, Fired, Red-eye reduction, Return not detected', 0x5d],
    ['Auto, Fired, Red-eye reduction, Return detected', 0x5f],
    ['On', 0x01],
    ['Off', 0x00],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'ExifIFD:Flash': label });
    assertEquals(result.written, ['EXIF:Flash']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-Flash', file]);
      assertEquals(Number(stdout.match(/Flash\s*:\s*(\d+)/)?.[1]), numeric);
    } finally {
      await rm(file, { force: true });
    }
  }
  assertEquals(jpegMergeWriter(original, { 'ExifIFD:Flash': 'not-a-flash-value' }).skipped, ['EXIF:Flash']);
});

test('jpegMergeWriter accepts ExifTool LightSource PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['Unknown', 0],
    ['Daylight', 1],
    ['Fluorescent', 2],
    ['Tungsten (Incandescent)', 3],
    ['Flash', 4],
    ['Fine Weather', 9],
    ['Cloudy', 10],
    ['Shade', 11],
    ['Daylight Fluorescent', 12],
    ['Day White Fluorescent', 13],
    ['Cool White Fluorescent', 14],
    ['White Fluorescent', 15],
    ['Warm White Fluorescent', 16],
    ['Standard Light A', 17],
    ['Standard Light B', 18],
    ['Standard Light C', 19],
    ['D55', 20],
    ['D65', 21],
    ['D75', 22],
    ['D50', 23],
    ['ISO Studio Tungsten', 24],
    ['Other', 255],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'ExifIFD:LightSource': label });
    assertEquals(result.written, ['EXIF:LightSource']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-LightSource', file]);
      assertEquals(Number(stdout.match(/Light Source\s*:\s*(\d+)/)?.[1]), numeric);
    } finally {
      await rm(file, { force: true });
    }
  }
});

test('jpegMergeWriter writes the fixed-count SubjectLocation SHORT array', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:SubjectLocation': [100, 200],
    'IFD0:PageNumber': [2, 5],
  });
  assertEquals(result.written, ['EXIF:SubjectLocation', 'EXIF:PageNumber']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-SubjectLocation', '-PageNumber', file,
    ]);
    assertEquals(JSON.parse(stdout)[0].SubjectLocation, '100 200');
    assertEquals(JSON.parse(stdout)[0].PageNumber, '2 5');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes ExifTool RelatedSoundFile', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:RelatedSoundFile': 'voice.wav' });
  assertEquals(result.written, ['EXIF:RelatedSoundFile']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-RelatedSoundFile', file]);
    assertEquals(JSON.parse(stdout)[0].RelatedSoundFile, 'voice.wav');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes ExifTool ImageUniqueID', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ImageUniqueID': 'unique-id-123' });
  assertEquals(result.written, ['EXIF:ImageUniqueID']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-ImageUniqueID', file]);
    assertEquals(stdout.trim().split(':').at(-1)?.trim(), 'unique-id-123');
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter encodes FileSource and SceneType byte values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['FileSource', 'Film Scanner', 1],
    ['FileSource', 'Reflection Print Scanner', 2],
    ['FileSource', 'Digital Camera', 3],
    ['SceneType', 'Directly photographed', 1],
  ] as const;
  for (const [tag, label, numeric] of values) {
    const result = jpegMergeWriter(original, { [`ExifIFD:${tag}`]: label });
    assertEquals(result.written, [`EXIF:${tag}`]);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', `-${tag}`, file]);
      assertEquals(JSON.parse(stdout)[0][tag], numeric);
    } finally {
      await rm(file, { force: true });
    }
  }
  const sigma = jpegMergeWriter(original, { 'ExifIFD:FileSource': 'Sigma Digital Camera' });
  const exifSegment = parseJpegSegments(sigma.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(sigma.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd))!;
  const exifIfd = tiff.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  const fileSource = exifIfd.entries.find((entry) => entry.tag === 0xA300)!.raw4!;
  assertEquals(Buffer.compare(Buffer.from(fileSource), Buffer.from([3, 0, 0, 0])), 0);
});

test('jpegMergeWriter accepts ExifTool scalar enum values in the 0xA401 range', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values: Array<[string, string, number]> = [
    ['CustomRendered', 'Normal', 0],
    ['CustomRendered', 'Custom', 1],
    ['CustomRendered', 'HDR (no original saved)', 2],
    ['CustomRendered', 'HDR (original saved)', 3],
    ['CustomRendered', 'Original (for HDR)', 4],
    ['CustomRendered', 'Panorama', 6],
    ['CustomRendered', 'Portrait HDR', 7],
    ['CustomRendered', 'Portrait', 8],
    ['ExposureMode', 'Auto', 0],
    ['ExposureMode', 'Manual', 1],
    ['ExposureMode', 'Auto bracket', 2],
    ['WhiteBalance', 'Auto', 0],
    ['WhiteBalance', 'Manual', 1],
    ['SceneCaptureType', 'Standard', 0],
    ['SceneCaptureType', 'Landscape', 1],
    ['SceneCaptureType', 'Portrait', 2],
    ['SceneCaptureType', 'Night', 3],
    ['SceneCaptureType', 'Other', 4],
    ['GainControl', 'None', 0],
    ['GainControl', 'Low gain up', 1],
    ['GainControl', 'High gain up', 2],
    ['GainControl', 'Low gain down', 3],
    ['GainControl', 'High gain down', 4],
    ['Contrast', 'Normal', 0],
    ['Contrast', 'Low', 1],
    ['Contrast', 'High', 2],
    ['Saturation', 'Normal', 0],
    ['Saturation', 'Low', 1],
    ['Saturation', 'High', 2],
    ['Sharpness', 'Normal', 0],
    ['Sharpness', 'Soft', 1],
    ['Sharpness', 'Hard', 2],
    ['SubjectDistanceRange', 'Unknown', 0],
    ['SubjectDistanceRange', 'Macro', 1],
    ['SubjectDistanceRange', 'Close', 2],
    ['SubjectDistanceRange', 'Distant', 3],
  ];
  for (const [tag, label, numeric] of values) {
    const result = jpegMergeWriter(original, { [`ExifIFD:${tag}`]: label });
    assertEquals(result.written, [`EXIF:${tag}`]);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', `-${tag}`, file]);
      assertEquals(Number(JSON.parse(stdout)[0][tag]), numeric);
    } finally {
      await rm(file, { force: true });
    }
  }
});

test('jpegMergeWriter writes SubjectArea with its variable count', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:SubjectArea': [100, 200, 300],
    'ExifIFD:SubjectLocation': [400, 500],
  });
  assertEquals(result.written, ['EXIF:SubjectArea', 'EXIF:SubjectLocation']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-SubjectArea', '-SubjectLocation', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.SubjectArea, '100 200 300');
    assertEquals(tags.SubjectLocation, '400 500');
  } finally {
    await rm(file, { force: true });
  }
  assertEquals(jpegMergeWriter(original, { 'ExifIFD:SubjectArea': [100] }).skipped, ['EXIF:SubjectArea']);
  assertEquals(jpegMergeWriter(original, { 'ExifIFD:SubjectArea': [100, 200, 300, 400, 500] }).skipped, ['EXIF:SubjectArea']);
});

test('jpegMergeWriter writes the non-enum scalar fields in the 0xA401 range', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:FocalLengthIn35mmFormat': '35 mm',
    'ExifIFD:DigitalZoomRatio': 2.5,
  });
  assertEquals(result.written, ['EXIF:FocalLengthIn35mmFormat', 'EXIF:DigitalZoomRatio']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-FocalLengthIn35mmFormat', '-DigitalZoomRatio', file,
    ]);
    const values = JSON.parse(stdout)[0];
    assertEquals(Number(values.FocalLengthIn35mmFormat), 35);
    assertEquals(Number(values.DigitalZoomRatio), 2.5);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter parses the ExifTool LensInfo display form', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:LensInfo': '24-70mm f/2.8-4' });
  assertEquals(result.written, ['EXIF:LensInfo']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-LensInfo', file]);
    assertEquals(JSON.parse(stdout)[0].LensInfo, '24 70 2.8 4');
  } finally {
    await rm(file, { force: true });
  }
  const shorthand = jpegMergeWriter(original, { 'ExifIFD:LensInfo': '50mm f/1.4' });
  assertEquals(shorthand.written, ['EXIF:LensInfo']);
  const shorthandFile = await tempFile('.jpg');
  try {
    await writeFile(shorthandFile, shorthand.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-LensInfo', shorthandFile]);
    assertEquals(JSON.parse(stdout)[0].LensInfo, '50 50 1.4 1.4');
  } finally {
    await rm(shorthandFile, { force: true });
  }
});

test('jpegMergeWriter writes EXIF 2.32 composite image tags', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:CompositeImage': 'General Composite Image',
    'ExifIFD:CompositeImageCount': [3, 2],
  });
  assertEquals(result.written, ['EXIF:CompositeImage', 'EXIF:CompositeImageCount']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-CompositeImage', '-CompositeImageCount', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.CompositeImage, 2);
    assertEquals(tags.CompositeImageCount, '3 2');
  } finally {
    await rm(file, { force: true });
  }
  const values = [
    ['Unknown', 0],
    ['Not a Composite Image', 1],
    ['General Composite Image', 2],
    ['Composite Image Captured While Shooting', 3],
  ] as const;
  for (const [label, numeric] of values) {
    const enumResult = jpegMergeWriter(original, { 'ExifIFD:CompositeImage': label });
    assertEquals(enumResult.written, ['EXIF:CompositeImage']);
    const enumFile = await tempFile('.jpg');
    try {
      await writeFile(enumFile, enumResult.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-CompositeImage', enumFile]);
      assertEquals(JSON.parse(stdout)[0].CompositeImage, numeric);
    } finally {
      await rm(enumFile, { force: true });
    }
  }
});

test('jpegMergeWriter writes EXIF 3.0 sensitivity tags', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'ExifIFD:SensitivityType': 'ISO Speed',
    'ExifIFD:StandardOutputSensitivity': 200,
    'ExifIFD:RecommendedExposureIndex': 400,
    'ExifIFD:ISOSpeed': 800,
    'ExifIFD:ISOSpeedLatitudeyyy': 1,
    'ExifIFD:ISOSpeedLatitudezzz': 2,
  });
  assertEquals(result.written, [
    'EXIF:SensitivityType', 'EXIF:StandardOutputSensitivity',
    'EXIF:RecommendedExposureIndex', 'EXIF:ISOSpeed',
    'EXIF:ISOSpeedLatitudeyyy', 'EXIF:ISOSpeedLatitudezzz',
  ]);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-SensitivityType', '-StandardOutputSensitivity',
      '-RecommendedExposureIndex', '-ISOSpeed', '-ISOSpeedLatitudeyyy',
      '-ISOSpeedLatitudezzz', file,
    ]);
    assertEquals(JSON.parse(stdout)[0], {
      SourceFile: file,
      SensitivityType: 3,
      StandardOutputSensitivity: 200,
      RecommendedExposureIndex: 400,
      ISOSpeed: 800,
      ISOSpeedLatitudeyyy: 1,
      ISOSpeedLatitudezzz: 2,
    });
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes one- and two-value signed TimeZoneOffset arrays', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  for (const [offsets, expected] of [[[-8], -8], [[-8, 2], '-8 2']] as const) {
    const result = jpegMergeWriter(original, { 'ExifIFD:TimeZoneOffset': [...offsets] });
    assertEquals(result.written, ['EXIF:TimeZoneOffset']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-TimeZoneOffset', file]);
      assertEquals(JSON.parse(stdout)[0].TimeZoneOffset, expected);
    } finally {
      await rm(file, { force: true });
    }
  }
  assertEquals(
    jpegMergeWriter(original, { 'ExifIFD:TimeZoneOffset': [-8, 2, 3] }).skipped,
    ['EXIF:TimeZoneOffset'],
  );
});

test('jpegMergeWriter writes variable-count ISO SHORT values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ISO': [100, 200] });
  assertEquals(result.written, ['EXIF:ISOSpeedRatings']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ISO', file]);
    assertEquals(JSON.parse(stdout)[0].ISO, '100 200');
  } finally {
    await rm(file, { force: true });
  }
  const stringResult = jpegMergeWriter(original, { 'ExifIFD:ISO': '100, 200' });
  assertEquals(stringResult.written, ['EXIF:ISOSpeedRatings']);
  const stringFile = await tempFile('.jpg');
  try {
    await writeFile(stringFile, stringResult.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ISO', stringFile]);
    assertEquals(JSON.parse(stdout)[0].ISO, '100 200');
  } finally {
    await rm(stringFile, { force: true });
  }
});

test('jpegMergeWriter writes ExifIFD SelfTimerMode', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:SelfTimerMode': 2 });
  assertEquals(result.written, ['EXIF:SelfTimerMode']);
  assertEquals(result.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-SelfTimerMode', file]);
    assertEquals(JSON.parse(stdout)[0].SelfTimerMode, 2);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter accepts ExifTool SensingMethod PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['Not defined', 1],
    ['One-chip color area', 2],
    ['Two-chip color area', 3],
    ['Three-chip color area', 4],
    ['Color sequential area', 5],
    ['Trilinear', 7],
    ['Color sequential linear', 8],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'ExifIFD:SensingMethod': label });
    assertEquals(result.written, ['EXIF:SensingMethod']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-SensingMethod', file]);
      assertEquals(JSON.parse(stdout)[0].SensingMethod, numeric);
    } finally {
      await rm(file, { force: true });
    }
  }
});

test('jpegMergeWriter accepts ExifTool MeteringMode PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['Unknown', 0],
    ['Average', 1],
    ['Center-weighted average', 2],
    ['Spot', 3],
    ['Multi-spot', 4],
    ['Multi-segment', 5],
    ['Partial', 6],
    ['Other', 255],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'EXIF:MeteringMode': label });
    assertEquals(result.written, ['EXIF:MeteringMode']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-MeteringMode', file]);
      assertEquals(stdout.trim().split(':').at(-1)?.trim(), String(numeric));
    } finally {
      await rm(file, { force: true });
    }
  }
  const prefix = jpegMergeWriter(original, { 'EXIF:MeteringMode': 'Center-weighted' });
  assertEquals(prefix.written, ['EXIF:MeteringMode']);
  const ambiguous = jpegMergeWriter(original, { 'EXIF:MeteringMode': 'M' });
  assertEquals(ambiguous.skipped, ['EXIF:MeteringMode']);
});

test('jpegMergeWriter accepts ExifTool ResolutionUnit PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [['None', 1], ['inches', 2], ['cm', 3]] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'EXIF:ResolutionUnit': label });
    assertEquals(result.written, ['EXIF:ResolutionUnit']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-ResolutionUnit', file]);
      assertEquals(stdout.trim().split(':').at(-1)?.trim(), String(numeric));
    } finally {
      await rm(file, { force: true });
    }
  }
  const prefix = jpegMergeWriter(original, { 'EXIF:ResolutionUnit': 'inch' });
  assertEquals(prefix.written, ['EXIF:ResolutionUnit']);
});

test('jpegMergeWriter accepts ExifTool ColorSpace PrintConv values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values = [
    ['sRGB', 1],
    ['Adobe RGB', 2],
    ['Uncalibrated', 0xFFFF],
    ['ICC Profile', 0xFFFE],
    ['Wide Gamut RGB', 0xFFFD],
  ] as const;
  for (const [label, numeric] of values) {
    const result = jpegMergeWriter(original, { 'EXIF:ColorSpace': label });
    assertEquals(result.written, ['EXIF:ColorSpace']);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', '-ColorSpace', file]);
      assertEquals(stdout.trim().split(':').at(-1)?.trim(), String(numeric));
    } finally {
      await rm(file, { force: true });
    }
  }
  const prefix = jpegMergeWriter(original, { 'EXIF:ColorSpace': 'Adobe' });
  assertEquals(prefix.written, ['EXIF:ColorSpace']);
});

test('jpegMergeWriter accepts ExifTool FocalPlaneResolutionUnit and GPSDifferential values', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const values: Array<[string, string, number]> = [
    ['FocalPlaneResolutionUnit', 'None', 1],
    ['FocalPlaneResolutionUnit', 'inches', 2],
    ['FocalPlaneResolutionUnit', 'cm', 3],
    ['FocalPlaneResolutionUnit', 'mm', 4],
    ['FocalPlaneResolutionUnit', 'um', 5],
    ['GPSDifferential', 'No Correction', 0],
    ['GPSDifferential', 'Differential Corrected', 1],
  ];
  for (const [name, label, numeric] of values) {
    const result = jpegMergeWriter(original, { [`EXIF:${name}`]: label });
    assertEquals(result.written, [`EXIF:${name}`]);
    assertEquals(result.skipped, []);
    const file = await tempFile('.jpg');
    try {
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-n', `-${name}`, file]);
      assertEquals(stdout.trim().split(':').at(-1)?.trim(), String(numeric));
    } finally {
      await rm(file, { force: true });
    }
  }
});

test('resolver: arbitrary properties in supported XMP namespaces', () => {
  const resolved = resolveMergeRequests({
    'XMP-photoshop:Credit': 'Agency',
    'XMP-Iptc4xmpCore:CiEmailWork': 'a@b.test',
  });
  assertEquals(resolved.xmp, [
    { name: 'photoshop:Credit', value: 'Agency' },
    { name: 'Iptc4xmpCore:CiEmailWork', value: 'a@b.test' },
  ]);
  assertEquals(resolved.skipped, []);
});

test('jpegMergeWriter deletes EXIF tags and removes an emptied optional IFD', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const before = extractExifFromTiff(
    original.subarray(
      parseJpegSegments(original).find((s) => s.marker === 0xe1)!.payloadStart + 6,
      parseJpegSegments(original).find((s) => s.marker === 0xe1)!.payloadEnd,
    ),
  );
  const out = jpegMergeWriter(original, { 'EXIF:DateTimeOriginal': null });
  assertEquals(out.written, ['EXIF:DateTimeOriginal']);
  assertEquals(out.skipped, []);
  const exifSegment = parseJpegSegments(out.bytes).find((s) => s.marker === 0xe1)!;
  const after = extractExifFromTiff(out.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd));
  assertEquals(after.DateTimeOriginal, undefined);
  assertEquals(after.Make, before.Make);
});

test('jpegMergeWriter updates JFIF resolution fields in the existing APP0 segment', async () => {
  const original = jpegWithJfif();
  const result = jpegMergeWriter(original, {
    'JFIF:ResolutionUnit': 'cm',
    'JFIF:XResolution': 300,
    'JFIF:YResolution': 150,
  });
  assertEquals(result.written, ['JFIF:ResolutionUnit', 'JFIF:XResolution', 'JFIF:YResolution']);
  const local = await jpegParser.parse(result.bytes, 'jfif.jpg');
  assertEquals(local.tags.ResolutionUnit, 'cm');
  assertEquals(local.tags.XResolution, 300);
  assertEquals(local.tags.YResolution, 150);

  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-G1', '-JFIF:ResolutionUnit', '-JFIF:XResolution', '-JFIF:YResolution', file]);
    const upstream = JSON.parse(stdout)[0];
    assertEquals(upstream['JFIF:ResolutionUnit'], 'cm');
    assertEquals(upstream['JFIF:XResolution'], 300);
    assertEquals(upstream['JFIF:YResolution'], 150);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter creates JFIF APP0 with default fields when absent', async () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const result = jpegMergeWriter(original, { 'JFIF:XResolution': 144 });
  assertEquals(result.written, ['JFIF:XResolution']);
  const local = await jpegParser.parse(result.bytes, 'new-jfif.jpg');
  assertEquals(local.tags.XResolution, 144);
  assertEquals(local.tags.YResolution, 72);
  assertEquals(local.tags.ResolutionUnit, 'inches');
});

test('jpegMergeWriter skips JFIF writes for Adobe JPEGs without a JFIF segment', () => {
  const original = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xee, 0, 8, 0x41, 0x64, 0x6f, 0x62, 0x65, 0,
    0xff, 0xd9,
  ]);
  const result = jpegMergeWriter(original, { 'JFIF:XResolution': 144 });
  assertEquals(result.written, []);
  assertEquals(result.skipped, ['JFIF:XResolution']);
  assertEquals(result.bytes, original);
});

test('jpegMergeWriter inserts, reads, and deletes JPEG ICC APP2 profile segments', async () => {
  const profile = new Uint8Array(readFileSync('vendor/exiftool/t/images/ICC_Profile.icc'));
  const result = jpegMergeWriter(new Uint8Array(readFileSync('assets/01.jpg')), { ICC_Profile: profile });
  const profileSegments = parseJpegSegments(result.bytes).filter(
    (segment) => segment.marker === 0xe2 &&
      String.fromCharCode(...result.bytes.subarray(segment.payloadStart, segment.payloadStart + 12)) === 'ICC_PROFILE\0',
  );
  assertEquals(result.written, ['ICC_Profile']);
  assertEquals(profileSegments.length, 1);
  assertEquals(result.bytes[profileSegments[0]!.payloadStart + 12], 1);
  assertEquals(result.bytes[profileSegments[0]!.payloadStart + 13], 1);
  const local = await jpegParser.parse(result.bytes, 'icc.jpg');
  assertEquals(local.tags.ProfileFileSignature, 'acsp');

  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-G1', '-ProfileFileSignature', file]);
    assertEquals(JSON.parse(stdout)[0]['ICC-header:ProfileFileSignature'], 'acsp');
  } finally {
    await rm(file, { force: true });
  }

  const deleted = jpegMergeWriter(result.bytes, { ICC_Profile: null });
  assertEquals(
    parseJpegSegments(deleted.bytes).some((segment) => segment.marker === 0xe2 &&
      String.fromCharCode(...deleted.bytes.subarray(segment.payloadStart, segment.payloadStart + 12)) === 'ICC_PROFILE\0'),
    false,
  );
});

test('jpegMergeWriter inserts an ICC profile before EOI when no scan exists', () => {
  const profile = new Uint8Array(readFileSync('vendor/exiftool/t/images/ICC_Profile.icc'));
  const result = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { ICC_Profile: profile });
  const segments = parseJpegSegments(result.bytes).filter((segment) => segment.marker === 0xe2);
  assertEquals(segments.length, 1);
  assertEquals(segments[0]!.end, result.bytes.length - 2);
  assertEquals(result.written, ['ICC_Profile']);
});

test('jpegParser reassembles multi-segment JPEG ICC profiles', async () => {
  const baseProfile = new Uint8Array(readFileSync('vendor/exiftool/t/images/ICC_Profile.icc'));
  const profile = new Uint8Array(70000);
  profile.set(baseProfile);
  new DataView(profile.buffer).setUint32(0, profile.length, false);
  const result = jpegMergeWriter(new Uint8Array(readFileSync('assets/01.jpg')), { ICC_Profile: profile });
  const segments = parseJpegSegments(result.bytes).filter(
    (segment) => segment.marker === 0xe2 &&
      String.fromCharCode(...result.bytes.subarray(segment.payloadStart, segment.payloadStart + 12)) === 'ICC_PROFILE\0',
  );
  assertEquals(segments.length, 2);
  assertEquals(result.bytes[segments[0]!.payloadStart + 12], 1);
  assertEquals(result.bytes[segments[0]!.payloadStart + 13], 2);
  assertEquals(result.bytes[segments[1]!.payloadStart + 12], 2);

  const local = await jpegParser.parse(result.bytes, 'large-icc.jpg');
  assertEquals(local.tags.ProfileSize, profile.length);
  assertEquals(local.tags.ProfileFileSignature, 'acsp');

  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-b', '-ICC_Profile', file], { encoding: 'buffer' });
    assertEquals(stdout.length, profile.length);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes and deletes Ducky APP12 blocks', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, {
    'Ducky:Quality': 50,
    'Ducky:Comment': 'Ducky note',
    'Ducky:Copyright': 'Ducky author',
  });
  assertEquals(result.written, ['Ducky:Quality', 'Ducky:Comment', 'Ducky:Copyright']);
  const local = await jpegParser.parse(result.bytes, 'ducky.jpg');
  assertEquals(local.tags.Quality, '50%');
  assertEquals(local.tags.Comment, 'Ducky note');
  assertEquals(local.tags.Copyright, 'Ducky author');

  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-G1', '-Ducky:Quality', '-Ducky:Comment', '-Ducky:Copyright', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info['Ducky:Quality'], '50%');
    assertEquals(info['Ducky:Comment'], 'Ducky note');
    assertEquals(info['Ducky:Copyright'], 'Ducky author');
  } finally {
    await rm(file, { force: true });
  }

  const deleted = jpegMergeWriter(result.bytes, {
    'Ducky:Quality': null,
    'Ducky:Comment': null,
    'Ducky:Copyright': null,
  });
  assertEquals(
    parseJpegSegments(deleted.bytes).some((segment) => segment.marker === 0xec &&
      String.fromCharCode(...deleted.bytes.subarray(segment.payloadStart, segment.payloadStart + 5)) === 'Ducky'),
    false,
  );
});

test('jpegMergeWriter creates both Photoshop thumbnail resources from JPEG bytes', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const thumbnail = new Uint8Array(readFileSync('assets/01.jpg'));
  const file = await tempFile('.jpg');
  try {
    for (const tag of ['PhotoshopThumbnail', 'PhotoshopBGRThumbnail']) {
      const result = jpegMergeWriter(original, { [`Photoshop:${tag}`]: thumbnail });
      assertEquals(result.written, [`Photoshop:${tag}`]);
      assertEquals(result.skipped, []);
      const local = await jpegParser.parse(result.bytes, 'photoshop-thumbnail.jpg');
      assertEquals(Array.from(local.tags[tag] as Uint8Array), Array.from(thumbnail));
      await writeFile(file, result.bytes);
      const { stdout } = await execFileP(upstreamExifTool, ['-b', `-Photoshop:${tag}`, file], {
        encoding: 'buffer',
        maxBuffer: 4 * 1024 * 1024,
      });
      assertEquals(Array.from(new Uint8Array(stdout)), Array.from(thumbnail));
    }
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter replaces PhotoshopQuality only in an existing nested resource', async () => {
  const photoshopHeader = new TextEncoder().encode('Photoshop 3.0\0');
  const jpegQualityResource = new Uint8Array([
    0x38, 0x42, 0x49, 0x4d, 0x04, 0x06, 0, 0,
    0, 0, 0, 4, 0, 86, 0, 0,
  ]);
  const payload = new Uint8Array(photoshopHeader.length + jpegQualityResource.length);
  payload.set(photoshopHeader);
  payload.set(jpegQualityResource, photoshopHeader.length);
  const segment = new Uint8Array(payload.length + 4);
  segment.set([0xff, 0xed, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  segment.set(payload, 4);
  const original = new Uint8Array([0xff, 0xd8, ...segment, 0xff, 0xd9]);
  const updated = jpegMergeWriter(original, { 'Photoshop:PhotoshopQuality': 80 });
  assertEquals(updated.written, ['Photoshop:PhotoshopQuality']);
  assertEquals(updated.skipped, []);
  const missing = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'Photoshop:PhotoshopQuality': 80,
  });
  assertEquals(missing.written, []);
  assertEquals(missing.skipped, ['Photoshop:PhotoshopQuality']);
  assertEquals(Array.from(missing.bytes), [0xff, 0xd8, 0xff, 0xd9]);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, updated.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-G1', '-Photoshop:PhotoshopQuality', file]);
    assertEquals(JSON.parse(stdout)[0]['Photoshop:PhotoshopQuality'], 80);
  } finally {
    await rm(file, { force: true });
  }
});

test('jpegMergeWriter writes scalar Photoshop APP13 resource tags', async () => {
  const values = {
    'Photoshop:CopyrightFlag': true,
    'Photoshop:URL': 'https://example.test/image',
    'Photoshop:GlobalAngle': 45,
    'Photoshop:GlobalAltitude': 30,
    'Photoshop:XResolution': 300,
    'Photoshop:YResolution': 150,
    'Photoshop:DisplayedUnitsX': 'inches',
    'Photoshop:DisplayedUnitsY': 'cm',
  };
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), values);
  assertEquals(out.written, Object.keys(values));
  assertEquals(out.skipped, []);
  const local = await jpegParser.parse(out.bytes, 'photoshop-resources.jpg');
  assertEquals(local.tags.CopyrightFlag, 'True');
  assertEquals(local.tags.URL, 'https://example.test/image');
  assertEquals(local.tags.GlobalAngle, 45);
  assertEquals(local.tags.GlobalAltitude, 30);
  assertEquals(local.tags.XResolution, 300);
  assertEquals(local.tags.YResolution, 150);
  assertEquals(local.tags.DisplayedUnitsX, 'inches');
  assertEquals(local.tags.DisplayedUnitsY, 'cm');
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-Photoshop:CopyrightFlag', '-Photoshop:URL',
      '-Photoshop:GlobalAngle', '-Photoshop:GlobalAltitude', '-Photoshop:XResolution',
      '-Photoshop:YResolution', '-Photoshop:DisplayedUnitsX', '-Photoshop:DisplayedUnitsY', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.CopyrightFlag, 1);
    assertEquals(tags.URL, 'https://example.test/image');
    assertEquals(tags.GlobalAngle, 45);
    assertEquals(tags.GlobalAltitude, 30);
    assertEquals(tags.XResolution, 300);
    assertEquals(tags.YResolution, 150);
    assertEquals(tags.DisplayedUnitsX, 1);
    assertEquals(tags.DisplayedUnitsY, 2);
  } finally {
    await rm(file, { force: true });
  }
  const deleted = jpegMergeWriter(out.bytes, { 'Photoshop:URL': null });
  const deletedTags = await jpegParser.parse(deleted.bytes, 'photoshop-resources.jpg');
  assertEquals('URL' in deletedTags.tags, false);
  assertEquals(deletedTags.tags.GlobalAngle, 45);
});

test('Ducky merge preserves unknown blocks byte-for-byte', () => {
  const original = new Uint8Array([
    0x44, 0x75, 0x63, 0x6b, 0x79,
    0x00, 0x63, 0x00, 0x03, 0xaa, 0xbb, 0xcc,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const merged = mergeDucky(original, [{ key: 'Ducky:Quality', id: 1, value: 70 }])!;
  assertEquals(Array.from(merged.subarray(5, 12)), [0x00, 0x63, 0x00, 0x03, 0xaa, 0xbb, 0xcc]);
});

test('Ducky parser and writer reject malformed blocks and values', () => {
  assertEquals(parseDucky(new Uint8Array()), {});
  assertEquals(parseDucky(new TextEncoder().encode('Ducky')), {});
  assertEquals(parseDucky(new Uint8Array([...new TextEncoder().encode('Ducky'), 0, 1, 0, 4, 0])), {});

  const invalidRequests = [
    { key: 'Ducky:Quality', id: 1, value: 'not a number' },
    { key: 'Ducky:Comment', id: 2, value: 42 },
    { key: 'Ducky:Comment', id: 2, value: 'x'.repeat(32_766) },
  ];
  for (const request of invalidRequests) {
    let threw = false;
    try {
      mergeDucky(null, [request]);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  }

  let malformedMergeThrew = false;
  try {
    mergeDucky(new Uint8Array([...new TextEncoder().encode('Ducky'), 0, 1, 0, 4, 0]), []);
  } catch {
    malformedMergeThrew = true;
  }
  assertEquals(malformedMergeThrew, true);
});

test('parseRawTiff rejects short, bad-endian, and bad-magic buffers', async () => {
  const { parseRawTiff } = await import('./jpeg-merge.js');
  assertEquals(parseRawTiff(new Uint8Array(4)), undefined);
  assertEquals(parseRawTiff(new Uint8Array([0, 1, 0, 42, 0, 0, 0, 8])), undefined);
  assertEquals(parseRawTiff(new Uint8Array([0x49, 0x49, 0, 0, 0, 0, 0, 8])), undefined);
});

test('mergeExifTiff throws on malformed TIFF', () => {
  let error: unknown;
  try {
    mergeExifTiff(new Uint8Array([0x49, 0x49, 0, 0, 0, 0, 0, 8, 0, 0]), []);
  } catch (e) {
    error = e;
  }
  assertEquals(error instanceof UnsupportedFormatError, true);
});

test('parseJpegSegments handles standalone markers and EOI/SOS termination', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0xff, 0xd0, 0xff, 0xd9, 0x00, 0x00]);
  const segs = parseJpegSegments(bytes);
  assertEquals(segs.map((s) => s.marker), [0x01, 0xd0, 0xd9]);
  assertEquals(parseJpegSegments(new Uint8Array([0xff, 0xd8, 0x00])).length, 0);
  assertEquals(parseJpegSegments(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 2])).length, 1);
});

test('jpegMergeWriter rejects non-JPEG input', () => {
  let error: unknown;
  try {
    jpegMergeWriter(new Uint8Array([0x89, 0x50]), { Copyright: 'x' });
  } catch (e) {
    error = e;
  }
  assertEquals(error instanceof UnsupportedFormatError, true);
});

test('resolveMergeRequests converts EXIF byte values and explicit GPS references', () => {
  const resolved = resolveMergeRequests({
    'ExifIFD:FileSource': '3',
    'ExifIFD:SceneType': '2',
    'ExifIFD:ApertureValue': '2',
    'ExifIFD:ShutterSpeedValue': '1/2',
    'GPS:GPSLatitude': -47.6,
    'GPS:GPSLatitudeRef': 'N',
  });
  assertEquals(resolved.skipped, []);
  assertEquals(resolved.exif.some((request) => request.spec.name === 'GPSLatitudeRef' && request.value === 'N'), true);
  assertEquals(resolved.exif.some((request) => request.spec.name === 'FileSource' && request.value instanceof Uint8Array), true);
  assertEquals(resolved.exif.some((request) => request.spec.name === 'SceneType' && request.value instanceof Uint8Array), true);
  const numericFileSource = resolveMergeRequests({ 'ExifIFD:FileSource': 3 });
  assertEquals(numericFileSource.exif[0]?.value, new Uint8Array([3]));
  const synthesizedReference = resolveMergeRequests({ 'GPS:GPSLatitude': -47.6 });
  assertEquals(synthesizedReference.exif.some((request) => request.spec.name === 'GPSLatitudeRef'), true);
});

test('parseRawTiff handles truncated IFD tables and invalid pointer offsets', () => {
  const truncated = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0]);
  assertEquals(parseRawTiff(truncated)?.ifd0.entries, []);

  const pointer = new Uint8Array(26);
  const view = new DataView(pointer.buffer);
  pointer.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 0xffff, true);
  view.setUint32(22, 0, true);
  assertEquals(parseRawTiff(pointer)?.ifd0.entries[0]?.sub?.entries, []);
});

test('jpegMergeWriter creates EXIF and XMP from scratch on a bare JPEG', () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const out = jpegMergeWriter(bare, {
    Copyright: 'Fresh copyright',
    Rights: 'Fresh rights',
    WebStatement: 'https://example.com/fresh',
  });
  assertEquals(out.skipped, []);
  const segs = parseJpegSegments(out.bytes);
  const exifSeg = segs.find((s) => s.marker === 0xe1 && payloadIsExif(out.bytes, s))!;
  const exifTags = extractExifFromTiff(out.bytes.subarray(exifSeg.payloadStart + 6, exifSeg.payloadEnd));
  assertEquals(exifTags.Copyright, 'Fresh copyright');
  // XMP APP1 inserted directly after the EXIF APP1.
  const xmpSeg = segs.find((s) => s.marker === 0xe1 && !payloadIsExif(out.bytes, s))!;
  const packet = new TextDecoder().decode(out.bytes.subarray(xmpSeg.payloadStart + 29, xmpSeg.payloadEnd));
  const parsed = parseXMP(packet);
  assertEquals(parsed.Rights, 'Fresh rights');
  assertEquals(parsed.WebStatement, 'https://example.com/fresh');
});

test('jpegMergeWriter skips deleting an absent XMP property on a bare JPEG', () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const result = jpegMergeWriter(original, { 'XMP-dc:Title': null });
  assertEquals(result.bytes, original);
  assertEquals(result.written, []);
  assertEquals(result.skipped, ['XMP-dc:Title']);
});

test('jpegMergeWriter creates and removes an oversized XMP packet on a bare JPEG', () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const created = jpegMergeWriter(original, { 'XMP-dc:Description': 'x'.repeat(70_000) });
  assertEquals(created.written, ['XMP-dc:Description']);
  const extensions = parseJpegSegments(created.bytes).filter((segment) => segment.marker === 0xe1);
  assertEquals(extensions.length > 1, true);
  const deleted = jpegMergeWriter(created.bytes, { 'XMP-dc:Description': null });
  assertEquals(parseJpegSegments(deleted.bytes).filter((segment) => segment.marker === 0xe1).length, 0);
});

test('jpegMergeWriter inserts XMP after EXIF when only EXIF exists', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const segs = parseJpegSegments(original);
  const xmpSeg = segs.find((s) => s.marker === 0xe1 && !payloadIsExif(original, s))!;
  // Strip the XMP APP1 from the original, keep everything else.
  const stripped = new Uint8Array(
    original.length - (xmpSeg.end - xmpSeg.start),
  );
  stripped.set(original.subarray(0, xmpSeg.start), 0);
  stripped.set(original.subarray(xmpSeg.end), xmpSeg.start);
  const out = jpegMergeWriter(stripped, { Rights: 'Inserted rights' });
  const outSegs = parseJpegSegments(out.bytes);
  const exifIdx = outSegs.findIndex((s) => s.marker === 0xe1 && payloadIsExif(out.bytes, s));
  const xmpIdx = outSegs.findIndex((s) => s.marker === 0xe1 && !payloadIsExif(out.bytes, s));
  assertEquals(xmpIdx, exifIdx + 1);
  const packet = new TextDecoder().decode(
    out.bytes.subarray(outSegs[xmpIdx].payloadStart + 29, outSegs[xmpIdx].payloadEnd),
  );
  assertEquals(parseXMP(packet).Rights, 'Inserted rights');
});

test('jpegMergeWriter rejects ICC profiles requiring more than 255 APP2 segments', () => {
  const profile = new Uint8Array(255 * (0xffff - 2 - 14) + 1);
  let message = '';
  try {
    jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { ICC_Profile: profile });
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'ICC profile requires more than 255 JPEG APP2 segments');
});

test('jpegMergeWriter rejects malformed JFIF APP0 fields', () => {
  const original = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0, 7,
    0x4a, 0x46, 0x49, 0x46, 0,
    0xff, 0xd9,
  ]);
  let error: unknown;
  try {
    jpegMergeWriter(original, { 'JFIF:XResolution': 100 });
  } catch (caught) {
    error = caught;
  }
  assertEquals(error instanceof UnsupportedFormatError, true);
});

function payloadIsExif(bytes: Uint8Array, s: { payloadStart: number }): boolean {
  return (
    bytes[s.payloadStart] === 0x45 && bytes[s.payloadStart + 1] === 0x78 &&
    bytes[s.payloadStart + 2] === 0x69 && bytes[s.payloadStart + 3] === 0x66
  );
}

test('jpegMergeWriter fresh EXIF creation reports unencodable tags as skipped', () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const out = jpegMergeWriter(bare, {
    Copyright: 'Fresh copyright',
    'EXIF:GPSLatitude': 'garbage',
  });
  assertEquals(out.written, ['EXIF:Copyright']);
  assertEquals(out.skipped, ['EXIF:GPSLatitude']);
  const segs = parseJpegSegments(out.bytes);
  const exifSeg = segs.find((s) => s.marker === 0xe1 && payloadIsExif(out.bytes, s))!;
  const tags = extractExifFromTiff(out.bytes.subarray(exifSeg.payloadStart + 6, exifSeg.payloadEnd));
  assertEquals(tags.Copyright, 'Fresh copyright');
  assertEquals(tags.GPSLatitude, undefined);
});

test('jpegMergeWriter removes the XMP APP1 segment when deleting its final property', () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const seeded = jpegMergeWriter(original, { 'XMP-dc:Title': 'Only property' });
  const deleted = jpegMergeWriter(seeded.bytes, { 'XMP-dc:Title': null });
  assertEquals(parseJpegSegments(deleted.bytes).some((segment) =>
    segment.marker === 0xe1 && !payloadIsExif(deleted.bytes, segment)
  ), false);
});

test('jpegMergeWriter leaves the XMP APP1 byte-identical when no XMP keys requested', () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const out = jpegMergeWriter(original, { Copyright: 'Only EXIF changes' });
  const before = parseJpegSegments(original);
  const after = parseJpegSegments(out.bytes);
  const beforeXmp = before.find((s) => s.marker === 0xe1 && !payloadIsExif(original, s))!;
  const afterXmp = after.find((s) => s.marker === 0xe1 && !payloadIsExif(out.bytes, s))!;

  assertEquals(
    Array.from(out.bytes.subarray(afterXmp.start, afterXmp.end)),
    Array.from(original.subarray(beforeXmp.start, beforeXmp.end)),
  );
});


test('jpegMergeWriter reports non-string XMP values as skipped', () => {
  const out = jpegMergeWriter(new Uint8Array(readFileSync('assets/01.jpg')), {
    'XMP-dc:Subject': 42 as unknown as string,
  });
  assertEquals(out.skipped, ['XMP-dc:Subject']);
  assertEquals(out.written, []);
});

test('jpegMergeWriter splits merged APP13 payloads over the 64 KiB segment limit', () => {
  // Existing Photoshop IRB with a large 0x040f block; adding IPTC pushes
  // the merged resource stream across the segment limit.
  const header = new TextEncoder().encode('Photoshop 3.0\0');
  const big = new Uint8Array(0xffe0);
  const block = (id: number, data: Uint8Array): number[] => [
    ...[0x38, 0x42, 0x49, 0x4d], id >> 8, id & 255, 0, 0,
    data.length >> 24 & 255, data.length >> 16 & 255, data.length >> 8 & 255, data.length & 255,
    ...data, ...(data.length % 2 ? [0] : []),
  ];
  const payload = new Uint8Array([...header, ...block(0x040f, big)]);
  const dvLen = payload.length + 2;
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xed, dvLen >> 8, dvLen & 255,
    ...payload,
    0xff, 0xd9,
  ]);
  const out = jpegMergeWriter(jpeg, { 'IPTC:Keywords': ['k'] });
  const photoshops = parseJpegSegments(out.bytes).filter((segment) =>
    segment.marker === 0xed &&
    String.fromCharCode(...out.bytes.subarray(segment.payloadStart, segment.payloadStart + 14)) === 'Photoshop 3.0\0',
  );
  assertEquals(photoshops.length, 2);
});

test('jpegMergeWriter reports non-array IPTC:Keywords as skipped', () => {
  const out = jpegMergeWriter(new Uint8Array(readFileSync('assets/01.jpg')), {
    'IPTC:Keywords': 42 as unknown as string,
  });
  assertEquals(out.skipped, ['IPTC:Keywords']);
  assertEquals(out.written, []);
});

test('jpegMergeWriter encodes fixed-count ComponentsConfiguration bytes', async () => {
  const original = new Uint8Array(readFileSync('assets/01.jpg'));
  const result = jpegMergeWriter(original, { 'ExifIFD:ComponentsConfiguration': [1, 2, 3, 0] });
  assertEquals(result.written, ['EXIF:ComponentsConfiguration']);
  assertEquals(result.skipped, []);
  const exifSegment = parseJpegSegments(result.bytes).find((segment) => segment.marker === 0xe1)!;
  const tiff = parseRawTiff(result.bytes.subarray(exifSegment.payloadStart + 6, exifSegment.payloadEnd))!;
  const exifIfd = tiff.ifd0.entries.find((entry) => entry.tag === 0x8769)!.sub!;
  const data = exifIfd.entries.find((entry) => entry.tag === 0x9101)!.raw4!;
  assertEquals(Buffer.compare(Buffer.from(data), Buffer.from([1, 2, 3, 0])), 0);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-ComponentsConfiguration', file]);
    assertEquals(JSON.parse(stdout)[0].ComponentsConfiguration, '1 2 3 0');
  } finally {
    await rm(file, { force: true });
  }
});
