import { assertEquals } from 'jsr:@std/assert@1/equals';
import { readIfdValue, formatExifValue, getTagName, EXIF_POINTER_TAGS } from './values.ts';
import { getExifTypeSize, getExifTypeName, type IfdEntry } from './types.ts';

// ---------- helpers ----------

function dv(bytes: number[] | Uint8Array): DataView {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buf = new ArrayBuffer(arr.length);
  new Uint8Array(buf).set(arr);
  return new DataView(buf);
}

function entry(type: number, count: number, offset: number): IfdEntry {
  return { tag: 0, type, count, offset, value: 0 };
}

// Packed layout offsets are referenced by the single-value and rational tests.
const OFF = {
  byte: 0,
  sbyte: 1,
  undef: 2,
  short: 3,
  sshort: 5,
  long: 7,
  slong: 11,
  float: 15,
  double: 19,
  ifd: 27,
  long8: 31,
  slong8: 39,
  ifd8: 47,
  rational: 55,
  rationalZeroDen: 63,
  srational: 71,
  srationalZeroDen: 79,
};

function buildTypeBuffer(): DataView {
  // one densely-packed buffer covering every scalar exif type
  const buf = new ArrayBuffer(96);
  const v = new DataView(buf);
  const le = true;
  let o = 0;
  v.setUint8(o, 200); o += 1; // BYTE
  v.setInt8(o, -100); o += 1; // SBYTE
  v.setUint8(o, 7); o += 1; // UNDEFINED (single)
  v.setUint16(o, 40000, le); o += 2; // SHORT
  v.setInt16(o, -20000, le); o += 2; // SSHORT
  v.setUint32(o, 3000000000, le); o += 4; // LONG
  v.setInt32(o, -2000000000, le); o += 4; // SLONG
  v.setFloat32(o, 1.5, le); o += 4; // FLOAT
  v.setFloat64(o, 3.5, le); o += 8; // DOUBLE
  v.setUint32(o, 123456, le); o += 4; // IFD
  v.setBigUint64(o, 5000000000n, le); o += 8; // LONG8
  v.setBigInt64(o, -5000000000n, le); o += 8; // SLONG8
  v.setBigUint64(o, 42n, le); o += 8; // IFD8
  v.setUint32(o, 1, le); v.setUint32(o + 4, 2, le); o += 8; // RATIONAL 0.5
  v.setUint32(o, 3, le); v.setUint32(o + 4, 0, le); o += 8; // RATIONAL den 0
  v.setInt32(o, -3, le); v.setInt32(o + 4, 2, le); o += 8; // SRATIONAL -1.5
  v.setInt32(o, 5, le); v.setInt32(o + 4, 0, le); o += 8; // SRATIONAL den 0
  assertEquals(o, 87);
  return new DataView(buf);
}

// ---------- readIfdValue / readSingleValue ----------

Deno.test('readIfdValue reads every single-value exif type', () => {
  const view = buildTypeBuffer();
  const cases: [number, number, unknown][] = [
    [1, OFF.byte, 200],
    [6, OFF.sbyte, -100],
    [7, OFF.undef, 7],
    [3, OFF.short, 40000],
    [8, OFF.sshort, -20000],
    [4, OFF.long, 3000000000],
    [9, OFF.slong, -2000000000],
    [11, OFF.float, 1.5],
    [12, OFF.double, 3.5],
    [13, OFF.ifd, 123456],
    [16, OFF.long8, 5000000000],
    [17, OFF.slong8, -5000000000],
    [18, OFF.ifd8, 42],
    [5, OFF.rational, 0.5], // RATIONAL
    [10, OFF.srational, -1.5], // SRATIONAL
  ];
  for (const [type, offset, expected] of cases) {
    assertEquals(readIfdValue(entry(type, 1, offset), view, true), expected, `type ${type}`);
  }
});

Deno.test('readSingleValue rational with zero denominator yields 0', () => {
  const view = buildTypeBuffer();
  assertEquals(readIfdValue(entry(5, 1, OFF.rationalZeroDen), view, true), 0);
  assertEquals(readIfdValue(entry(10, 1, OFF.srationalZeroDen), view, true), 0);
});

Deno.test('readIfdValue returns null for zero count and 0 for unknown type', () => {
  const view = buildTypeBuffer();
  assertEquals(readIfdValue(entry(3, 0, 0), view, true), null);
  assertEquals(readIfdValue(entry(99, 1, 0), view, true), 0);
});

