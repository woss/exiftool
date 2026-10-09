import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm, writeFile } from 'node:fs/promises';
import { tempFile } from '../test/tmp.js';
import { gifWriter, parseGifMetadata } from './gif.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

function minimalGif(): Uint8Array {
  return new Uint8Array([
    ...new TextEncoder().encode('GIF87a'),
    1, 0, 1, 0, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
    2, 2, 0x44, 0x01, 0,
    0x3b,
  ]);
}

function iccProfile(): Uint8Array {
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length, false);
  bytes.set(new TextEncoder().encode('acsp'), 36);
  return bytes;
}

test('GIF writer inserts a comment, upgrades the version, and preserves image data', () => {
  const source = minimalGif();
  const imageData = source.slice(source.indexOf(0x2c));
  const written = gifWriter(source, { Comment: 'GIF note' });
  assertEquals(new TextDecoder().decode(written.bytes.subarray(0, 6)), 'GIF89a');
  assertEquals(written.written, ['Comment']);
  assertEquals(parseGifMetadata(written.bytes).Comment, 'GIF note');
  assertEquals(Array.from(written.bytes.slice(written.bytes.indexOf(0x2c))), Array.from(imageData));
});

test('GIF writer replaces and deletes comment extensions', () => {
  const first = gifWriter(minimalGif(), { Comment: 'old' });
  const replaced = gifWriter(first.bytes, { 'GIF:Comment': 'new' });
  assertEquals(parseGifMetadata(replaced.bytes).Comment, 'new');
  const deleted = gifWriter(replaced.bytes, { Comment: null });
  assertEquals('Comment' in parseGifMetadata(deleted.bytes), false);
});

test('GIF writer adds XMP properties and ICC profiles', () => {
  const profile = iccProfile();
  const written = gifWriter(minimalGif(), {
    Title: 'GIF title',
    ICC_Profile: profile,
  });
  const tags = parseGifMetadata(written.bytes);
  assertEquals(tags.Title, 'GIF title');
  assertEquals(tags.ProfileSize, profile.length);
  assertEquals(written.written, ['Title', 'ICC_Profile']);
});

test('vendored ExifTool reads comments written to GIF', async () => {
  const file = await tempFile('.gif');
  try {
    await writeFile(file, gifWriter(minimalGif(), { Comment: 'ExifTool parity' }).bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Comment', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info.Comment, 'ExifTool parity');
  } finally {
    await rm(file, { force: true });
  }
});

test('vendored ExifTool reads XMP properties written to GIF', async () => {
  const file = await tempFile('.gif');
  try {
    await writeFile(file, gifWriter(minimalGif(), { Title: 'GIF XMP title' }).bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-Title', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info.Title, 'GIF XMP title');
  } finally {
    await rm(file, { force: true });
  }
});

test('vendored ExifTool reads ICC profiles written to GIF', async () => {
  const file = await tempFile('.gif');
  try {
    await writeFile(file, gifWriter(minimalGif(), { ICC_Profile: iccProfile() }).bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-ICC_Profile', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(String(info.ICC_Profile).includes('132 bytes'), true);
  } finally {
    await rm(file, { force: true });
  }
});