import { assertEquals } from 'jsr:@std/assert@1/equals';
import { parseICCProfile } from './icc.ts';

// ---------- synthetic profile builder ----------

const enc = new TextEncoder();

function fix16(v: number): number {
  return Math.round(v * 65536);
}

interface TagSpec {
  sig: string;
  body: Uint8Array;
}

interface HeaderOpts {
  cmm?: string | null; // null => all-zero cmm field
  major?: number;
  minorNibble?: number;
  pclass?: string;
  space?: string;
  pcs?: string;
  date?: [number, number, number, number, number, number];
  fileSig?: string;
  platform?: string;
  devMfg?: string | null; // null => leave zeros
  devModel?: string | null;
  attrLo?: number | null;
  attrHi?: number | null;
  intent?: number;
  creator?: string;
  id?: Uint8Array | null; // null => leave zeros
  numTagsOverride?: number;
}

function textBody(s: string): Uint8Array {
  const out = new Uint8Array(8 + s.length);
  out.set(enc.encode('text'), 0);
  out.set(enc.encode(s), 8);
  return out;
}

function descBody(s: string): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(12 + s.length + 1));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('desc'), 0);
  dv.setUint32(8, s.length, false);
  out.set(enc.encode(s), 12);
  return out;
}

function xyzTag(sig: string, x: number, y: number, z: number): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(20));
  const dv = new DataView(out.buffer);
  out.set(enc.encode(sig), 0);
  dv.setInt32(8, fix16(x), false);
  dv.setInt32(12, fix16(y), false);
  dv.setInt32(16, fix16(z), false);
  return out;
}

function curvBody(count: number): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(12));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('curv'), 0);
  dv.setUint32(8, count, false);
  return out;
}

function mlucBody(s: string): Uint8Array {
  const strBytes = enc.encode(s); // module decodes raw bytes via readASCII
  const out = new Uint8Array(new ArrayBuffer(28 + strBytes.length));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('mluc'), 0);
  dv.setUint32(8, 1, false); // language count
  dv.setUint32(12, 12, false); // record size
  dv.setUint32(20, strBytes.length, false); // first string length
  dv.setUint32(24, 28, false); // first string offset
  out.set(strBytes, 28);
  return out;
}

function paraBody(): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(16));
  out.set(enc.encode('para'), 0);
  return out;
}

function measBody(
  obs: number,
  geo: number,
  flare: number,
  ill: number,
): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(30));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('meas'), 0);
  dv.setUint16(8, obs, false);
  dv.setInt32(12, fix16(0.9642), false);
  dv.setInt32(16, fix16(1.0), false);
  dv.setInt32(20, fix16(0.8249), false);
  dv.setUint16(24, geo, false);
  dv.setUint16(26, flare, false);
  dv.setUint16(28, ill, false);
  return out;
}

function viewBody(desc?: string): Uint8Array {
  // The module probes byte 36 for a length but then reads the description
  // FROM byte 36 itself, so supply raw text there (first char doubles as the
  // probe value; keep it >= text length so descLen covers the whole string).
  const size = desc === undefined ? 36 : 36 + desc.length;
  const out = new Uint8Array(new ArrayBuffer(size));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('view'), 0);
  dv.setInt32(8, fix16(1.0), false);
  dv.setInt32(12, fix16(1.0), false);
  dv.setInt32(16, fix16(1.0), false);
  dv.setUint16(20, 1, false); // D50
  dv.setInt32(24, fix16(0.2), false);
  dv.setInt32(28, fix16(0.2), false);
  dv.setInt32(32, fix16(0.2), false);
  if (desc !== undefined) out.set(enc.encode(desc), 36);
  return out;
}

function sf32Body(vals: number[]): Uint8Array {
  const out = new Uint8Array(new ArrayBuffer(8 + vals.length * 4));
  const dv = new DataView(out.buffer);
  out.set(enc.encode('sf32'), 0);
  for (let i = 0; i < vals.length; i++) {
    dv.setInt32(8 + i * 4, fix16(vals[i]), false);
  }
  return out;
}