Deno.test('readIfdValue reads ASCII arrays stopping at NUL', () => {
  const view = dv([0x68, 0x69, 0x00, 0x78]); // "hi\0x"
  assertEquals(readIfdValue(entry(2, 4, 0), view, true), 'hi');
});

Deno.test('readIfdValue reads UNDEFINED arrays as raw bytes', () => {
  const view = dv([1, 2, 3, 4]);
  const out = readIfdValue(entry(7, 4, 0), view, true) as Uint8Array;
  assertEquals(Array.from(out), [1, 2, 3, 4]);
});

Deno.test('readIfdValue reads numeric arrays in both endiannesses', () => {
  const be = dv([0x12, 0x34, 0x56, 0x78]);
  assertEquals(readIfdValue(entry(3, 2, 0), be, false), [0x1234, 0x5678]);
  const le = dv([0x34, 0x12, 0x78, 0x56]);
  assertEquals(readIfdValue(entry(3, 2, 0), le, true), [0x1234, 0x5678]);
});

Deno.test('readIfdValue reads rational arrays including zero denominators', () => {
  const view = buildTypeBuffer();
  assertEquals(readIfdValue(entry(5, 2, OFF.rational), view, true), [0.5, 0]);
  assertEquals(readIfdValue(entry(10, 2, OFF.srational), view, true), [-1.5, 0]);
});

// ---------- getTagName / EXIF_POINTER_TAGS ----------

Deno.test('getTagName resolves each table and misses cleanly', () => {
  assertEquals(getTagName(0x0100, 'ifd0'), 'ImageWidth');
  assertEquals(getTagName(0x829a, 'exif'), 'ExposureTime');
  assertEquals(getTagName(0x02, 'gps'), 'GPSLatitude');
  assertEquals(getTagName(0xffff, 'ifd0'), undefined);
  assertEquals(getTagName(0xffff, 'exif'), undefined);
  assertEquals(getTagName(0xffff, 'gps'), undefined);
  assertEquals(getTagName(1, 'bogus' as never), undefined);
});

Deno.test('EXIF_POINTER_TAGS contains sub-IFD pointer names', () => {
  assertEquals([...EXIF_POINTER_TAGS].sort(), ['ExifIFD', 'GPSInfo', 'InteropIFD']);
});

// ---------- types.ts ----------

Deno.test('getExifTypeName resolves known types and falls back for unknown', () => {
  assertEquals(getExifTypeName(3), 'SHORT');
  assertEquals(getExifTypeName(10), 'SRATIONAL');
  assertEquals(getExifTypeName(18), 'IFD8');
  assertEquals(getExifTypeName(99), 'UNKNOWN_99');
  assertEquals(getExifTypeSize(5), 8);
  assertEquals(getExifTypeSize(42), 1);
});

// ---------- formatExifVersion paths ----------

Deno.test('formatExifValue formats ExifVersion from bytes, array, and string', () => {
  assertEquals(formatExifValue(new TextEncoder().encode('0232'), 'ExifVersion'), '0232');
  assertEquals(formatExifValue([48, 50, 51, 49], 'ExifVersion'), '0231');
  assertEquals(formatExifValue(new TextEncoder().encode('0230\0\0'), 'ExifVersion'), '0230');
  assertEquals(formatExifValue('0230', 'FlashpixVersion'), '0230');
});

Deno.test('formatExifValue formats ComponentsConfiguration from bytes, array, other', () => {
  assertEquals(formatExifValue(new Uint8Array([1, 2, 3, 0]), 'ComponentsConfiguration'), 'YCbCr-');
  assertEquals(formatExifValue([4, 5, 6, 9], 'ComponentsConfiguration'), 'RGB?');
  assertEquals(formatExifValue('weird', 'ComponentsConfiguration'), 'weird');
});

Deno.test('formatExifValue formats Orientation values', () => {
  const cases: [number, string | number][] = [
    [1, 'Horizontal (normal)'],
    [2, 'Mirror horizontal'],
    [3, 'Rotate 180'],
    [4, 'Mirror vertical'],
    [5, 'Mirror horizontal and rotate 270 CW'],
    [6, 'Rotate 90 CW'],
    [7, 'Mirror horizontal and rotate 90 CW'],
    [8, 'Rotate 270 CW'],
    [9, 9],
  ];
  for (const [value, expected] of cases) {
    assertEquals(formatExifValue(value, 'Orientation'), expected);
  }
  assertEquals(formatExifValue('notanumber', 'Orientation'), 'notanumber');
});

