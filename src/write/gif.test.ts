import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm, writeFile } from 'node:fs/promises';
import { tempFile } from '../test/tmp.js';
import { buildXmpPropertiesPacket } from './xmp-writer.js';
import { UnsupportedFormatError } from './writers.js';
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

test('GIF writer accepts raw XMP strings, bytes, updates, and deletion', () => {
  const source = minimalGif();
  const packet = buildXmpPropertiesPacket([{ name: 'dc:title', value: 'Raw title' }]);
  const stringPacket = gifWriter(source, { XMP: packet });
  const bytePacket = gifWriter(source, { XMP: new TextEncoder().encode(packet) });
  const updated = gifWriter(source, { XMP: packet, Title: 'Updated title' });
  assertEquals(parseGifMetadata(stringPacket.bytes).Title, 'Raw title');
  assertEquals(parseGifMetadata(bytePacket.bytes).Title, 'Raw title');
  assertEquals(parseGifMetadata(updated.bytes).Title, 'Updated title');
  const deleted = gifWriter(stringPacket.bytes, { XMP: null });
  assertEquals('Title' in parseGifMetadata(deleted.bytes), false);
});

test('GIF writer preserves a global color table when inserting metadata', () => {
  const source = minimalGif();
  const header = source.slice(0, 13);
  header[10] = 0x80;
  const colorTable = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const withColorTable = new Uint8Array([...header, ...colorTable, ...source.subarray(13)]);
  const written = gifWriter(withColorTable, { Comment: 'Color table' });
  assertEquals(
    Array.from(written.bytes.subarray(13, 19)),
    Array.from(colorTable),
  );
  assertEquals(parseGifMetadata(written.bytes).Comment, 'Color table');
});

test('GIF parser reports animation frame count and duration', () => {
  const source = minimalGif();
  const image = source.subarray(13, source.length - 1);
  const header = source.subarray(0, 13);
  const trailer = new Uint8Array([0x3b]);
  const graphicControl = new Uint8Array([0x21, 0xf9, 4, 0, 25, 0, 0, 0]);
  const animated = new Uint8Array([...header, ...graphicControl, ...image, ...image, ...trailer]);
  const tags = parseGifMetadata(animated);
  assertEquals(tags.FrameCount, 2);
  assertEquals(tags.Duration, '0.25 s');
});

test('GIF writer skips unsupported values and rejects malformed structures', () => {
  const source = minimalGif();
  const skipped = gifWriter(source, { Comment: 42, ICC_Profile: 'invalid', XMP: 42, Unknown: 'value' });
  assertEquals(skipped.bytes, source);
  assertEquals(skipped.written, []);
  assertEquals(skipped.skipped, ['Comment', 'ICC_Profile', 'XMP', 'Unknown']);

  const header = source.subarray(0, 13);
  const xmpHeader = new TextEncoder().encode('XMP DataXMP');
  const xmpPacket = new TextEncoder().encode('<?xpacket end="w"?>');
  const malformedGifs = [
    new Uint8Array(12),
    new Uint8Array([...header, 0x21]),
    new Uint8Array([...header, 0x21, 0xfe, 2, 0x41]),
    new Uint8Array([...header, 0x21, 0xff, 10]),
    new Uint8Array([...header, 0x21, 0xff, 11, ...xmpHeader, ...new TextEncoder().encode('no terminator'), 0]),
    new Uint8Array([...header, 0x21, 0xff, 11, ...xmpHeader, ...xmpPacket, 0]),
    new Uint8Array([...header, 0x2c]),
    new Uint8Array([...header, 0x00]),
  ];
  const globalColorTableHeader = header.slice();
  globalColorTableHeader[10] = 0x80;
  malformedGifs.push(globalColorTableHeader);

  for (const malformed of malformedGifs) {
    let error: unknown;
    try {
      gifWriter(malformed, { Comment: 'test' });
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof UnsupportedFormatError, true);
  }
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