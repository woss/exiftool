import { test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm, writeFile } from 'node:fs/promises';
import { assertEquals } from '../../src/test/asserts.js';
import { tempFile } from '../test/tmp.js';
import { buildXmpPropertiesPacket } from '../write/xmp-writer.js';
import { xmpParser } from './xmp.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

test('xmpParser recognizes and parses standalone XMP packets', async () => {
  const packet = buildXmpPropertiesPacket([{ name: 'dc:title', value: 'Original title' }]);
  const bytes = new TextEncoder().encode(packet);
  assertEquals(xmpParser.canParse(bytes), true);
  const info = await xmpParser.parse(bytes, 'metadata.xmp');
  assertEquals(info.format, 'XMP');
  assertEquals(info.tags.Title, 'Original title');
  assertEquals(info.tags.FileType, 'XMP');
});

test('xmpParser updates and deletes properties while preserving other packet content', async () => {
  const packet = buildXmpPropertiesPacket([
    { name: 'dc:title', value: 'Old title' },
    { name: 'dc:subject', value: ['one', 'two'] },
  ]);
  const outcome = xmpParser.writeBytes!(new TextEncoder().encode(packet), {
    'XMP-dc:Title': 'Updated title',
    'XMP-dc:Subject': null,
  });
  const info = await xmpParser.parse(outcome.bytes, 'metadata.xmp');
  assertEquals(outcome.written, ['XMP-dc:Title', 'XMP-dc:Subject']);
  assertEquals(info.tags.Title, 'Updated title');
  assertEquals('Subject' in info.tags, false);
});

test('vendored ExifTool reads standalone XMP writes', async () => {
  const file = await tempFile('.xmp');
  try {
    const original = buildXmpPropertiesPacket([{ name: 'dc:title', value: 'Old title' }]);
    const outcome = xmpParser.writeBytes!(new TextEncoder().encode(original), {
      'XMP-dc:Title': 'Upstream XMP title',
    });
    await writeFile(file, outcome.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Title', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info.Title, 'Upstream XMP title');
  } finally {
    await rm(file, { force: true });
  }
});