Deno.test('formatExifValue formats ResolutionUnit family', () => {
  for (const tag of ['ResolutionUnit', 'FocalPlaneResolutionUnit', 'Thumbnail_ResolutionUnit']) {
    assertEquals(formatExifValue(2, tag), 'inches');
    assertEquals(formatExifValue(3, tag), 'cm');
    assertEquals(formatExifValue(1, tag), 1);
    assertEquals(formatExifValue('str', tag), 'str');
  }
});

// ---------- Flash ----------

Deno.test('formatExifValue formats all Flash bit combinations', () => {
  const cases: [number, string][] = [
    [0x00, 'No Flash'],
    [0x01, 'Fired'],
    [0x03, 'Fired, Return not detected'],
    [0x05, 'Fired, Return detected'],
    [0x09, 'Fired, Compulsory'],
    [0x11, 'Fired, Suppressed'],
    [0x19, 'Fired, Auto'],
    [0x1f, 'Fired, Auto'],
    [0x5b, 'Fired, Return not detected, Auto, Red-eye'],
    [0x5d, 'Fired, Return detected, Auto, Red-eye'],
  ];
  for (const [value, expected] of cases) {
    assertEquals(formatExifValue(value, 'Flash'), expected, value.toString(16));
  }
  assertEquals(formatExifValue('off', 'Flash'), 'off');
});

// ---------- exposure helpers ----------

Deno.test('formatExifValue formats ExposureTime above and below one second', () => {
  assertEquals(formatExifValue(2, 'ExposureTime'), '2');
  assertEquals(formatExifValue(1, 'ExposureTime'), '1');
  assertEquals(formatExifValue(0.004, 'ExposureTime'), '1/250');
  assertEquals(formatExifValue(0.5, 'ExposureTime'), '1/2');
});

Deno.test('formatExifValue formats ShutterSpeedValue above and below one second', () => {
  assertEquals(formatExifValue(-2, 'ShutterSpeedValue'), '4'); // 2^2
  assertEquals(formatExifValue(0, 'ShutterSpeedValue'), '1');
  assertEquals(formatExifValue(8, 'ShutterSpeedValue'), '1/256'); // 2^-8
});

// ---------- GPS formatters ----------

Deno.test('formatExifValue formats GPSVersionID from array, bytes, scalar', () => {
  assertEquals(formatExifValue([2, 3, 0, 0], 'GPSVersionID'), '2.3.0.0');
  assertEquals(formatExifValue(new Uint8Array([2, 2, 0, 1]), 'GPSVersionID'), '2.2.0.1');
  assertEquals(formatExifValue(5, 'GPSVersionID'), '5');
});

Deno.test('formatExifValue formats GPSLatitude/GPSLongitude rationals', () => {
  assertEquals(formatExifValue([40, 26, 46.299999999997], 'GPSLatitude'), '40 deg 26\' 46.30"');
  assertEquals(formatExifValue([40, 26.5], 'GPSLongitude'), '40 deg 26.5000\'');
  assertEquals(formatExifValue([10], 'GPSLatitude'), '10');
  assertEquals(formatExifValue('flat', 'GPSLongitude'), 'flat');
});

Deno.test('formatExifValue formats GPSTimeStamp', () => {
  assertEquals(formatExifValue([14, 58, 24.75], 'GPSTimeStamp'), '14:58:25');
  assertEquals(formatExifValue([6, 7], 'GPSTimeStamp'), '06:07:00');
  assertEquals(formatExifValue([3], 'GPSTimeStamp'), '3');
});

// ---------- enum arms ----------

Deno.test('formatExifValue maps every GPSStatus/GPSMeasureMode/GPSDifferential value', () => {
  assertEquals(formatExifValue('A', 'GPSStatus'), 'Measurement Active');
  assertEquals(formatExifValue('V', 'GPSStatus'), 'Measurement Void');
  assertEquals(formatExifValue('X', 'GPSStatus'), 'X');
  assertEquals(formatExifValue('2', 'GPSMeasureMode'), '2-Dimensional Measurement');
  assertEquals(formatExifValue('3', 'GPSMeasureMode'), '3-Dimensional Measurement');
  assertEquals(formatExifValue('4', 'GPSMeasureMode'), '4');
  assertEquals(formatExifValue(0, 'GPSDifferential'), 'No Correction');
  assertEquals(formatExifValue(1, 'GPSDifferential'), 'Differential Corrected');
  assertEquals(formatExifValue(7, 'GPSDifferential'), 7);
});

