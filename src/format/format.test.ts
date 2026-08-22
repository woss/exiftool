import { assertEquals } from '../../deps.ts';
import { detectParser } from './mod.ts';
import type { FileInfo } from '../types.ts';
import './jpeg.ts';
import './png.ts';
import './webp.ts';
import './avif.ts';

function makeTiffExif(
  tags: Record<number, { type: number; value: number | string }>,
  littleEndian = false,
): Uint8Array {
  const le = littleEndian;
  const encoder = new TextEncoder();
  const entries: { tag: number; type: number; count: number; data: Uint8Array; offset: number }[] =
    [];
  let extraDataOffset = 8 + 2 + Object.keys(tags).length * 12 + 4;
  let extraData = new Uint8Array(0);

  for (const [tagStr, val] of Object.entries(tags)) {
    const tag = Number(tagStr);
    const { type, value } = val;
    let count = 1;
    let raw: Uint8Array;
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);

    switch (type) {
      case 3:
        dv.setUint16(0, value as number, le);
        raw = new Uint8Array(buf, 0, 2);
        break;
      case 4:
        dv.setUint32(0, value as number, le);
        raw = new Uint8Array(buf, 0, 4);
        break;
      case 2:
        raw = encoder.encode(value as string + '\0');
        count = raw.length;
        break;
      default:
        dv.setUint32(0, value as number, le);
        raw = new Uint8Array(buf, 0, 4);
    }

    const dataSize = raw.length;
    if (dataSize <= 4) {
      const padded = new Uint8Array(4);
      padded.set(raw);
      entries.push({ tag, type, count, data: padded, offset: 0 });
    } else {
      const newExtra = new Uint8Array(extraData.length + dataSize);
      newExtra.set(extraData);
      newExtra.set(raw, extraData.length);
      entries.push({ tag, type, count, data: new Uint8Array(4), offset: extraDataOffset });
      extraDataOffset += dataSize;
      extraData = newExtra;
    }
  }

  const numEntries = entries.length;
  const headerSize = 8;
  const ifdSize = 2 + numEntries * 12 + 4;
  const totalSize = headerSize + ifdSize + extraData.length;
  const result = new Uint8Array(totalSize);

  result[0] = le ? 0x49 : 0x4d;
  result[1] = le ? 0x49 : 0x4d;
  const write16 = (off: number, v: number) => {
    if (le) {
      result[off] = v & 0xff;
      result[off + 1] = (v >> 8) & 0xff;
    } else {
      result[off] = (v >> 8) & 0xff;
      result[off + 1] = v & 0xff;
    }
  };
  const write32 = (off: number, v: number) => {
    if (le) {
      result[off] = v & 0xff;
      result[off + 1] = (v >> 8) & 0xff;
      result[off + 2] = (v >> 16) & 0xff;
      result[off + 3] = (v >> 24) & 0xff;
    } else {
      result[off] = (v >> 24) & 0xff;
      result[off + 1] = (v >> 16) & 0xff;
      result[off + 2] = (v >> 8) & 0xff;
      result[off + 3] = v & 0xff;
    }
  };

  write16(2, 42);
  write32(4, 8);
  write16(8, numEntries);

  let entryOff = 10;
  for (const e of entries) {
    write16(entryOff, e.tag);
    write16(entryOff + 2, e.type);
    write32(entryOff + 4, e.count);
    if (e.offset !== 0) {
      write32(entryOff + 8, e.offset);
    } else {
      result.set(e.data, entryOff + 8);
    }
    entryOff += 12;
  }

  write32(entryOff, 0);
  if (extraData.length > 0) {
    result.set(extraData, headerSize + ifdSize);
  }

  return result;
}

Deno.test('detectParser JPEG', () => {
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
  ]);
  assertEquals(detectParser(bytes)?.format, 'JPEG');
});

Deno.test('detectParser PNG', () => {
  const bytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
  ]);
  assertEquals(detectParser(bytes)?.format, 'PNG');
});

Deno.test('detectParser WebP', () => {
  const bytes = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    0x00,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
  ]);
  assertEquals(detectParser(bytes)?.format, 'WebP');
});

Deno.test('detectParser AVIF', () => {
  const bytes = new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x20,
    0x66,
    0x74,
    0x79,
    0x70,
    0x61,
    0x76,
    0x69,
    0x66,
    0x00,
    0x00,
    0x00,
    0x00,
    0x61,
    0x76,
    0x69,
    0x66,
  ]);
  assertEquals(detectParser(bytes)?.format, 'AVIF');
});