function buildProfile(hdr: HeaderOpts, tags: TagSpec[]): Uint8Array {
  const tableSize = 4 + tags.length * 12;
  let dataSize = 0;
  for (const t of tags) dataSize += t.body.length;
  const total = 132 + tableSize + dataSize;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  dv.setUint32(0, total, false);
  if (hdr.cmm !== null && hdr.cmm !== undefined) u8.set(enc.encode(hdr.cmm.padEnd(4, ' ')), 4);
  dv.setUint8(8, hdr.major ?? 2);
  dv.setUint8(9, hdr.minorNibble ?? 0x21);
  u8.set(enc.encode((hdr.pclass ?? 'mntr').padEnd(4, ' ').slice(0, 4)), 12);
  u8.set(enc.encode((hdr.space ?? 'RGB ').padEnd(4, ' ').slice(0, 4)), 16);
  u8.set(enc.encode((hdr.pcs ?? 'XYZ ').padEnd(4, ' ').slice(0, 4)), 20);
  const [yy, mm, dd, h, mi, ss] = hdr.date ?? [2024, 1, 15, 10, 30, 0];
  dv.setUint16(24, yy, false);
  dv.setUint16(26, mm, false);
  dv.setUint16(28, dd, false);
  dv.setUint16(30, h, false);
  dv.setUint16(32, mi, false);
  dv.setUint16(34, ss, false);
  u8.set(enc.encode((hdr.fileSig ?? 'acsp').padEnd(4, ' ')), 36);
  if (hdr.platform !== undefined) u8.set(enc.encode(hdr.platform.padEnd(4, ' ').slice(0, 4)), 40);
  if (hdr.devMfg !== null && hdr.devMfg !== undefined) u8.set(enc.encode(hdr.devMfg.padEnd(4, ' ').slice(0, 4)), 48);
  if (hdr.devModel !== null && hdr.devModel !== undefined) u8.set(enc.encode(hdr.devModel.padEnd(4, ' ').slice(0, 4)), 52);
  if (hdr.attrLo != null) dv.setUint32(56, hdr.attrLo, false);
  if (hdr.attrHi != null) dv.setUint32(60, hdr.attrHi, false);
  dv.setUint32(64, hdr.intent ?? 0, false);
  dv.setInt32(68, fix16(0.9642), false);
  dv.setInt32(72, fix16(1.0), false);
  dv.setInt32(76, fix16(0.8249), false);
  if (hdr.creator !== undefined) u8.set(enc.encode(hdr.creator.padEnd(4, ' ').slice(0, 4)), 80);
  if (hdr.id) u8.set(hdr.id.subarray(0, 16), 84);

  dv.setUint32(128, hdr.numTagsOverride ?? tags.length, false);
  let tableOff = 132;
  let dataOff = 132 + tableSize;
  for (const t of tags) {
    u8.set(enc.encode(t.sig.padEnd(4, ' ').slice(0, 4)), tableOff);
    dv.setUint32(tableOff + 4, dataOff, false);
    dv.setUint32(tableOff + 8, t.body.length, false);
    tableOff += 12;
    u8.set(t.body, dataOff);
    dataOff += t.body.length;
  }
  return new Uint8Array(buf);
}

// ---------- header parsing ----------

Deno.test('parseICCProfile returns empty object for truncated data', () => {
  assertEquals(parseICCProfile(new Uint8Array(64)), {});
});

Deno.test('parseICCProfile parses full header with known values', () => {
  const data = buildProfile({
    cmm: 'ADBE',
    major: 2,
    minorNibble: 0x21,
    pclass: 'mntr',
    platform: 'APPL',
    devMfg: 'APPL',
    devModel: 'sRGB',
    attrLo: 0x03, // transparency + matte
    attrHi: 0x03, // negative + monochrome
    intent: 1,
    creator: 'APPL',
    id: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    date: [2024, 1, 15, 10, 30, 0],
  }, []);
  const r = parseICCProfile(data);
  assertEquals(r['ProfileSize'], data.length);
  assertEquals(r['ProfileCMMType'], 'ADBE');
  assertEquals(r['CMMFlags'], 'Not Embedded, Independent');
  assertEquals(r['ProfileVersion'], '2.2.1');
  assertEquals(r['ProfileClass'], 'Display Device Profile');
  assertEquals(r['ColorSpaceData'], 'RGB ');
  assertEquals(r['ProfileConnectionSpace'], 'XYZ ');
  assertEquals(r['ProfileDateTime'], '2024-01-15 10:30:00');
  assertEquals(r['ProfileFileSignature'], 'acsp');
  assertEquals(r['PrimaryPlatform'], 'Apple Computer Inc.');
  assertEquals(r['RenderingIntent'], 'Media-Relative Colorimetric');
  assertEquals(r['ConnectionSpaceIlluminant'], '0.9642 1.0000 0.8249');
  assertEquals(r['ProfileCreator'], 'APPL');
  assertEquals(r['ProfileID'], 'DEADBEEF000000000000000000000000');
  assertEquals(r['DeviceManufacturer'], 'Apple Computer Inc.');
  assertEquals(r['DeviceModel'], 'sRGB');
  assertEquals(r['DeviceAttributes'], 'Transparency, Matte, Negative, Monochrome');
});

