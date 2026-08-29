import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { buildTiff } from '../exif/tiff-builder.js';
import { supportedWriteFormats } from './pipeline.js';
import {
  avifWriter,
  jpegWriter,
  pngWriter,
  UnsupportedFormatError,
  webpWriter,
} from './writers.js';
import { crc32 } from '../utils/crc32.js';
import { jpegParser } from '../format/jpeg.js';
import { pngParser } from '../format/png.js';
import { webpParser } from '../format/webp.js';
import { avifParser } from '../format/avif.js';

function u16be(v: number): number[] {
  return [(v >> 8) & 255, v & 255];
}
function u32be(v: number): number[] {
  return [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function u32le(v: number): number[] {
  return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
}
function chars(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function oldTiff(): Uint8Array {
  return buildTiff({ Make: 'OldCo' }).bytes;
}

// --- JPEG container ---

const SOF0 = [0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00];
const COM = [...[0xFF, 0xFE], ...u16be(6), 0x68, 0x69, 0x21]; // "hi!"

function buildJpeg(withOldExif: boolean): Uint8Array {
  const parts: number[][] = [[0xFF, 0xD8], [0xFF, 0xE0, 0x00, 0x10, ...chars('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]];
  if (withOldExif) {
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...oldTiff()];
const COM = [...[0xFF, 0xFE], ...u16be(5), 0x68, 0x69, 0x21]; // "hi!"
  }
  parts.push(SOF0, COM, [0xFF, 0xDA, 0x00, 0x02], [0xFF, 0xD9]);
  return new Uint8Array(parts.flat());
}

test('jpegWriter rebuilds APP1 EXIF and preserves other segments', async () => {
  const out = jpegWriter(buildJpeg(true), { Make: 'NewCo', Orientation: 1 });
  let app1Count = 0;
  for (let i = 2; i < out.bytes.length - 1; i++) {
    if (out.bytes[i] === 0xFF && out.bytes[i + 1] === 0xE1) app1Count++;
  }
  assertEquals(app1Count, 1);
  const asText = String.fromCharCode(...out.bytes);
  assertEquals(asText.includes('hi!'), true);

  const info = await jpegParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'NewCo');
});

test('jpegWriter inserts EXIF into files without one', async () => {
  const out = jpegWriter(buildJpeg(false), { Make: 'Fresh' });
  const info = await jpegParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'Fresh');
});

test('jpegWriter rejects non-JPEG input', () => {
  try {
    jpegWriter(new TextEncoder().encode('nope'), { Make: 'X' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals(e instanceof UnsupportedFormatError, true);
  }
});

// --- PNG container ---

function pngChunk(type: string, data: Uint8Array): number[] {
  const crcInput = new Uint8Array([...chars(type), ...data]);
  return [...u32be(data.length), ...crcInput, ...u32be(crc32(crcInput))];
}

function buildPng(withExif: boolean): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array([
    ...sig,
    ...pngChunk('IHDR', new Uint8Array(13)),
    ...(withExif ? pngChunk('eXIf', oldTiff()) : []),
    ...pngChunk('IDAT', new Uint8Array([1, 2, 3])),
    ...pngChunk('IEND', new Uint8Array([])),
  ]);
}

test('pngWriter replaces eXIf chunk after IHDR with valid CRCs', async () => {
  const out = pngWriter(buildPng(true), { Make: 'PngCo' });
  const dv = new DataView(out.bytes.buffer);
  const found: string[] = [];
  let pos = 8;
  while (pos + 12 <= out.bytes.length) {
    const len = dv.getUint32(pos, false);
    const type = String.fromCharCode(...out.bytes.subarray(pos + 4, pos + 8));
    assertEquals(
      dv.getUint32(pos + 8 + len, false),
      crc32(out.bytes.subarray(pos + 4, pos + 8 + len)),
      `CRC mismatch on ${type}`,
    );
    found.push(type);
    pos += 12 + len;
  }
  assertEquals(found.filter((t) => t === 'eXIf').length, 1);
  assertEquals(found.indexOf('eXIf') < found.indexOf('IDAT'), true);

  const info = await pngParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'PngCo');
});

test('pngWriter adds eXIf to files without one', async () => {
  const out = pngWriter(buildPng(false), { Make: 'PngNew' });
  const info = await pngParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'PngNew');
});

test('pngWriter rejects non-PNG input', () => {
  try {
    pngWriter(new Uint8Array(32), { Make: 'X' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals(e instanceof UnsupportedFormatError, true);
  }
});

// --- WebP container ---

function riffChunk(id: string, data: number[]): number[] {
  return [...chars(id), ...u32le(data.length), ...data, ...(data.length % 2 ? [0] : [])];
}

function buildWebp(vp8xFlags = 0x00): Uint8Array {
  const body = [
    ...riffChunk('VP8X', [vp8xFlags, 7, 0, 0, 5, 0, 0, 0, 0, 0]),
    ...riffChunk('EXIF', [...oldTiff()]),
    ...riffChunk('VP8 ', [1, 2, 3]),
  ];
  return new Uint8Array([
    ...chars('RIFF'),
    ...u32le(4 + body.length),
    ...chars('WEBP'),
    ...body,
  ]);
}

test('webpWriter sets the EXIF flag and swaps the EXIF chunk', async () => {
  const out = webpWriter(buildWebp(), { Make: 'WebpCo' });
  const info = await webpParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.WebP_EXIF, true);
  assertEquals(info.tags.Make, 'WebpCo');
});

test('webpWriter requires an existing VP8X chunk', () => {
  const noVp8x = new Uint8Array([
    ...chars('RIFF'),
    ...u32le(4 + 12),
    ...chars('WEBP'),
    ...riffChunk('VP8 ', [1]),
  ]);
  try {
    webpWriter(noVp8x, { Make: 'X' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals(e instanceof UnsupportedFormatError, true);
  }
});

test('webpWriter rejects non-WebP input', () => {
  try {
    webpWriter(new Uint8Array(16), { Make: 'X' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals(e instanceof UnsupportedFormatError, true);
  }
});

// --- AVIF container ---

function box(type: string, payload: number[]): number[] {
  return [...u32be(payload.length + 8), ...chars(type), ...payload];
}

function buildAvif(withMeta: boolean): Uint8Array {
  const ftyp = box('ftyp', [...chars('avif'), 0, 0, 0, 0]);
  const meta = box('meta', [
    ...box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...chars('pict'), 0]),
    ...box('Exif', [0, 0, 0, 0, ...oldTiff()]),
  ]);
  return new Uint8Array([...ftyp, ...(withMeta ? meta : []), ...box('mdat', [9, 9, 9])]);
}

test('avifWriter replaces the Exif box inside existing meta', async () => {
  const out = avifWriter(buildAvif(true), { Make: 'AvifCo' });
  const info = await avifParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'AvifCo');
  assertEquals(String.fromCharCode(...out.bytes).includes('pict'), true);
});

test('avifWriter appends a fresh meta box after ftyp when absent', async () => {
  const out = avifWriter(buildAvif(false), { Make: 'AvifNew' });
  const info = await avifParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'AvifNew');
});

test('avifWriter rejects non-ISOBMFF input', () => {
  try {
    avifWriter(new Uint8Array(64), { Make: 'X' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals(e instanceof UnsupportedFormatError, true);
  }
});

test('supportedWriteFormats lists the four containers', async () => {
  assertEquals(await supportedWriteFormats(), ['JPEG', 'PNG', 'WebP', 'AVIF']);
});

test('jpegWriter skips RST markers while rebuilding', async () => {
  const base = buildJpeg(true);
  const withRst = new Uint8Array(base.length + 2);
  withRst.set(base.subarray(0, 20), 0);
  withRst.set([0xFF, 0xD0], 20);
  withRst.set(base.subarray(20), 22);
  const out = jpegWriter(withRst, { Make: 'RstCo' });
  const info = await jpegParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'RstCo');
});

test('pngWriter stops at a truncated trailing chunk but keeps valid output', async () => {
  const base = buildPng(true);
  const truncated = new Uint8Array([...base, ...u32be(999), 1, 2, 3, 4, 5, 6, 7, 8]);
  const out = pngWriter(truncated, { Make: 'TruncCo' });
  const info = await pngParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'TruncCo');
});

test('pngWriter rejects files without an IHDR chunk', () => {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const noIhdr = new Uint8Array([
    ...sig,
    ...pngChunk('IDAT', new Uint8Array([1])),
    ...pngChunk('IEND', new Uint8Array([])),
  ]);
  try {
    pngWriter(noIhdr, { Make: 'X' });
    throw new Error('should have thrown');
  } catch (e) {
    assertEquals(e instanceof UnsupportedFormatError, true);
  }
});


test('avifWriter handles a zero-terminated final box and malformed meta children', async () => {
  // size==0 on the last box means "extends to end of stream"; a meta child
  // declaring an impossible size terminates the child scan without throwing.
  const ftyp = box('ftyp', [...chars('avif'), 0, 0, 0, 0]);
  const exif = box('Exif', [0, 0, 0, 4, ...buildTiff({ Make: 'OldAv' }).bytes]);
  const hdlr = box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...chars('pict'), 0]);
  const junk = [...u32be(4), ...chars('junk')]; // csize < 8 -> scan breaks
  const meta = [...u32be(8 + hdlr.length + exif.length + junk.length), ...chars('meta'),
    ...hdlr, ...exif, ...junk];
  const orig = new Uint8Array([...ftyp, ...meta, ...box('mdat', [9])]);
  const out = avifWriter(orig, { Make: 'ZeroAv' });
  const info = await avifParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Make, 'ZeroAv');
});

test('avifParser skips malformed meta children in the original input', async () => {
  const ftyp = box('ftyp', [...chars('avif'), 0, 0, 0, 0]);
  const exif = box('Exif', [0, 0, 0, 4, ...buildTiff({ Make: 'OldAv' }).bytes]);
  const hdlr = box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0, ...chars('pict'), 0]);
  const junk = [...u32be(4), ...chars('junk')];
  const meta = [...u32be(8 + hdlr.length + exif.length + junk.length), ...chars('meta'),
    ...hdlr, ...exif, ...junk];
  const orig = new Uint8Array([...ftyp, ...meta, ...box('mdat', [9])]);
  const info = await avifParser.parse(orig, '(test)');
  assertEquals(info.tags.Make, 'OldAv');
});
