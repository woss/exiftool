import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { assertEquals } from '../../src/test/asserts.js';
import { exvParser } from './exv.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

function exvFixture(): Uint8Array {
  const jpeg = new Uint8Array(readFileSync('assets/01.jpg'));
  return new Uint8Array([
    0xff, 0x01, ...new TextEncoder().encode('Exiv2'),
    ...jpeg.subarray(2),
  ]);
}

test('exvParser reads Exiv2-wrapped JPEG metadata', async () => {
  const info = await exvParser.parse(exvFixture(), 'metadata.exv');
  assertEquals(info.format, 'EXV');
  assertEquals(info.tags.FileType, 'EXV');
  assertEquals(info.tags.Make, 'Canon');
});

test('exvParser updates EXIF metadata while preserving the Exiv2 header', () => {
  const result = exvParser.writeBytes!(exvFixture(), { Artist: 'EXV author' });
  assertEquals(result.written, ['EXIF:Artist']);
  assertEquals(Array.from(result.bytes.subarray(0, 7)), [0xff, 0x01, 0x45, 0x78, 0x69, 0x76, 0x32]);
});

test('vendored ExifTool reads standalone EXV writes', async () => {
  const { writeFile, rm } = await import('node:fs/promises');
  const { tempFile } = await import('../test/tmp.js');
  const file = await tempFile('.exv');
  try {
    const result = exvParser.writeBytes!(exvFixture(), { Artist: 'EXV parity author' });
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Artist', file]);
    assertEquals(JSON.parse(stdout)[0].Artist, 'EXV parity author');
  } finally {
    await rm(file, { force: true });
  }
});