Deno.test('formatExifValue maps every numeric ENUM arm', () => {
  const cases: [string, number, string | number][] = [
    // ExposureProgram
    ['ExposureProgram', 0, 'Not Defined'],
    ['ExposureProgram', 1, 'Manual'],
    ['ExposureProgram', 2, 'Program AE'],
    ['ExposureProgram', 3, 'Aperture-priority AE'],
    ['ExposureProgram', 4, 'Shutter speed priority AE'],
    ['ExposureProgram', 5, 'Creative (Slow speed)'],
    ['ExposureProgram', 6, 'Action (High speed)'],
    ['ExposureProgram', 7, 'Portrait'],
    ['ExposureProgram', 8, 'Landscape'],
    ['ExposureProgram', 9, 'Bulb'],
    ['ExposureProgram', 99, 99],
    // MeteringMode
    ['MeteringMode', 0, 'Unknown'],
    ['MeteringMode', 1, 'Average'],
    ['MeteringMode', 2, 'Center-weighted average'],
    ['MeteringMode', 3, 'Spot'],
    ['MeteringMode', 4, 'Multi-spot'],
    ['MeteringMode', 5, 'Multi-segment'],
    ['MeteringMode', 6, 'Partial'],
    ['MeteringMode', 255, 'Other'],
    ['MeteringMode', 7, 7],
    // LightSource
    ['LightSource', 0, 'Unknown'],
    ['LightSource', 1, 'Daylight'],
    ['LightSource', 2, 'Fluorescent'],
    ['LightSource', 3, 'Tungsten (Incandescent)'],
    ['LightSource', 4, 'Flash'],
    ['LightSource', 9, 'Fine Weather'],
    ['LightSource', 10, 'Cloudy'],
    ['LightSource', 11, 'Shade'],
    ['LightSource', 12, 'Daylight Fluorescent'],
    ['LightSource', 13, 'Day White Fluorescent'],
    ['LightSource', 14, 'Cool White Fluorescent'],
    ['LightSource', 15, 'White Fluorescent'],
    ['LightSource', 16, 'Warm White Fluorescent'],
    ['LightSource', 17, 'Standard Light A'],
    ['LightSource', 18, 'Standard Light B'],
    ['LightSource', 19, 'Standard Light C'],
    ['LightSource', 20, 'D55'],
    ['LightSource', 21, 'D65'],
    ['LightSource', 22, 'D75'],
    ['LightSource', 23, 'D50'],
    ['LightSource', 24, 'ISO Studio Tungsten'],
    ['LightSource', 255, 'Other'],
    ['LightSource', 5, 5],
    // ColorSpace
    ['ColorSpace', 1, 'sRGB'],
    ['ColorSpace', 2, 'Adobe RGB'],
    ['ColorSpace', 65535, 'Uncalibrated'],
    ['ColorSpace', 3, 3],
    // SensitivityType
    ['SensitivityType', 0, 'Unknown'],
    ['SensitivityType', 1, 'Standard Output Sensitivity'],
    ['SensitivityType', 2, 'Recommended Exposure Index'],
    ['SensitivityType', 3, 'ISO Speed'],
    ['SensitivityType', 4, 'Standard Output Sensitivity and Recommended Exposure Index'],
    ['SensitivityType', 5, 'Standard Output Sensitivity and ISO Speed'],
    ['SensitivityType', 6, 'Recommended Exposure Index and ISO Speed'],
    ['SensitivityType', 7, 'Standard Output Sensitivity, Recommended Exposure Index and ISO Speed'],
    ['SensitivityType', 8, 8],
    // FileSource / SceneType
    ['FileSource', 1, 'Film Scanner'],
    ['FileSource', 2, 'Reflection Print Scanner'],
    ['FileSource', 3, 'Digital Camera'],
    ['FileSource', 4, 4],
    ['SceneType', 1, 'Directly photographed'],
    ['SceneType', 2, 2],
    // CustomRendered / ExposureMode / WhiteBalance / SceneCaptureType
    ['CustomRendered', 0, 'Normal'],
    ['CustomRendered', 1, 'Custom'],
    ['CustomRendered', 2, 2],
    ['ExposureMode', 0, 'Auto'],
    ['ExposureMode', 1, 'Manual'],
    ['ExposureMode', 2, 'Auto bracket'],
    ['ExposureMode', 3, 3],
    ['WhiteBalance', 0, 'Auto'],
    ['WhiteBalance', 1, 'Manual'],
    ['WhiteBalance', 2, 2],
    ['SceneCaptureType', 0, 'Standard'],
    ['SceneCaptureType', 1, 'Landscape'],
    ['SceneCaptureType', 2, 'Portrait'],
    ['SceneCaptureType', 3, 'Night'],
    ['SceneCaptureType', 4, 4],
    // GainControl
    ['GainControl', 0, 'None'],
    ['GainControl', 1, 'Low gain up'],
    ['GainControl', 2, 'High gain up'],
    ['GainControl', 3, 'Low gain down'],
    ['GainControl', 4, 'High gain down'],
    ['GainControl', 5, 5],
    // Contrast / Saturation / Sharpness
    ['Contrast', 0, 'Normal'],
    ['Contrast', 1, 'Low'],
    ['Contrast', 2, 'High'],
    ['Contrast', 3, 3],
    ['Saturation', 0, 'Normal'],
    ['Saturation', 1, 'Low'],
    ['Saturation', 2, 'High'],
    ['Saturation', 3, 3],
    ['Sharpness', 0, 'Normal'],
    ['Sharpness', 1, 'Soft'],
    ['Sharpness', 2, 'Hard'],
    ['Sharpness', 3, 3],
    // SubjectDistanceRange
    ['SubjectDistanceRange', 0, 'Unknown'],
    ['SubjectDistanceRange', 1, 'Macro'],
    ['SubjectDistanceRange', 2, 'Close'],
    ['SubjectDistanceRange', 3, 'Distant'],
    ['SubjectDistanceRange', 4, 4],
    // Compression / PhotometricInterpretation / SensingMethod
    ['Compression', 1, 'Uncompressed'],
    ['Compression', 6, 'JPEG'],
    ['Compression', 7, 7],
    ['PhotometricInterpretation', 2, 'RGB'],
    ['PhotometricInterpretation', 6, 'YCbCr'],
    ['PhotometricInterpretation', 0, 0],
    ['SensingMethod', 1, 'Monochrome area'],
    ['SensingMethod', 2, 'One-chip color area'],
    ['SensingMethod', 3, 'Two-chip color area'],
    ['SensingMethod', 4, 'Three-chip color area'],
    ['SensingMethod', 5, 'Color sequential area'],
    ['SensingMethod', 7, 'Trilinear'],
    ['SensingMethod', 8, 'Color sequential linear'],
    ['SensingMethod', 6, 6],
  ];
  for (const [tag, value, expected] of cases) {
    assertEquals(formatExifValue(value, tag), expected, `${tag}=${value}`);
  }
});

