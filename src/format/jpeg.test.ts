import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { detectParser } from './mod.js';
import { jpegParser } from './jpeg.js';
import { chmod, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function pack(vals: number[], width: 2 | 4, le: boolean): Uint8Array {
  const out = new Uint8Array(vals.length * width);
  const dv = new DataView(out.buffer);
  for (const [i, v] of vals.entries()) {
    if (width === 2) dv.setUint16(i * 2, v, le);
    else dv.setUint32(i * 4, v, le);
  }
  return out;
}

/** One JPEG segment: FF marker + u16be length (incl. the 2 length bytes). */
function seg(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + 2 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  new DataView(out.buffer).setUint16(2, payload.length + 2, false);
  out.set(payload, 4);
  return out;
}

/** Minimal little-endian TIFF: header + IFD0 (Make) [+ value pool] [+ next ptr]. */
function tinyTiffLE(make: string): Uint8Array {
  const value = encoder.encode(make + '\0');
  const inline = value.length <= 4;
  const poolOff = 8 + 2 + 12 + 4; // after IFD0 (count + entry + next)
  const total = inline ? poolOff : poolOff + value.length;
  const tiff = new Uint8Array(total);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true); // entry count
  dv.setUint16(10, 0x010f, true); // Make
  dv.setUint16(12, 2, true); // ASCII
  dv.setUint32(14, value.length, true);
  if (inline) tiff.set(value, 18);
  else {
    dv.setUint32(18, poolOff, true);
    tiff.set(value, poolOff);
  }
  dv.setUint32(22, 0, true); // no next IFD
  return tiff;
}
function exifApp1(tiffBytes: Uint8Array): Uint8Array {
  return seg(0xe1, concat(encoder.encode('Exif\0\0'), tiffBytes));
}

const XMP_IDENT = 'http://ns.adobe.com/xap/1.0/\0';