Deno.test('JPEG parse — COM and SOF0', async () => {
  const encoder = new TextEncoder();
  const comData = encoder.encode('Test comment');
  const comSegLen = 2 + comData.length;

  const sofData = new Uint8Array(6);
  sofData[0] = 8; // precision
  new DataView(sofData.buffer, 1, 2).setUint16(0, 480, false); // height
  new DataView(sofData.buffer, 3, 2).setUint16(0, 640, false); // width
  const sofSegLen = 2 + sofData.length;

  const bytes = new Uint8Array(2 + 2 + comSegLen + 2 + sofSegLen);
  let off = 0;
  bytes[off++] = 0xff;
  bytes[off++] = 0xd8; // SOI
  bytes[off++] = 0xff;
  bytes[off++] = 0xfe; // COM
  const dv = new DataView(bytes.buffer);
  dv.setUint16(off, comSegLen, false);
  off += 2;
  bytes.set(comData, off);
  off += comData.length;
  bytes[off++] = 0xff;
  bytes[off++] = 0xc0; // SOF0
  dv.setUint16(off, sofSegLen, false);
  off += 2;
  bytes.set(sofData, off);
  off += sofData.length;

  const parser = detectParser(bytes)!;
  const result = await parser.parse(bytes, 'test.jpg');
  assertEquals(result.format, 'JPEG');
  assertEquals(result.tags['Comment'], 'Test comment');
  assertEquals(result.tags['ImageWidth'], 640);
  assertEquals(result.tags['ImageHeight'], 480);
});

Deno.test('JPEG parse — EXIF TIFF APP1', async () => {
  const tiff = makeTiffExif({
    0x010f: { type: 2, value: 'TestMake' },
    0x0110: { type: 2, value: 'TestModel' },
    0x0112: { type: 3, value: 1 },
  });

  const app1Data = new Uint8Array(6 + tiff.length);
  const encoder = new TextEncoder();
  app1Data.set(encoder.encode('Exif\0\0'), 0);
  app1Data.set(tiff, 6);
  const app1SegLen = 2 + app1Data.length;

  const bytes = new Uint8Array(2 + 2 + app1SegLen);
  let off = 0;
  bytes[off++] = 0xff;
  bytes[off++] = 0xd8;
  bytes[off++] = 0xff;
  bytes[off++] = 0xe1;
  const dv = new DataView(bytes.buffer);
  dv.setUint16(off, app1SegLen, false);
  off += 2;
  bytes.set(app1Data, off);

  const parser = detectParser(bytes)!;
  const result = await parser.parse(bytes, 'test.jpg');
  assertEquals(result.tags['Make'], 'TestMake');
  assertEquals(result.tags['Model'], 'TestModel');
  assertEquals(result.tags['Orientation'], 'Horizontal (normal)');
});

Deno.test('PNG parse — IHDR and eXIf', async () => {
  const encoder = new TextEncoder();
  const ihdrData = new Uint8Array(13);
  new DataView(ihdrData.buffer).setUint32(0, 100, false); // width
  new DataView(ihdrData.buffer, 4).setUint32(0, 200, false); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // RGBA

  function crc32(data: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      c ^= data[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return ~c >>> 0;
  }

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = encoder.encode(type);
    const crcData = new Uint8Array(typeBytes.length + data.length);
    crcData.set(typeBytes);
    crcData.set(data, typeBytes.length);
    const crc = crc32(crcData);
    const ch = new Uint8Array(4 + 4 + data.length + 4);
    new DataView(ch.buffer).setUint32(0, data.length, false);
    ch.set(typeBytes, 4);
    ch.set(data, 8);
    new DataView(ch.buffer, 4 + 4 + data.length).setUint32(0, crc, false);
    return ch;
  }

  const tiff = makeTiffExif({
    0x010f: { type: 2, value: 'PNGMake' },
    0x0110: { type: 2, value: 'PNGModel' },
  }, true);

  const exifData = new Uint8Array(tiff.length);
  exifData.set(tiff);

  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    header,
    chunk('IHDR', ihdrData),
    chunk('eXIf', exifData),
    chunk('IEND', new Uint8Array(0)),
  ];
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const bytes = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) {
    bytes.set(p, off);
    off += p.length;
  }

  const parser = detectParser(bytes)!;
  const result = await parser.parse(bytes, 'test.png');
  assertEquals(result.format, 'PNG');
  assertEquals(result.tags['ImageWidth'], 100);
  assertEquals(result.tags['ImageLength'], 200);
  assertEquals(result.tags['ImageHeight'], 200);
  assertEquals(result.tags['Make'], 'PNGMake');
  assertEquals(result.tags['Model'], 'PNGModel');
});
