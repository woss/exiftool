import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { assertEquals } from '../../src/test/asserts.js';
import { UnsupportedFormatError } from '../write/writers.js';
import { pbmParser } from './pbm.js';
import { pgmParser } from './pgm.js';
import { ppmParser } from './ppm.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;
const fixturePath = 'vendor/exiftool/t/images/PPM.ppm';

test('ppmParser reads P6 header and comment from upstream fixture', async () => {
  const bytes = new Uint8Array(readFileSync(fixturePath));
  const info = await ppmParser.parse(bytes, 'image.ppm');
  assertEquals(info.format, 'PPM');
  assertEquals(info.tags.ImageWidth, 8);
  assertEquals(info.tags.ImageHeight, 8);
  assertEquals(info.tags.MaxVal, 255);
  assertEquals(info.tags.Comment, 'ExifTool PPM test');
});

test('ppmParser replaces/deletes comments and preserves P6 image bytes', async () => {
  const source = new Uint8Array(readFileSync(fixturePath));
  const marker = new TextEncoder().encode('255\n');
  const maxValueStart = source.findIndex((value, index) =>
    value === marker[0] && source[index + 1] === marker[1] &&
    source[index + 2] === marker[2] && source[index + 3] === marker[3]);
  const originalPixels = source.subarray(maxValueStart + marker.length);
  const result = ppmParser.writeBytes!(source, { Comment: 'new\nsecond line' });
  const after = await ppmParser.parse(result.bytes, 'image.ppm');
  assertEquals(result.written, ['Comment']);
  assertEquals(result.skipped, []);
  assertEquals(after.tags.Comment, 'new\nsecond line');
  assertEquals(after.tags.ImageWidth, 8);
  assertEquals(Array.from(result.bytes.slice(-originalPixels.length)), Array.from(originalPixels));

  const deleted = ppmParser.writeBytes!(result.bytes, { Comment: null });
  assertEquals((await ppmParser.parse(deleted.bytes, 'image.ppm')).tags.Comment, undefined);
});

test('vendored ExifTool reads PPM comments written by the adapter', async () => {
  const source = new Uint8Array(readFileSync(fixturePath));
  const result = ppmParser.writeBytes!(source, { Comment: 'Upstream PPM parity' });
  const { writeFile, rm } = await import('node:fs/promises');
  const { tempFile } = await import('../test/tmp.js');
  const file = await tempFile('.ppm');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Comment', file]);
    assertEquals(JSON.parse(stdout)[0].Comment, 'Upstream PPM parity');
  } finally {
    await rm(file, { force: true });
  }
});

test('Netpbm parsers reject malformed headers and unsupported writes', async () => {
  const malformed = [
    [ppmParser, 'P6 2 1 0\n'],
    [pgmParser, 'P5 2 -1 255\n'],
    [pbmParser, 'P4 0 1\n'],
  ] as const;
  for (const [parser, input] of malformed) {
    const bytes = new TextEncoder().encode(input);
    assertEquals(parser.canParse(bytes), false);
    let error: unknown;
    try {
      await parser.parse(bytes, 'invalid.pnm');
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof UnsupportedFormatError, true);
  }

  const source = new Uint8Array(readFileSync(fixturePath));
  const ignored = ppmParser.writeBytes!(source, { Title: 'unsupported' });
  assertEquals(ignored.bytes, source);
  assertEquals(ignored.written, []);
  assertEquals(ignored.skipped, ['Title']);

  const invalidComment = ppmParser.writeBytes!(source, { Comment: 42 });
  assertEquals(invalidComment.bytes, source);
  assertEquals(invalidComment.written, []);
  assertEquals(invalidComment.skipped, ['Comment']);
});