Deno.test('parseICCProfile handles zeroed/unknown header fields', () => {
  const data = buildProfile({
    cmm: null,
    pclass: 'wxyz',
    platform: 'ACME',
    devMfg: 'ACME',
    devModel: 'ZZZZ',
    intent: 9,
    id: null,
  }, []);
  const r = parseICCProfile(data);
  assertEquals(r['ProfileCMMType'], '');
  assertEquals(r['CMMFlags'], 'Embedded');
  assertEquals(r['ProfileClass'], 'wxyz');
  assertEquals(r['PrimaryPlatform'], 'ACME');
  assertEquals(r['DeviceManufacturer'], 'ACME');
  assertEquals(r['DeviceModel'], 'ZZZZ');
  assertEquals(r['RenderingIntent'], 9);
  assertEquals(r['ProfileID'], 0);
});

Deno.test('parseICCProfile maps remaining rendering intents and classes', () => {
  for (const [intent, expected] of [
    [0, 'Perceptual'],
    [2, 'Saturation'],
    [3, 'ICC-Absolute Colorimetric'],
  ] as const) {
    const r = parseICCProfile(buildProfile({ intent }, []));
    assertEquals(r['RenderingIntent'], expected);
  }
  const link = parseICCProfile(buildProfile({ pclass: 'link' }, []));
  assertEquals(link['ProfileClass'], 'DeviceLink Profile');
  const spac = parseICCProfile(buildProfile({ pclass: 'spac' }, []));
  assertEquals(spac['ProfileClass'], 'ColorSpace Conversion Profile');
  const abst = parseICCProfile(buildProfile({ pclass: 'abst' }, []));
  assertEquals(abst['ProfileClass'], 'Abstract Profile');
  const nmcl = parseICCProfile(buildProfile({ pclass: 'nmcl' }, []));
  assertEquals(nmcl['ProfileClass'], 'Named Color Profile');
  const scnr = parseICCProfile(buildProfile({ pclass: 'scnr' }, []));
  assertEquals(scnr['ProfileClass'], 'Input Device Profile');
  const prtr = parseICCProfile(buildProfile({ pclass: 'prtr' }, []));
  assertEquals(prtr['ProfileClass'], 'Output Device Profile');
});

Deno.test('parseICCProfile maps other platforms and reflective attribute defaults', () => {
  const r = parseICCProfile(buildProfile({ platform: 'MSFT', attrLo: 0, attrHi: 0 }, []));
  assertEquals(r['PrimaryPlatform'], 'Microsoft Corporation');
  assertEquals(r['DeviceAttributes'], 'Reflective, Glossy, Positive, Color');
  const sgi = parseICCProfile(buildProfile({ platform: 'SGI ' }, []));
  assertEquals(sgi['PrimaryPlatform'], 'Silicon Graphics Inc.');
  const sunw = parseICCProfile(buildProfile({ platform: 'SUNW' }, []));
  assertEquals(sunw['PrimaryPlatform'], 'Sun Microsystems Inc.');
  const tgnt = parseICCProfile(buildProfile({ platform: 'TGNT' }, []));
  assertEquals(tgnt['PrimaryPlatform'], 'Tailgent');
});

// ---------- tag parsing ----------