Deno.test('formatExifValue leaves non-matching types untouched for typed tags', () => {
  assertEquals(formatExifValue('str', 'ExposureProgram'), 'str');
  assertEquals(formatExifValue(2, 'GPSMeasureMode'), 2);
  assertEquals(formatExifValue('A', 'GPSDifferential'), 'A');
});

// ---------- bulky summarization fallback ----------

Deno.test('formatExifValue summarizes known bulky tags', () => {
  assertEquals(formatExifValue(new Uint8Array(768), 'TransferFunction'), '[768-entry LUT]');
  assertEquals(formatExifValue(new Uint8Array(120), 'MakerNote'), '[MakerNote: 120 bytes]');
  assertEquals(formatExifValue([1, 2, 3], 'MakerNote'), '[MakerNote: 3 bytes]');
  assertEquals(formatExifValue('str', 'MakerNote'), '[MakerNote: 0 bytes]');
  assertEquals(formatExifValue(new Uint8Array(300), 'ICC_Profile'), '[ICC profile: 300 bytes]');
  assertEquals(formatExifValue('<x/>'.repeat(600), 'XMP'), '[XML document: 2400 chars]');
});

Deno.test('formatExifValue summarizes unknown large values by shape', () => {
  const big = new Uint8Array(65);
  assertEquals(formatExifValue(big, 'CFAPattern'), `[${big.length} bytes]`);
  const small = new Uint8Array([1, 2, 3]);
  assertEquals(formatExifValue(small, 'CFAPattern'), '[1, 2, 3]');
  assertEquals(formatExifValue(Array.from({ length: 51 }, (_, i) => i), 'SubjectArea'), '[51 entries]');
  assertEquals(formatExifValue('x'.repeat(1025), 'UserComment'), '[string: 1025 chars]');
  assertEquals(formatExifValue(42, 'PixelXDimension'), 42);
});
