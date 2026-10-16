import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertEquals } from '../../src/test/asserts.js';
import { buildTiff } from '../exif/tiff-builder.js';
import { UnsupportedFormatError } from '../write/writers.js';
import { exifParser } from './exif.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

test('exifParser reads a standalone TIFF-encoded EXIF stream', async () => {
  const bytes = buildTiff({ Make: 'TestCo', Model: 'Body' }).bytes;
  const info = await exifParser.parse(bytes, 'metadata.exif');
  assertEquals(info.format, 'EXIF');
  assertEquals(info.tags.Make, 'TestCo');
  assertEquals(info.tags.Model, 'Body');
  assertEquals(info.tags.FileType, 'EXIF');
});

test('exifParser adds EXIF/GPS data to an existing EXIF file', async () => {
  const bytes = buildTiff({ Make: 'TestCo' }).bytes;
  const result = exifParser.writeBytes!(bytes, {
    Model: 'Body',
    GPSLatitude: 47.6,
    GPSLongitude: -122.3,
  });
  const info = await exifParser.parse(result.bytes, 'metadata.exif');
  assertEquals(result.skipped, []);
  assertEquals(info.tags.Make, 'TestCo');
  assertEquals(info.tags.Model, 'Body');
  assertEquals(info.tags.GPSLatitude !== undefined, true);
  assertEquals(info.tags.GPSLongitude !== undefined, true);
});

test('exifParser rejects invalid signatures and malformed TIFF structures', async () => {
  const short = new Uint8Array(7);
  assertEquals(exifParser.canParse(short), false);
  let parseError: unknown;
  try {
    await exifParser.parse(short, 'invalid.exif');
  } catch (error) {
    parseError = error;
  }
  assertEquals(parseError instanceof UnsupportedFormatError, true);

});

test('exifParser returns unchanged bytes when no writable requests remain', () => {
  const original = buildTiff({ Make: 'TestCo' }).bytes;
  const result = exifParser.writeBytes!(original, { 'IPTC:Keywords': ['ignored'] });
  assertEquals(result.bytes, original);
  assertEquals(result.written, []);
  assertEquals(result.skipped, ['IPTC:Keywords']);
});

test('exifParser writes XMP properties into the standalone TIFF stream', () => {
  const original = buildTiff({ Make: 'TestCo' }).bytes;
  const result = exifParser.writeBytes!(original, { 'XMP-dc:Title': 'Standalone title' });
  assertEquals(result.written, ['XMP-dc:Title']);
  assertEquals(result.skipped, []);
  assertEquals(Buffer.compare(Buffer.from(result.bytes), Buffer.from(original)) !== 0, true);
});

test('exifParser reports an unencodable EXIF request as skipped', () => {
  const result = exifParser.writeBytes!(buildTiff({ Make: 'TestCo' }).bytes, {
    'EXIF:Orientation': 'not an orientation',
  });
  assertEquals(result.written, []);
  assertEquals(result.skipped, ['EXIF:Orientation']);
});

test('vendored ExifTool reads standalone EXIF writes', async () => {
  const { writeFile, rm } = await import('node:fs/promises');
  const { tempFile } = await import('../test/tmp.js');
  const file = await tempFile('.exif');
  try {
    const result = exifParser.writeBytes!(buildTiff({ Make: 'TestCo' }).bytes, {
      Model: 'Upstream EXIF parity',
    });
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Make', '-Model', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info.Make, 'TestCo');
    assertEquals(info.Model, 'Upstream EXIF parity');
  } finally {
    await rm(file, { force: true });
  }
});