Deno.test('parseICCProfile parses all supported tag types', () => {
  const data = buildProfile({}, [
    { sig: 'desc', body: descBody('sRGB built-in') },
    { sig: 'cprt', body: textBody('public domain') },
    { sig: 'wtpt', body: xyzTag('XYZ ', 0.9642, 1.0, 0.8249) },
    { sig: 'rTRC', body: curvBody(0) },
    { sig: 'gTRC', body: curvBody(2) },
    { sig: 'dscm', body: mlucBody('Description ML') },
    { sig: 'psd0', body: paraBody() },
    { sig: 'meas', body: measBody(1, 2, 0x40, 1) },
    { sig: 'view', body: viewBody('abcd') },
    { sig: 'chad', body: sf32Body([0.5, -0.25]) },
    { sig: 'zzzz', body: new Uint8Array([1, 2, 3, 4]) },
  ]);
  const r = parseICCProfile(data);
  assertEquals(r['ProfileDescription'], 'sRGB built-in');
  assertEquals(r['ProfileCopyright'], 'public domain');
  assertEquals(r['MediaWhitePoint'], '0.9642 1.0000 0.8249');
  assertEquals(r['RedTRC'], '(Linear)');
  assertEquals(r['GreenTRC'] instanceof Uint8Array, true);
  assertEquals(r['ProfileDescriptionML'], 'Description ML');
  assertEquals(r['PostScript2CRD0'] instanceof Uint8Array, true);
  assertEquals(r['MeasurementBacking'], '0.9642 1.0000 0.8249');
  assertEquals(r['MeasurementGeometry'], '45/0');
  assertEquals(r['MeasurementFlare'], '25.0%');
  assertEquals(r['MeasurementIlluminant'], 'D50');
  assertEquals(r['MeasurementObserver'], 'CIE 1931');
  assertEquals(r['ViewingCondIlluminant'], '1.0000 1.0000 1.0000');
  assertEquals(r['ViewingCondIlluminantType'], 'D50');
  assertEquals(r['ViewingCondSurround'], '0.2000 0.2000 0.2000');
  assertEquals(r['ViewingCondDesc'], 'abcd');
  assertEquals(r['ChromaticAdaptation'], '0.5 -0.25');
  assertEquals(r['zzzz'] instanceof Uint8Array, true);
});

Deno.test('parseICCProfile meas/view unknown enum values fall back', () => {
  const data = buildProfile({}, [
    { sig: 'meas', body: measBody(9, 9, 0, 99) },
    { sig: 'view', body: (() => {
      const b = viewBody();
      new DataView(b.buffer).setUint16(20, 42, false);
      return b;
    })() },
  ]);
  const r = parseICCProfile(data);
  assertEquals(r['MeasurementGeometry'], 'Unknown');
  assertEquals(r['MeasurementFlare'], '0.0%');
  assertEquals(r['MeasurementIlluminant'], 'Unknown');
  assertEquals(r['MeasurementObserver'], 'Unknown');
  assertEquals(r['ViewingCondIlluminantType'], 'Unknown');

  const short = buildProfile({}, [{ sig: 'meas', body: new Uint8Array(8) }]);
  const rs = parseICCProfile(short);
  assertEquals('MeasurementGeometry' in rs, false);
});

Deno.test('parseICCProfile view tag without description tail', () => {
  const data = buildProfile({}, [{ sig: 'view', body: viewBody() }]);
  const r = parseICCProfile(data);
  assertEquals(r['ViewingCondDesc'], undefined);
});

Deno.test('parseICCProfile skips tag whose data lies outside the profile', () => {
  const data = buildProfile({}, [{ sig: 'desc', body: descBody('ok') }]);
  const broken = new Uint8Array(data.length);
  broken.set(data, 0);
  const dv = new DataView(broken.buffer);
  dv.setUint32(136, data.length + 100, false);
  dv.setUint32(140, 16, false);
  const r = parseICCProfile(broken);
  assertEquals('ProfileDescription' in r, false);
});

Deno.test('parseICCProfile skips tag shorter than its 4-byte type signature near end of data', () => {
  // tag data = last 2 bytes of the profile, size 2: reading the 4-byte
  // type signature runs past the buffer and the tag is skipped silently.
  const data = buildProfile({}, [{ sig: 'desc', body: descBody('ok') }]);
  const grown = new Uint8Array(data.length + 2);
  grown.set(data, 0);
  grown[data.length] = 0xaa;
  grown[data.length + 1] = 0xbb;
  const dv = new DataView(grown.buffer);
  dv.setUint32(136, data.length, false); // offset of the 2 tail bytes
  dv.setUint32(140, 2, false);
  const r = parseICCProfile(grown);
  assertEquals('ProfileDescription' in r, false);
});

Deno.test('parseICCProfile skips tag when declared desc length overruns the buffer', () => {
  const body = new Uint8Array(new ArrayBuffer(16));
  body.set(enc.encode('desc'), 0);
  new DataView(body.buffer).setUint32(8, 0x7fffffff, false); // absurd length
  const data = buildProfile({}, [{ sig: 'desc', body }]);
  const r = parseICCProfile(data);
  assertEquals('ProfileDescription' in r, false);
});

Deno.test('parseICCProfile stops at tag table even when tag count is overstated', () => {
  const data = buildProfile({ numTagsOverride: 50 }, [
    { sig: 'desc', body: descBody('only one') },
  ]);
  const r = parseICCProfile(data);
  assertEquals(r['ProfileDescription'], 'only one');
});