function xmpApp1(attrs: string, withIdent = true): Uint8Array {
  const xml =
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description ${attrs}/></rdf:RDF></x:xmpmeta>`;
  return seg(0xe1, concat(encoder.encode(withIdent ? XMP_IDENT : 'https://example.com/\0'), encoder.encode(xml)));
}

test('jpeg canParse checks SOI marker', () => {
  assertEquals(jpegParser.canParse(new Uint8Array([0xff, 0xd8])), true);
  assertEquals(jpegParser.canParse(new Uint8Array([0xff, 0xd9])), false);
});

test('jpeg walk breaks on non-marker byte', async () => {
  const bytes = concat(new Uint8Array([0xff, 0xd8]), encoder.encode('garbage'));
  const result = await jpegParser.parse(bytes, 'a.jpg');
  assertEquals(result.format, 'JPEG');
});

test('jpeg walk breaks when only fill bytes remain', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xff]);
  const result = await jpegParser.parse(bytes, 'b.jpg');
  assertEquals(result.tags['Comment'], undefined);
});

test('jpeg walk breaks on 0x00 stuffed byte', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  await jpegParser.parse(bytes, 'c.jpg');
});

test('jpeg skips RST and TEM markers without length fields', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd0, 0xff, 0xd1, 0xff, 0x01]);
  const result = await jpegParser.parse(bytes, 'd.jpg');
  assertEquals(result.format, 'JPEG');
});

test('jpeg SOS marker ends header traversal', async () => {
  const sos = new Uint8Array([0xff, 0xda, 0x00, 0x04, 0x01, 0x11]);
  const com = seg(0xfe, encoder.encode('before'));
  const bytes = concat(new Uint8Array([0xff, 0xd8]), com, sos, seg(0xfe, encoder.encode('after')));
  const result = await jpegParser.parse(bytes, 'e.jpg');
  assertEquals(result.tags['Comment'], 'before');
});

test('jpeg breaks on truncated segment length', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const result = await jpegParser.parse(bytes, 'f.jpg');
  assertEquals(result.format, 'JPEG');
});

test('jpeg breaks on degenerate zero segment length', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
  const result = await jpegParser.parse(bytes, 'g.jpg');
  assertEquals(result.format, 'JPEG');
});

test('jpeg COM comment extracted', async () => {
  const bytes = concat(new Uint8Array([0xff, 0xd8]), seg(0xfe, encoder.encode('hello comment')));
  const result = await jpegParser.parse(bytes, 'h.jpg');
  assertEquals(result.tags['Comment'], 'hello comment');
});

function sof(marker: number, precision: number, h: number, w: number, comps: number[][]): Uint8Array {
  const payload = new Uint8Array(6 + comps.length * 3);
  payload[0] = precision;
  payload[1] = h >> 8;
  payload[2] = h & 0xff;
  payload[3] = w >> 8;
  payload[4] = w & 0xff;
  payload[5] = comps.length;
  comps.forEach((c, i) => {
    payload[6 + i * 3] = c[0];
    payload[6 + i * 3 + 1] = c[1];
    payload[6 + i * 3 + 2] = c[2];
  });
  return seg(marker, payload);
}

test('jpeg SOF variants expose encoding and sampling', async () => {
  const base = new Uint8Array([0xff, 0xd8]);

  const c0 = await jpegParser.parse(
    concat(base, sof(0xc0, 8, 240, 320, [[1, 0x11, 0], [2, 0x11, 1], [3, 0x11, 2]])),
    's0.jpg',
  );
  assertEquals(c0.tags['EncodingProcess'], 'Baseline DCT, Huffman coding');
  assertEquals(c0.tags['ImageHeight'], 240);
  assertEquals(c0.tags['ImageWidth'], 320);
  assertEquals(c0.tags['ColorComponents'], 3);
  assertEquals(c0.tags['YCbCrSubSampling'], 'YCbCr4:4:4 (1 1)');

  const c1 = await jpegParser.parse(
    concat(base, sof(0xc1, 8, 100, 100, [[1, 0x21, 0], [2, 0x11, 1], [3, 0x11, 2]])),
    's1.jpg',
  );
  assertEquals(c1.tags['EncodingProcess'], 'Extended sequential DCT, Huffman coding');
  assertEquals(c1.tags['YCbCrSubSampling'], 'YCbCr4:2:2 (2 1)');

  const c2 = await jpegParser.parse(
    concat(base, sof(0xc2, 8, 100, 100, [[1, 0x22, 0], [2, 0x11, 1], [3, 0x11, 2]])),
    's2.jpg',
  );
  assertEquals(c2.tags['EncodingProcess'], 'Progressive DCT, Huffman coding');
  assertEquals(c2.tags['YCbCrSubSampling'], 'YCbCr4:2:0 (2 2)');

  const c3 = await jpegParser.parse(
    concat(base, sof(0xc3, 8, 100, 100, [[1, 0x41, 0], [2, 0x11, 1], [3, 0x11, 2]])),
    's3.jpg',
  );
  assertEquals(c3.tags['EncodingProcess'], 'Lossless (sequential), Huffman coding');
  assertEquals(c3.tags['YCbCrSubSampling'], 'YCbCr4:4:1 (1 1)');

  // Grayscale: too few components -> no subsampling key.
  const gray = await jpegParser.parse(concat(base, sof(0xc0, 8, 100, 100, [[1, 0x11, 0]])), 'sg.jpg');
  assertEquals(gray.tags['ColorComponents'], 1);
  assertEquals('YCbCrSubSampling' in gray.tags, false);
});
test('jpeg APP1 Exif little-endian tags merged', async () => {
  const bytes = concat(new Uint8Array([0xff, 0xd8]), exifApp1(tinyTiffLE('CamLE')));
  const result = await jpegParser.parse(bytes, 'exif-le.jpg');
  assertEquals(result.tags['Make'], 'CamLE');
  assertEquals(result.tags['ExifByteOrder'], 'Little-endian (Intel, II)');
});

test('jpeg APP1 Exif big-endian byte order reported', async () => {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x4d;
  tiff[1] = 0x4d;
  dv.setUint16(2, 42, false);
  dv.setUint32(4, 8, false);
  dv.setUint16(8, 1, false);
  dv.setUint16(10, 0x010f, false);
  dv.setUint16(12, 2, false);
  dv.setUint32(14, 4, false);
  tiff.set(encoder.encode('BE\0\0'), 18);
  dv.setUint32(22, 0, false);

  const bytes = concat(new Uint8Array([0xff, 0xd8]), exifApp1(tiff));
  const result = await jpegParser.parse(bytes, 'exif-be.jpg');
  assertEquals(result.tags['ExifByteOrder'], 'Big-endian (Motorola, MM)');
});

test('jpeg thumbnail offset made absolute and image sliced', async () => {
  // Hand-built TIFF: IFD0 (Make inline, next->IFD1), IFD1 thumb ptr+len, thumb bytes.
  const thumb = encoder.encode('THUMBDATA000000'); // 15 bytes
  const ifd0Off = 8;
  const ifd0End = ifd0Off + 2 + 12 + 4;
  const ifd1Off = ifd0End;
  const ifd1End = ifd1Off + 2 + 24 + 4;
  const thumbRel = ifd1End;

  const tiff = new Uint8Array(ifd1End + thumb.length);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(ifd0Off, 1, true);
  dv.setUint16(ifd0Off + 2, 0x010f, true);
  dv.setUint16(ifd0Off + 4, 2, true);
  dv.setUint32(ifd0Off + 6, 4, true);
  tiff.set(encoder.encode('Cam\0'), ifd0Off + 10);
  dv.setUint32(ifd0Off + 14, ifd1Off, true); // next IFD
  dv.setUint16(ifd1Off, 2, true);
  dv.setUint16(ifd1Off + 2, 0x0201, true); // ThumbnailOffset
  dv.setUint16(ifd1Off + 4, 4, true);
  dv.setUint32(ifd1Off + 6, 1, true);
  dv.setUint32(ifd1Off + 10, thumbRel, true);
  dv.setUint16(ifd1Off + 14, 0x0202, true); // ThumbnailLength
  dv.setUint16(ifd1Off + 16, 4, true);
  dv.setUint32(ifd1Off + 18, 1, true);
  dv.setUint32(ifd1Off + 22, thumb.length, true);
  dv.setUint32(ifd1Off + 26, 0, true);
  tiff.set(thumb, thumbRel);

  const app1PayloadLen = 6 + tiff.length + 2;
  const bytes = concat(new Uint8Array([0xff, 0xd8]), exifApp1(concat(tiff, new Uint8Array(0))), new Uint8Array(app1PayloadLen));
  // Rebuild precisely: SOI(2) + seg header(4) + payload; payload starts at 6.
  const file = concat(new Uint8Array([0xff, 0xd8]), exifApp1(concat(tiff, thumb)));
  const tiffFileOffset = 2 + 4 + 6; // SOI + seg header + 'Exif\0\0'
  const result = await jpegParser.parse(file, 'thumb.jpg');

  assertEquals(result.tags['ThumbnailImage'], thumb);
  assertEquals(result.tags['ThumbnailOffset'], tiffFileOffset + thumbRel);
  void bytes;
});

test('jpeg multi-APP1 keeps Exif and XMP side by side', async () => {
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    exifApp1(tinyTiffLE('DualCam')),
    xmpApp1('tiff:Make="XMPCam" dc:subject="subj"'),
  );
  const result = await jpegParser.parse(bytes, 'multi.jpg');
  assertEquals(result.tags['Make'], 'DualCam'); // EXIF wins; XMP must not overwrite
  assertEquals(result.tags['Subject'], 'subj');
});

test('jpeg XMP APP1 without full ident parses from byte 0', async () => {
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    seg(0xe1, concat(encoder.encode('http://wrong.example/\0x'), encoder.encode(
      '<x:xmpmeta><rdf:RDF><rdf:Description dc:subject="bare"/></rdf:RDF></x:xmpmeta>',
    ))),
  );
  const result = await jpegParser.parse(bytes, 'bare-xmp.jpg');
  assertEquals(result.tags['Subject'], 'bare');
});

test('jpeg derives DerivedFrom* tags from XMP history', async () => {
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    xmpApp1('stEvt:instanceID="xmp.iid:AAA"'),
  );
  const result = await jpegParser.parse(bytes, 'hist.jpg');
  assertEquals(result.tags['DerivedFromInstanceID'], 'xmp.iid:AAA');
  assertEquals(result.tags['DerivedFromDocumentID'], 'xmp.did:AAA');
});

test('jpeg derives DerivedFromOriginalDocumentID', async () => {
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    xmpApp1('xmpMM:OriginalDocumentID="orig-doc"'),
  );
  const result = await jpegParser.parse(bytes, 'orig.jpg');
  assertEquals(result.tags['DerivedFromOriginalDocumentID'], 'orig-doc');
});

test('jpeg MPF APP2 flagged present', async () => {
  const bytes = concat(new Uint8Array([0xff, 0xd8]), seg(0xe2, encoder.encode('MPF\0rest')));
  const result = await jpegParser.parse(bytes, 'mpf.jpg');
  assertEquals(result.tags['MPF'], 'present');
});

test('jpeg valid ICC profile parsed', async () => {
  const profile = new Uint8Array(132);
  const dv = new DataView(profile.buffer);
  dv.setUint32(0, 132, false);
  profile.set(encoder.encode('mntr'), 12);
  const payload = concat(encoder.encode('ICC_PROFILE\0'), new Uint8Array([0, 1]), profile);
  const bytes = concat(new Uint8Array([0xff, 0xd8]), seg(0xe2, payload));
  const result = await jpegParser.parse(bytes, 'icc.jpg');
  assertEquals(result.tags['ProfileClass'], 'Display Device Profile');
});

test('jpeg IPTC keywords and dates composed from Photoshop APP13', async () => {
  function iptcDs(rec: number, ds: number, val: string): Uint8Array {
    const v = encoder.encode(val);
    return concat(new Uint8Array([0x1c, rec, ds]), pack([v.length], 2, false), v);
  }
  const iptc = concat(
    iptcDs(2, 25, 'kw1'),
    iptcDs(2, 25, 'kw2'),
    iptcDs(2, 55, '20240102'),
    iptcDs(2, 60, '123000'),
    iptcDs(2, 62, '20230101'),
    iptcDs(2, 63, '091500'),
  );
  const bim = concat(encoder.encode('8BIM'), pack([0x0404], 2, false), new Uint8Array([0, 0]), pack([iptc.length], 4, false), iptc);
  const psBlock = concat(encoder.encode('Photoshop 3.0\0'), bim);
  const bytes = concat(new Uint8Array([0xff, 0xd8]), seg(0xed, psBlock));

  const result = await jpegParser.parse(bytes, 'iptc.jpg');
  assertEquals(result.tags['Keywords'], ['kw1', 'kw2']);
  assertEquals(result.tags['DateTimeCreated'], '2024:01:02 12:30:00');
  assertEquals(result.tags['TimeCreated'], '12:30:00');
  assertEquals(result.tags['DigitalCreationDateTime'], '2023:01:01 09:15:00');
  assertEquals(result.tags['DigitalCreationDate'], '2023:01:01');
  assertEquals(result.tags['DigitalCreationTime'], '09:15:00');
});

test('jpeg Subject merged into existing Keywords list', async () => {
  function iptcDs(ds: number, val: string): Uint8Array {
    const v = encoder.encode(val);
    return concat(new Uint8Array([0x1c, 2, ds]), pack([v.length], 2, false), v);
  }
  const iptc = iptcDs(25, 'kw1');
  const bim = concat(encoder.encode('8BIM'), pack([0x0404], 2, false), new Uint8Array([0, 0]), pack([iptc.length], 4, false), iptc);
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    seg(0xed, concat(encoder.encode('Photoshop 3.0\0'), bim)),
    xmpApp1('dc:subject="subj"'),
  );
  const result = await jpegParser.parse(bytes, 'merge.jpg');
  assertEquals(result.tags['Keywords'], ['kw1', 'subj']);
});

test('jpeg lone Subject promoted to Keywords', async () => {
  const bytes = concat(new Uint8Array([0xff, 0xd8]), xmpApp1('dc:subject="only-subj"'));
  const result = await jpegParser.parse(bytes, 'subj.jpg');
  assertEquals(result.tags['Keywords'], 'only-subj');
});

test('jpeg APP14 Adobe exposes DCT flags and color transform', async () => {
  function adobe(ct: number, flags0 = 0, flags1 = 0): Uint8Array {
    const payload = concat(
      encoder.encode('Adobe'),
      pack([0x0100, flags0, flags1], 2, false),
      new Uint8Array([ct]),
    );
    return seg(0xee, payload);
  }
  const base = new Uint8Array([0xff, 0xd8]);

  const ycbcr = await jpegParser.parse(concat(base, adobe(1)), 'adobe1.jpg');
  assertEquals(ycbcr.tags['DCTEncodeVersion'], 256);
  assertEquals(ycbcr.tags['APP14Flags0'], '[], ');
  assertEquals(ycbcr.tags['APP14Flags1'], '(none)');
  assertEquals(ycbcr.tags['ColorTransform'], 'YCbCr');

  const withBlend = await jpegParser.parse(concat(base, adobe(2, 1 << 14, 7)), 'adobe2.jpg');
  assertEquals(withBlend.tags['APP14Flags0'], '[14], Encoded with Blend=1 downsampling');
  assertEquals(withBlend.tags['APP14Flags1'], '[7]');
  assertEquals(withBlend.tags['ColorTransform'], 'YCCK');

  const unknownCt = await jpegParser.parse(concat(base, adobe(9)), 'adobe3.jpg');
  assertEquals(unknownCt.tags['ColorTransform'], 'Unknown');
});

test('jpeg file metadata reflects real temp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'exiftool-ts-'));
  try {
    const tiny = `${dir}/tiny.jpg`;
    await writeFile(tiny, concat(new Uint8Array([0xff, 0xd8]), seg(0xfe, encoder.encode('x'))));
    const small = await jpegParser.parse(await readFile(tiny), tiny);
    assertEquals(small.tags['FileName'], 'tiny.jpg');
    assertEquals(small.tags['Directory'], dir);
    assertEquals(small.tags['SourceFile'], tiny);
    assertEquals(small.tags['FileSize'], `${(await stat(tiny)).size} B`);
    assertEquals(small.tags['FileType'], 'JPEG');
    assertEquals(typeof small.tags['FileModifyDate'], 'string');
    assertEquals(small.tags['FilePermissions'], '-rw-r--r--');

    const big = `${dir}/big.jpg`;
    const fh = await open(big, 'w');
    await fh.truncate(2048);
    await fh.close();
    const bigResult = await jpegParser.parse(await readFile(big), big);
    assertEquals(bigResult.tags['FileSize'], '2 kB');

    const huge = `${dir}/huge.jpg`;
    const fh2 = await open(huge, 'w');
    await fh2.truncate(1048576 * 1.5 | 0);
    await fh2.close();
    const hugeResult = await jpegParser.parse(await readFile(huge), huge);
    assertEquals(hugeResult.tags['FileSize'], '1.6 MB');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('jpeg stat failure leaves file metadata minimal', async () => {
  const result = await jpegParser.parse(new Uint8Array([0xff, 0xd8]), '/nonexistent-dir/nope.jpg');
  assertEquals(result.tags['FileName'], 'nope.jpg');
  assertEquals('FileSize' in result.tags, false);
});

test('detectParser routes JPEG buffers', () => {
  assertEquals(detectParser(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), [jpegParser])!.format, 'JPEG');
});

test('jpeg unknown APP1 payload is skipped silently', async () => {
  const bytes = concat(new Uint8Array([0xff, 0xd8]), seg(0xe1, encoder.encode('XXopaque-data')));
  const result = await jpegParser.parse(bytes, 'unknown-app1.jpg');
  assertEquals('Subject' in result.tags, false);
});

test('jpeg duplicate Subject is not appended twice', async () => {
  function iptcDs(ds: number, val: string): Uint8Array {
    const v = encoder.encode(val);
    return concat(new Uint8Array([0x1c, 2, ds]), pack([v.length], 2, false), v);
  }
  const iptc = iptcDs(25, 'kw1');
  const bim = concat(encoder.encode('8BIM'), pack([0x0404], 2, false), new Uint8Array([0, 0]), pack([iptc.length], 4, false), iptc);
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    seg(0xed, concat(encoder.encode('Photoshop 3.0\0'), bim)),
    xmpApp1('dc:subject="kw1"'),
  );
  const result = await jpegParser.parse(bytes, 'dup.jpg');
  assertEquals(result.tags['Keywords'], ['kw1']);
});

test('jpeg explicit DerivedFrom wins over History derivation', async () => {
  const bytes = concat(
    new Uint8Array([0xff, 0xd8]),
    xmpApp1('stEvt:instanceID="xmp.iid:HIST" stRef:instanceID="direct-id"'),
  );
  const result = await jpegParser.parse(bytes, 'derived.jpg');
  assertEquals(result.tags['DerivedFromInstanceID'], 'direct-id');
});

test('jpeg permissions rendering covers set and unset bits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'exiftool-ts-'));
  try {
    const a = `${dir}/a755.jpg`;
    await writeFile(a, new Uint8Array([0xff, 0xd8]));
    await chmod(a, 0o755);
    const ra = await jpegParser.parse(await readFile(a), a);
    assertEquals(ra.tags['FilePermissions'], '-rwxr-xr-x');

    const b = `${dir}/b462.jpg`;
    await writeFile(b, new Uint8Array([0xff, 0xd8]));
    await chmod(b, 0o462);
    const rb = await jpegParser.parse(await readFile(b), b);
    assertEquals(rb.tags['FilePermissions'], '-r--rw--w-');

    // A directory path flips the type bit.
    const rd = await jpegParser.parse(new Uint8Array([0xff, 0xd8]), dir);
    assertEquals((rd.tags['FilePermissions'] as string)[0], 'd');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
