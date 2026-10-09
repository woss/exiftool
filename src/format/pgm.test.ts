import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertEquals } from '../../src/test/asserts.js';
import { pgmParser } from './pgm.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

function pgmP5(): Uint8Array {
  return new Uint8Array([
    ...new TextEncoder().encode('P5\n# old\n2 1\n255\n'),
    0x20, 0x7f,
  ]);
}

test('pgmParser reads ASCII P2 and binary P5 metadata', async () => {
  const ascii = new TextEncoder().encode('P2\n# ascii comment\n2 1\n15\n0 15\n');
  const asciiInfo = await pgmParser.parse(ascii, 'gray.pgm');
  assertEquals(asciiInfo.tags.ImageWidth, 2);
  assertEquals(asciiInfo.tags.MaxVal, 15);
  assertEquals(asciiInfo.tags.Comment, 'ascii comment');
  const binaryInfo = await pgmParser.parse(pgmP5(), 'gray.pgm');
  assertEquals(binaryInfo.format, 'PGM');
  assertEquals(binaryInfo.tags.FileType, 'PGM');
  assertEquals(binaryInfo.tags.ImageHeight, 1);
});

test('pgmParser updates comments and preserves binary pixels beginning with whitespace', () => {
  const original = pgmP5();
  const pixels = original.subarray(original.length - 2);
  const result = pgmParser.writeBytes!(original, { Comment: 'new' });
  assertEquals(result.written, ['Comment']);
  assertEquals(Array.from(result.bytes.slice(-2)), Array.from(pixels));
});

test('vendored ExifTool reads PGM comments written by the adapter', async () => {
  const file = await (await import('../test/tmp.js')).tempFile('.pgm');
  try {
    const result = pgmParser.writeBytes!(pgmP5(), { Comment: 'Upstream PGM parity' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Comment', file]);
    assertEquals(JSON.parse(stdout)[0].Comment, 'Upstream PGM parity');
  } finally {
    await (await import('node:fs/promises')).rm(file, { force: true });
  }
});