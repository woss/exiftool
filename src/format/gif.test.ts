import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertEquals } from '../../src/test/asserts.js';
import { gifParser } from './gif.js';

test('gifParser recognizes GIF87a and GIF89a signatures', () => {
  assertEquals(gifParser.canParse(new TextEncoder().encode('GIF87a')), true);
  assertEquals(gifParser.canParse(new TextEncoder().encode('GIF89a')), true);
  assertEquals(gifParser.canParse(new TextEncoder().encode('GIF90a')), false);
});

test('gifParser reads the vendored upstream GIF fixture', async () => {
  const bytes = new Uint8Array(readFileSync('vendor/exiftool/t/images/GIF.gif'));
  const info = await gifParser.parse(bytes, 'fixture.gif');
  assertEquals(info.format, 'GIF');
  assertEquals(info.tags.GIFVersion, '89a');
  assertEquals(info.tags.ImageWidth, 8);
  assertEquals(info.tags.ImageHeight, 8);
  assertEquals(info.tags.FileType, 'GIF');
});