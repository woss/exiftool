import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertEquals } from '../../src/test/asserts.js';
import { pbmParser } from './pbm.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

function pbmP4(): Uint8Array {
  return new Uint8Array([...new TextEncoder().encode('P4\n# old\n2 1\n'), 0x40]);
}

test('pbmParser reads ASCII P1 and binary P4 headers', async () => {
  const ascii = await pbmParser.parse(new TextEncoder().encode('P1\n# one bit\n2 1\n0 1\n'), 'image.pbm');
  assertEquals(ascii.format, 'PBM');
  assertEquals(ascii.tags.ImageWidth, 2);
  assertEquals(ascii.tags.ImageHeight, 1);
  assertEquals(ascii.tags.Comment, 'one bit');
  assertEquals(ascii.tags.MaxVal, undefined);
  assertEquals((await pbmParser.parse(pbmP4(), 'image.pbm')).tags.FileType, 'PBM');
});

test('pbmParser updates comments and preserves P4 bitmap bytes', () => {
  const source = pbmP4();
  const result = pbmParser.writeBytes!(source, { Comment: 'new' });
  assertEquals(result.written, ['Comment']);
  assertEquals(result.bytes[result.bytes.length - 1], 0x40);
});

test('vendored ExifTool reads PBM comments written by the adapter', async () => {
  const file = await (await import('../test/tmp.js')).tempFile('.pbm');
  try {
    const result = pbmParser.writeBytes!(pbmP4(), { Comment: 'Upstream PBM parity' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Comment', file]);
    assertEquals(JSON.parse(stdout)[0].Comment, 'Upstream PBM parity');
  } finally {
    await (await import('node:fs/promises')).rm(file, { force: true });
  }
});