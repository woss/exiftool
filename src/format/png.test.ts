import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { detectParser } from './mod.js';
import { pngParser } from './png.js';

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

/** One PNG chunk: u32be length + 4-byte type + payload + u32be CRC placeholder. */
function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(encoder.encode(type), 4);
  out.set(payload, 8);
  // CRC left as zeros; parser reads but never validates it.
  return out;
}

function ihdr(w: number, h: number): Uint8Array {
  const d = new Uint8Array(13);
  new DataView(d.buffer).setUint32(0, w, false);
  new DataView(d.buffer).setUint32(4, h, false);
  d[8] = 8; // bit depth
  d[9] = 2; // color type
  return chunk('IHDR', d);
}

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(...chunks_: Uint8Array[]): Uint8Array {
  return concat(PNG_SIG, ...chunks_);
}

test('png canParse accepts signature and rejects short/garbage', () => {
  assertEquals(pngParser.canParse(png(ihdr(1, 1))), true);
  assertEquals(pngParser.canParse(new Uint8Array(7)), false);
  assertEquals(pngParser.canParse(encoder.encode('NOTPNG!!')), false);
});

test('png IHDR extracts dimensions and color info', async () => {
  const result = await pngParser.parse(png(ihdr(320, 240), chunk('IEND', new Uint8Array(0))), 'a.png');
  assertEquals(result.format, 'PNG');
  assertEquals(result.tags['ImageWidth'], 320);
  assertEquals(result.tags['ImageLength'], 240);
  assertEquals(result.tags['BitDepth'], 8);
  assertEquals(result.tags['ColorType'], 'RGB');
});

test('png eXIf chunk parses embedded TIFF', async () => {
  // Minimal little-endian TIFF with Make="Cam\0" (inline, <=4 bytes).
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x010f, true);
  dv.setUint16(12, 2, true);
  dv.setUint32(14, 4, true);
  tiff.set(encoder.encode('Cam\0'), 18); // value field of the entry
  dv.setUint32(22, 0, true);

  const result = await pngParser.parse(
    png(ihdr(1, 1), chunk('eXIf', tiff), chunk('IEND', new Uint8Array(0))),
    'exif.png',
    undefined,
    { coordFormat: '%.6f' },
  );
  assertEquals(result.tags['Make'], 'Cam');
});

test('png iCCP exposes profile name before the NUL', async () => {
  const payload = concat(encoder.encode('sRGB IEC61966-2.1\0\x00\x00'), new Uint8Array(8));
  const result = await pngParser.parse(png(chunk('iCCP', payload), chunk('IEND', new Uint8Array(0))), 'icc.png');
  assertEquals(result.tags['ICC_Profile_Name'], 'sRGB IEC61966-2.1');
});

test('png iCCP without name NUL yields no tag', async () => {
  const result = await pngParser.parse(png(chunk('iCCP', encoder.encode('noname')), chunk('IEND', new Uint8Array(0))), 'icc.png');
  assertEquals('ICC_Profile_Name' in result.tags, false);
});

test('png tEXt keyword/value split on first NUL', async () => {
  const payload = encoder.encode('Title\0A Scene');
  const result = await pngParser.parse(png(chunk('tEXt', payload), chunk('IEND', new Uint8Array(0))), 'text.png');
  assertEquals(result.tags['PNG_Title'], 'A Scene');
});

test('png tEXt without separator or leading NUL is skipped', async () => {
  const noSep = await pngParser.parse(png(chunk('tEXt', encoder.encode('noseparator')), chunk('IEND', new Uint8Array(0))), 'a.png');
  const leadNul = await pngParser.parse(
    png(chunk('tEXt', new Uint8Array([0, 0x41])), chunk('IEND', new Uint8Array(0))),
    'b.png',
  );
  assertEquals(Object.keys(noSep.tags).filter((k) => k.startsWith('PNG_')).length, 0);
  assertEquals(Object.keys(leadNul.tags).filter((k) => k.startsWith('PNG_')).length, 0);
});

