import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { detectParser } from './mod.js';
import { webpParser } from './webp.js';

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** One RIFF chunk: 4-byte id + u32le size + payload (+ pad byte when odd). */
function chunk(id: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length + (payload.length & 1);
  const out = new Uint8Array(8 + padded);
  out.set(encoder.encode(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

/** Full RIFF/WEBP file: 'RIFF' + u32le size + 'WEBP' + chunks. */
function riff(...chunks_: Uint8Array[]): Uint8Array {
  const body = concat(encoder.encode('WEBP'), ...chunks_);
  const out = new Uint8Array(8 + body.length);
  out.set(encoder.encode('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/** Minimal little-endian TIFF with a single ASCII tag (out-of-line). */
function tinyTiff(): Uint8Array {
  const value = encoder.encode('TestCam\0');
  const ifdSize = 2 + 12 + 4;
  const total = 8 + ifdSize + value.length;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49;
  buf[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x010f, true); // Make
  dv.setUint16(12, 2, true); // ASCII
  dv.setUint32(14, value.length, true);
  dv.setUint32(18, 8 + ifdSize, true);
  dv.setUint32(22, 0, true);
  buf.set(value, 8 + ifdSize);
  return buf;
}

test('webp canParse accepts RIFF/WEBP header and rejects short/garbage', () => {
  assertEquals(webpParser.canParse(riff()), true);
  assertEquals(webpParser.canParse(new Uint8Array(11)), false);
  const notRiff = encoder.encode('NOTRIFFxxWEBPxx');
  assertEquals(webpParser.canParse(notRiff), false);
  const riffOnly = concat(encoder.encode('RIFF'), new Uint8Array(16));
  assertEquals(webpParser.canParse(riffOnly), false);
});

test('webp VP8X flags and canvas dimensions', async () => {
  // flags: anim 0x02 | xmp 0x04 | exif 0x08 | alpha 0x10 | icc 0x20
  const vp8xData = new Uint8Array(10);
  vp8xData[0] = 0x3e;
  vp8xData[1] = 1; // width-1 = 1 -> 2
  vp8xData[4] = 2; // height-1 = 2 -> 3
  const bytes = riff(chunk('VP8X', vp8xData));

  const result = await webpParser.parse(bytes, 'a.webp');
  assertEquals(result.format, 'WebP');
  assertEquals(result.tags['WebP_Extended'], true);
  assertEquals(result.tags['WebP_Anim'], true);
  assertEquals(result.tags['WebP_XMP'], true);
  assertEquals(result.tags['WebP_EXIF'], true);
  assertEquals(result.tags['WebP_Alpha'], true);
  assertEquals(result.tags['WebP_ICC'], true);
  assertEquals(result.tags['ImageWidth'], 2);
  assertEquals(result.tags['ImageLength'], 3);
});

test('webp EXIF chunk with Exif\\0\\0 prefix parses TIFF tags', async () => {
  const tiff = tinyTiff();
  const payload = concat(encoder.encode('Exif\0\0'), tiff);
  const bytes = riff(chunk('EXIF', payload), chunk('VP8 ', new Uint8Array(4)));

  const result = await webpParser.parse(bytes, 'exif.webp');
  assertEquals(result.tags['Make'], 'TestCam');
  assertEquals(result.tags['WebP_Lossy'], true);
});
test('webp short EXIF chunk (<6 bytes) cannot be TIFF, yields no tags', async () => {
  // chunkData.length < 6 takes the whole-chunk parseTiff path; a sub-6-byte
  // blob can never carry the 8-byte TIFF header, so it resolves to {}.
  const bytes = riff(chunk('EXIF', new Uint8Array([0x49, 0x49, 0x2a, 0x00])));
  const result = await webpParser.parse(bytes, 'short.webp');
  assertEquals(result.tags['Make'], undefined);
});

test('webp XMP chunk over 1024 chars summarized', async () => {
  const xmp = 'x'.repeat(2000);
  const bytes = riff(chunk('XMP ', encoder.encode(xmp)));
  const result = await webpParser.parse(bytes, 'bigxmp.webp');
  assertEquals(result.tags['XMP'], `[XML document: ${xmp.length} chars]`);
});

test('webp EXIF parse threads coordFormat hint into TIFF parsing', async () => {
  const tiff = tinyTiff();
  const payload = concat(encoder.encode('Exif\0\0'), tiff);
  const bytes = riff(chunk('EXIF', payload));
  const result = await webpParser.parse(bytes, 'hint.webp', undefined, { coordFormat: '%.6f' });
  assertEquals(result.tags['Make'], 'TestCam');
});

test('webp non-TIFF short EXIF chunk yields no tags without throwing', async () => {
  const bytes = riff(chunk('EXIF', encoder.encode('junk')), chunk('VP8L', new Uint8Array(4)));
  const result = await webpParser.parse(bytes, 'junk.webp');
  assertEquals(result.tags['Make'], undefined);
  assertEquals(result.tags['WebP_Lossless'], true);
});

test('webp ICCP chunk: small inlined raw, large summarized', async () => {
  const small = new Uint8Array(16).fill(7);
  const big = new Uint8Array(100).fill(9);
  const bytes = riff(chunk('ICCP', small), chunk('ICCP', big));

  const result = await webpParser.parse(bytes, 'icc.webp');
  assertEquals(result.tags['ICC_Profile'], `[ICC profile: ${big.length} bytes]`);
  const firstIcc = result.tags['ICC_Profile'];
  // The large profile overwrote the small one; verify summary format only.
  assertEquals(typeof firstIcc === 'string' || firstIcc instanceof Uint8Array, true);

  const onlySmall = await webpParser.parse(riff(chunk('ICCP', small)), 'icc2.webp');
  assertEquals((onlySmall.tags['ICC_Profile'] as Uint8Array).length, 16);
});

test('webp XMP chunk stores text inline when short', async () => {
  const xmp = '<x:xmpmeta>hi</x:xmpmeta>';
  const bytes = riff(chunk('XMP ', encoder.encode(xmp)));
  const result = await webpParser.parse(bytes, 'xmp.webp');
  assertEquals(result.tags['XMP'], xmp);
});

test('webp ANIM chunk exposes background color and loop count', async () => {
  const payload = new Uint8Array(8);
  new DataView(payload.buffer).setUint32(0, 0xaabbccdd, true);
  new DataView(payload.buffer).setUint16(4, 3, true);
  const bytes = riff(chunk('ANIM', payload));
  const result = await webpParser.parse(bytes, 'anim.webp');
  assertEquals(result.tags['WebP_Anim'], true);
  assertEquals(result.tags['WebP_BackgroundColor'], 0xaabbccdd);
  assertEquals(result.tags['WebP_LoopCount'], 3);
});

test('webp odd-size chunk pad byte is skipped so following chunks parse', async () => {
  const xmp = encoder.encode('abc'); // odd length -> one pad byte
  const bytes = riff(chunk('XMP ', xmp), chunk('VP8L', new Uint8Array(2)));
  const result = await webpParser.parse(bytes, 'pad.webp');
  assertEquals(result.tags['XMP'], 'abc');
  assertEquals(result.tags['WebP_Lossless'], true);
});

test('webp zero RIFF size walks nothing', async () => {
  const bytes = riff(chunk('VP8X', new Uint8Array(10)));
  // Overwrite declared RIFF size with 0.
  new DataView(bytes.buffer).setUint32(4, 0, true);
  const result = await webpParser.parse(bytes, 'zero.webp');
  assertEquals(result.format, 'WebP');
  assertEquals('WebP_Extended' in result.tags, false);
});

test('webp truncated chunk size stops the walk cleanly', async () => {
  const good = chunk('VP8L', new Uint8Array(2));
  const bogus = new Uint8Array(8);
  bogus.set(encoder.encode('FAKE'), 0);
  new DataView(bogus.buffer).setUint32(4, 5000, true); // far beyond buffer
  const bytes = riff(good, bogus);
  const result = await webpParser.parse(bytes, 'trunc.webp');
  assertEquals(result.tags['WebP_Lossless'], true);
  assertEquals('Make' in result.tags, false);
});

test('webp parse tolerates garbage body without RIFF semantics', async () => {
  const garbage = new Uint8Array(64).fill(0xff);
  const result = await webpParser.parse(garbage, 'garbage.webp');
  assertEquals(result.path, 'garbage.webp');
  assertEquals(result.format, 'WebP');
});

test('detectParser routes WebP buffers to the webp parser', () => {
  const parser = detectParser(riff(chunk('VP8 ', new Uint8Array(4))), [webpParser])!;
  assertEquals(parser.format, 'WebP');
});
