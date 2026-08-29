import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import { ExifToolCore } from './exiftool-core.js';
import { assertEquals } from './test/asserts.js';
import { MODERN_PLUGINS } from './plugins.js';
import { UnsupportedFormatError } from './write/writers.js';

test('writeBytes rewrites a JPEG buffer in memory', async () => {
  const { readFile } = await import('node:fs/promises');
  const original = await readFile('assets/01.jpg');
  const tool = new ExifToolCore({ plugins: MODERN_PLUGINS });
  const out = await tool.writeBytes(original, { Artist: 'core' });
  assertEquals(out.written, ['Artist']);
  assertEquals(out.skipped, []);
  assertEquals(out.bytes[0], 0xff);
  assertEquals(out.bytes[1], 0xd8);
  assertEquals(out.bytes.length > 0, true);
});

test('writeBytes rejects buffers without a writable plugin', async () => {
  const tool = new ExifToolCore({ plugins: [] });
  let threw = false;
  try {
    await tool.writeBytes(new Uint8Array([0xff, 0xd8]), { Artist: 'x' });
  } catch (e) {
    threw = e instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});