test('png iTXt uncompressed text extracted', async () => {
  const payload = concat(
    encoder.encode('Comment\0'),
    new Uint8Array([0, 0]), // compression flag 0, method 0
    encoder.encode('en\0'),
    encoder.encode('Hello\0'),
    encoder.encode('world text'),
  );
  const result = await pngParser.parse(png(chunk('iTXt', payload), chunk('IEND', new Uint8Array(0))), 'itxt.png');
  assertEquals(result.tags['PNG_Comment'], 'world text');
});

test('png iTXt compressed flag summarized instead of decoded', async () => {
  const payload = concat(
    encoder.encode('Comment\0'),
    new Uint8Array([1, 0]),
    encoder.encode('en\0\0'),
    new Uint8Array([0xde, 0xad]),
  );
  const result = await pngParser.parse(png(chunk('iTXt', payload), chunk('IEND', new Uint8Array(0))), 'ztxt.png');
  assertEquals(result.tags['PNG_Comment'], '[compressed:1]');
});

test('png iTXt malformed truncations bail out without throwing', async () => {
  const cases: Uint8Array[] = [
    encoder.encode('NoNulKeyword'), // null1 missing
    encoder.encode('K\0'), // no room for compression flag
    encoder.encode('K\0\x00'), // no room for method byte
    encoder.encode('K\0\x00\x00'), // no room past compression flag
    encoder.encode('K\0\x00\x00lang'), // language NUL missing
    encoder.encode('K\0\x00\x00lang\0'), // translated NUL missing
  ];
  for (const [i, payload] of cases.entries()) {
    const result = await pngParser.parse(
      png(chunk('iTXt', payload), chunk('IEND', new Uint8Array(0))),
      `bad${i}.png`,
    );
    assertEquals(Object.keys(result.tags).filter((k) => k.startsWith('PNG_')).length, 0);
  }
});

test('png gAMA converts gamma to float', async () => {
  const d = new Uint8Array(4);
  new DataView(d.buffer).setUint32(0, 45455, false);
  const result = await pngParser.parse(png(chunk('gAMA', d), chunk('IEND', new Uint8Array(0))), 'g.png');
  assertEquals(Math.abs((result.tags['Gamma'] as number) - 0.45455) < 1e-9, true);
});

test('png pHYs exposes pixel density', async () => {
  const d = new Uint8Array(9);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, 2835, false);
  dv.setUint32(4, 2835, false);
  d[8] = 1;
  const result = await pngParser.parse(png(chunk('pHYs', d), chunk('IEND', new Uint8Array(0))), 'p.png');
  assertEquals(result.tags['XPixelsPerUnit'], 2835);
  assertEquals(result.tags['YPixelsPerUnit'], 2835);
  assertEquals(result.tags['UnitSpecifier'], 1);
});

test('png trailing garbage shorter than a chunk header ends the walk', async () => {
  // No IEND present: the walker must bail via the short-header guard.
  const bytes = png(ihdr(1, 1), new Uint8Array([1, 2, 3, 4]));
  const result = await pngParser.parse(bytes, 'tail.png');
  assertEquals(result.tags['ImageWidth'], 1);
});

test('png chunk claiming impossible length stops the walk cleanly', async () => {
  const bogus = new Uint8Array(12);
  new DataView(bogus.buffer).setUint32(0, 0xffffff, false); // length beyond buffer
  bogus.set(encoder.encode('BOGUS'), 4);
  const bytes = png(ihdr(2, 3), bogus, chunk('IEND', new Uint8Array(0)));
  const result = await pngParser.parse(bytes, 'bogus.png');
  assertEquals(result.tags['ImageWidth'], 2);
});

test('detectParser routes PNG buffers to the png parser', () => {
  assertEquals(detectParser(png(ihdr(1, 1)), [pngParser])!.format, 'PNG');
});
