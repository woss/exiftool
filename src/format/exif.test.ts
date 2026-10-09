import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertEquals } from '../../src/test/asserts.js';
import { buildTiff } from '../exif/tiff-builder.js';
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