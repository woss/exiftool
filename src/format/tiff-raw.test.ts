import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { detectParser } from './mod.js';
import { tiffRawParser } from './tiff-raw.js';
import { ExifTool } from '../exiftool.js';
import { computeCompositeTags } from '../exif/composite.js';

const tool = new ExifTool();

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Synthetic TIFF fixtures (same shape as src/exif/tiff.test.ts buildTiff)
// ---------------------------------------------------------------------------

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

type Val =
  | { tag: number; type: number; raw: Uint8Array }
  | { tag: number; ptr: number }; // LONG inline pointer to IFD index

function ascii(s: string): Uint8Array {
  return encoder.encode(s + '\0');
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

function rational(num: number, den: number, le: boolean): Uint8Array {
  return pack([num, den], 4, le);
}

function buildTiff(le: boolean, ifds: Val[][], magic = 42): Uint8Array {
  let pos = 8;
  const ifdOffsets = ifds.map((es) => {
    const off = pos;
    pos += 2 + es.length * 12 + 4;
    return off;
  });
  const poolBase = pos;
  const ptrs: (number | undefined)[][] = ifds.map(() => []);
  const pool: Uint8Array[] = [];
  ifds.forEach((es, i) =>
    es.forEach((e, j) => {
      if ('raw' in e && e.raw.length > 4) {
        ptrs[i][j] = poolBase + pool.reduce((n, c) => n + c.length, 0);
        pool.push(e.raw);
      }
    })
  );
  const total = poolBase + pool.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = le ? 0x49 : 0x4d;
  buf[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, magic, le);
  dv.setUint32(4, 8, le);
  const w16 = (o: number, v: number) => dv.setUint16(o, v, le);
  const w32 = (o: number, v: number) => dv.setUint32(o, v, le);
  ifds.forEach((es, i) => {
    w16(ifdOffsets[i], es.length);
    es.forEach((e, j) => {
      const eo = ifdOffsets[i] + 2 + j * 12;
      w16(eo, e.tag);
      if ('ptr' in e) {
        w16(eo + 2, 4); // LONG
        w32(eo + 4, 1);
        w32(eo + 8, ifdOffsets[e.ptr]);
        return;
      }
      w16(eo + 2, e.type);
      w32(eo + 4, Math.max(1, e.raw.length / TYPE_SIZE[e.type]));
      const p = ptrs[i][j];
      if (p === undefined) buf.set(e.raw, eo + 8);
      else w32(eo + 8, p);
    });
    w32(ifdOffsets[i] + 2 + es.length * 12, 0); // no next-IFD chain by default
  });
  let po = poolBase;
  for (const c of pool) {
    buf.set(c, po);
    po += c.length;
  }
  return buf;
}

function leU16(bytes: Uint8Array): number {
  return bytes[2] | (bytes[3] << 8);
}

function withMake(make: string): Uint8Array {
  return buildTiff(true, [[{ tag: 0x010f, type: 2, raw: ascii(make) }]]);
}

// ---------------------------------------------------------------------------
// canParse / detection
// ---------------------------------------------------------------------------

test('tiff-raw: accepts little- and big-endian magic 42', () => {
  assertEquals(tiffRawParser.canParse(buildTiff(true, [[]])), true);
  assertEquals(tiffRawParser.canParse(buildTiff(false, [[]])), true);
});

test('tiff-raw: accepts Panasonic magic 85', () => {
  const bytes = buildTiff(true, [[{ tag: 0x010f, type: 2, raw: ascii('Panasonic') }]], 85);
  assertEquals(leU16(bytes), 85);
  assertEquals(tiffRawParser.canParse(bytes), true);
});

test('tiff-raw: rejects non-TIFF and short buffers', () => {
  assertEquals(tiffRawParser.canParse(encoder.encode('not a tiff at all')), false);
  assertEquals(tiffRawParser.canParse(new Uint8Array([0x49, 0x49, 42])), false);
  assertEquals(tiffRawParser.canParse(new Uint8Array(0)), false);
  // JPEG magic must not be claimed
  assertEquals(tiffRawParser.canParse(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), false);
});

test('tiff-raw: registered in detection order after the web formats', () => {
  const dng = buildTiff(true, [
    [
      { tag: 0x010f, type: 2, raw: ascii('SONY') },
      { tag: 0xc612, type: 1, raw: new Uint8Array([1, 7, 0, 0]) },
    ],
  ]);
  assertEquals(detectParser(dng, [tiffRawParser])?.format, 'TIFF');
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('tiff-raw: DNGVersion in IFD0 classifies as DNG', async () => {
  const bytes = buildTiff(true, [
    [
      { tag: 0x010f, type: 2, raw: ascii('SONY') },
      { tag: 0xc612, type: 1, raw: new Uint8Array([1, 7, 0, 0]) },
    ],
  ]);
  const info = await tiffRawParser.parse(bytes, 'a.dng');
  assertEquals(info.format, 'DNG');
  assertEquals(info.tags['FileType'], 'DNG');
  assertEquals(info.tags['MIMEType'], 'image/x-adobe-dng');
});

test('tiff-raw: Make string classifies the vendor format', async () => {
  for (const [make, expected] of [
    ['NIKON CORPORATION', 'NEF'],
    ['SONY', 'ARW'],
    ['Canon', 'CR2'],
    ['OLYMPUS CORPORATION', 'ORF'],
    ['PENTAX', 'PEF'],
    ['Panasonic', 'RW2'],
    ['EASTMAN KODAK COMPANY', 'DCR'],
    ['SAMSUNG TECHWIN', 'SRW'],
  ] as Array<[string, string]>) {
    const info = await tiffRawParser.parse(withMake(make), 'x.raw');
    assertEquals(info.format, expected, `${make} → ${expected}`);
  }
});

test('tiff-raw: no Make and no DNGVersion classifies as TIFF', async () => {
  const info = await tiffRawParser.parse(buildTiff(true, [[]]), 'plain.tif');
  assertEquals(info.format, 'TIFF');
  assertEquals(info.tags['MIMEType'], 'image/tiff');
});

test('tiff-raw: Panasonic magic 85 classifies as RW2 without needing Make', async () => {
  const bytes = buildTiff(true, [[]], 85);
  const info = await tiffRawParser.parse(bytes, 'c.rw2');
  assertEquals(info.format, 'RW2');
  assertEquals(info.tags['MIMEType'], 'image/x-panasonic-rw2');
});

// ---------------------------------------------------------------------------
// End-to-end synthetic DNG: IFD0 + ExifIFD + GPS + SubIFD + XMP
// ---------------------------------------------------------------------------

function buildDng(): Uint8Array {
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmp:Rating="5"/></rdf:RDF></x:xmpmeta>';
  return buildTiff(true, [
    [
      { tag: 0x010f, type: 2, raw: ascii('SONY') },
      { tag: 0x0110, type: 2, raw: ascii('ILCE-7RM4') },
      { tag: 0x8769, ptr: 1 }, // Exif IFD
      { tag: 0x8825, ptr: 2 }, // GPS IFD
      { tag: 0x014a, ptr: 3 }, // SubIFDs (count 1)
      { tag: 0x02bc, type: 1, raw: encoder.encode(xmp) },
      { tag: 0xc612, type: 1, raw: new Uint8Array([1, 7, 0, 0]) },
    ],
    [
      { tag: 0x829a, type: 5, raw: rational(1, 400, true) }, // ExposureTime
      { tag: 0x829d, type: 5, raw: rational(28, 10, true) }, // FNumber
    ],
    [
      { tag: 0x0001, type: 2, raw: ascii('N') }, // GPSLatitudeRef
      { tag: 0x0002, type: 5, raw: new Uint8Array([...rational(45, 1, true), ...rational(0, 1, true), ...rational(0, 1, true)]) }, // GPSLatitude
      { tag: 0x0003, type: 2, raw: ascii('E') }, // GPSLongitudeRef
      { tag: 0x0004, type: 5, raw: new Uint8Array([...rational(18, 1, true), ...rational(0, 1, true), ...rational(0, 1, true)]) }, // GPSLongitude
    ],
    [
      { tag: 0x0100, type: 4, raw: pack([9600], 4, true) }, // ImageWidth
      { tag: 0x0101, type: 4, raw: pack([6376], 4, true) }, // ImageLength
    ],
  ]);
}

test('tiff-raw: synthetic DNG parses standard, SubIFD, GPS and XMP tags', async () => {
  const info = await tiffRawParser.parse(buildDng(), 'DSC01012.dng');
  assertEquals(info.format, 'DNG');
  assertEquals(info.tags['Make'], 'SONY');
  assertEquals(info.tags['Model'], 'ILCE-7RM4');
  assertEquals(info.tags['ExposureTime'], '1/400');
  assertEquals(info.tags['GPSLatitude'], `45 deg 0.0000' N`); // zero seconds → minute-only form
  assertEquals(info.tags['GPSLongitude'], `18 deg 0.0000' E`);
  assertEquals(info.tags['ImageWidth'], 9600); // from the SubIFD
  assertEquals(info.tags['ImageLength'], 6376);
  assertEquals(info.tags['Rating'], '5'); // from the embedded XMP
  // Composite tags computed like every other parser.
  assertEquals(info.tags['ImageSize'], '9600x6376');
  assertEquals(info.tags['Megapixels'], 61.2);
  assertEquals(info.tags['Aperture'], 2.8);
  assertEquals(info.tags['FileType'], 'DNG');
  assertEquals(info.tags['FileTypeExtension'], 'dng');
});

test('tiff-raw: malformed buffers degrade to empty tags and TIFF', async () => {
  const truncated = buildTiff(true, [[{ tag: 0x010f, type: 2, raw: ascii('SONY') }]]).slice(0, 10);
  const info = await tiffRawParser.parse(truncated, 'broken.dng');
  assertEquals(info.format, 'TIFF');
  assertEquals('Make' in info.tags, false);
  assertEquals(info.tags['FileType'], 'TIFF');
});

// ---------------------------------------------------------------------------
// Integration against real RAW fixtures
//
// assets/raw/* come from ExifTool's own test suite (t/images), trimmed to
// a few KB each. Source: github.com/exiftool/exiftool (t/images), used
// under ExifTool's Artistic License 2.0 — see assets/raw/LICENSE-NOTE.md.
// Expected values below are exiftool 13.55 ground truth captured with
// `exiftool -j` on the same files.
// ---------------------------------------------------------------------------

function assetPath(name: string): string {
  return fileURLToPath(new URL(`../../assets/raw/${name}`, import.meta.url));
}

test('tiff-raw: real DNG (big-endian, thumbnail IFD0 + CFA SubIFD) matches exiftool', async () => {
  const info = await tool.read(assetPath('DNG.dng'));
  assertEquals(info.format, 'DNG');
  assertEquals(info.tags['FileType'], 'DNG');
  assertEquals(info.tags['MIMEType'], 'image/x-adobe-dng');
  assertEquals(info.tags['Make'], 'Canon');
  assertEquals(info.tags['Model'], 'Canon EOS 350D DIGITAL');
  // Full-resolution CFA SubIFD overrides the 8x8 reduced IFD0, exiftool priority.
  assertEquals(info.tags['ImageWidth'], 3516);
  assertEquals(info.tags['ImageHeight'], 2328);
  assertEquals(info.tags['ImageSize'], '3516x2328');
  assertEquals(info.tags['Compression'], 'JPEG');
  assertEquals(info.tags['BitsPerSample'], 16);
  assertEquals(info.tags['PhotometricInterpretation'], 'Color Filter Array');
  assertEquals(info.tags['SubfileType'], 'Reduced-resolution image'); // IFD0's own value
  assertEquals(info.tags['ExposureTime'], '1/15');
  assertEquals(info.tags['FNumber'], 8);
  assertEquals(info.tags['ISO'], 400);
});

test('tiff-raw: real CR2 keeps full-resolution IFD0 values (Make prefix match)', async () => {
  const info = await tool.read(assetPath('CanonRaw.cr2'));
  assertEquals(info.format, 'CR2');
  assertEquals(info.tags['FileType'], 'CR2');
  assertEquals(info.tags['MIMEType'], 'image/x-canon-cr2');
  assertEquals(info.tags['Make'], 'Canon');
  assertEquals(info.tags['Model'], 'Canon EOS 350D DIGITAL');
  assertEquals(info.tags['ImageWidth'], 1536); // IFD0 wins; preview SubIFDs must not override
  assertEquals(info.tags['ImageHeight'], 1024);
  assertEquals(info.tags['Compression'], 'JPEG (old-style)');
  assertEquals(info.tags['BitsPerSample'], [8, 8, 8]);
  assertEquals(info.tags['ExposureTime'], '1/15');
  assertEquals(info.tags['FNumber'], 8);
  assertEquals(info.tags['ISO'], 400);
});

test('tiff-raw: real NEF (reduced IFD0 + primary SubIFD) matches exiftool dims', async () => {
  const info = await tool.read(assetPath('Nikon.nef'));
  assertEquals(info.format, 'NEF');
  assertEquals(info.tags['FileType'], 'NEF');
  assertEquals(info.tags['MIMEType'], 'image/x-nikon-nef');
  assertEquals(info.tags['Make'], 'NIKON CORPORATION'); // prefix match → NEF
  assertEquals(info.tags['Model'], 'NIKON D70');
  assertEquals(info.tags['ImageWidth'], 3040); // primary SubIFD overrides demoted IFD0
  assertEquals(info.tags['ImageHeight'], 2014);
  assertEquals(info.tags['Compression'], 'Nikon NEF Compressed');
  assertEquals(info.tags['BitsPerSample'], 12);
  assertEquals(info.tags['PhotometricInterpretation'], 'Color Filter Array');
  assertEquals(info.tags['ExposureTime'], '1/20');
  assertEquals(info.tags['FNumber'], 3.5);
  assertEquals(info.tags['ISO'], 200);
  // Known divergence: exiftool reports the primary SubIFD's SubfileType
  // ("Full-resolution image") for NEF but keeps IFD0's for DNG; we keep
  // the first read in both cases.
  assertEquals(info.tags['SubfileType'], 'Reduced-resolution image');
});

test('tiff-raw: real RW2 (magic 85) parses standard tags incl. sensor-border dimensions', async () => {
  const info = await tool.read(assetPath('Panasonic.rw2'));
  assertEquals(info.format, 'RW2');
  assertEquals(info.tags['FileType'], 'RW2');
  assertEquals(info.tags['MIMEType'], 'image/x-panasonic-rw2');
  assertEquals(info.tags['Make'], 'Panasonic');
  assertEquals(info.tags['Model'], 'DMC-LX3');
  assertEquals(info.tags['ExposureTime'], '1/250');
  assertEquals(info.tags['FNumber'], 4);
  assertEquals(info.tags['ISO'], 80);
  assertEquals(info.tags['BitsPerSample'], 12);
  // RW2 dimensions are the sensor-border spread (exiftool Composite values).
  assertEquals(info.tags['ImageWidth'], 3648);
  assertEquals(info.tags['ImageHeight'], 2736);
});

// User's own fixture (never committed): full 61 MP Sony in-camera DNG.
const DNG_FIXTURE = '/Users/woss/Pictures/2024/09/DSC01012.dng';

test('tiff-raw: real Sony DNG fixture (local-only)', async () => {
  if (!existsSync(DNG_FIXTURE)) return; // CI: fixture is not committed
  const bytes = new Uint8Array(readFileSync(DNG_FIXTURE));
  const info = await tiffRawParser.parse(bytes, DNG_FIXTURE);
  assertEquals(info.format, 'DNG');
  assertEquals(info.tags['Make'], 'SONY');
  assertEquals(info.tags['Model'], 'ILCE-7RM4');
  assertEquals(info.tags['ImageWidth'], 9600);
  assertEquals(info.tags['ImageHeight'], 6376);
});
