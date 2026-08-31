import { getExifTypeSize } from './types.js';
import type { IfdEntry } from './types.js';
import type { TagValue } from '../types.js';

/**
 * Reads a RATIONAL/SRATIONAL field as its raw "numerator/denominator" string.
 *
 * ExifTool keeps raw rationals in TAG_EXTRA for a handful of tags because the
 * numerator/denominator pair carries information the quotient loses. The one
 * case we rely on is Canon FocalPlaneX/YResolution, where the denominator
 * encodes the physical sensor size (see CalcSensorDiag in Canon.pm).
 */
export function readRationalRaw(
  view: DataView,
  offset: number,
  littleEndian: boolean,
  signed = false,
): string {
  const num = signed ? view.getInt32(offset, littleEndian) : view.getUint32(offset, littleEndian);
  const den = signed ? view.getInt32(offset + 4, littleEndian) : view.getUint32(offset + 4, littleEndian);
  return `${num}/${den}`;
}

export function readIfdValue(entry: IfdEntry, view: DataView, littleEndian: boolean): TagValue {
  const { type, count, offset } = entry;
  const typeSize = getExifTypeSize(type);

  if (count === 0) return null;

  if (count === 1) {
    return readSingleValue(view, offset, type, littleEndian);
  }

  const totalBytes = count * typeSize;

  if (type === 2) {
    return readASCII(view, offset, count);
  }

  if (type === 7) {
    return new Uint8Array(view.buffer, view.byteOffset + offset, totalBytes);
  }

  const result: TagValue[] = [];
  for (let i = 0; i < count; i++) {
    const valOffset = offset + i * typeSize;
    result.push(readSingleValue(view, valOffset, type, littleEndian));
  }


  if (type === 5 || type === 10) {
    return result as TagValue;
  }

  return result as TagValue;
}

function readSingleValue(
  view: DataView,
  offset: number,
  type: number,
  littleEndian: boolean,
): TagValue {
  switch (type) {
    case 1:
      return view.getUint8(offset);
    case 6:
      return view.getInt8(offset);
    case 7:
      return view.getUint8(offset);
    case 3:
      return view.getUint16(offset, littleEndian);
    case 8:
      return view.getInt16(offset, littleEndian);
    case 4:
      return view.getUint32(offset, littleEndian);
    case 9:
      return view.getInt32(offset, littleEndian);
    case 11:
      return view.getFloat32(offset, littleEndian);
    case 12:
      return view.getFloat64(offset, littleEndian);
    case 13:
      return view.getUint32(offset, littleEndian);
    case 16:
      return Number(view.getBigUint64(offset, littleEndian));
    case 17:
      return Number(view.getBigInt64(offset, littleEndian));
    case 18:
      return Number(view.getBigUint64(offset, littleEndian));
    case 5: {
      const num = view.getUint32(offset, littleEndian);
      const den = view.getUint32(offset + 4, littleEndian);
      if (den === 0) return 0;
      return num / den;
    }
    case 10: {
      const num = view.getInt32(offset, littleEndian);
      const den = view.getInt32(offset + 4, littleEndian);
      if (den === 0) return 0;
      return num / den;
    }
    default:
      return 0;
  }
}

function readASCII(view: DataView, offset: number, count: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, count);
  const end = bytes.indexOf(0);
  const valid = end >= 0 ? bytes.slice(0, end) : bytes;
  return new TextDecoder().decode(valid);
}

const KNOWN_TAGS: Record<number, string> = {
  0x0100: 'ImageWidth',
  0x0101: 'ImageLength',
  0x0102: 'BitsPerSample',
  0x0103: 'Compression',
  0x0106: 'PhotometricInterpretation',
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0111: 'StripOffsets',
  0x0112: 'Orientation',
  0x0115: 'SamplesPerPixel',
  0x0116: 'RowsPerStrip',
  0x0117: 'StripByteCounts',
  0x011a: 'XResolution',
  0x011b: 'YResolution',
  0x011c: 'PlanarConfiguration',
  0x0128: 'ResolutionUnit',
  0x012d: 'TransferFunction',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x013b: 'Artist',
  0x013c: 'HostComputer',
  0x0201: 'ThumbnailOffset',
  0x0202: 'ThumbnailLength',
  0x0211: 'YCbCrCoefficients',
  0x0212: 'YCbCrSubSampling',
  0x0213: 'YCbCrPositioning',
  0x0214: 'ReferenceBlackWhite',
  0x8298: 'Copyright',
  0x8769: 'ExifIFD',
  0x8825: 'GPSInfo',
  0xa005: 'InteropIFD',
};

const EXIF_TAG_NAMES: Record<number, string> = {
  0x829a: 'ExposureTime',
  0x829d: 'FNumber',
  0x8822: 'ExposureProgram',
  0x8824: 'SpectralSensitivity',
  0x8827: 'ISOSpeedRatings',
  0x8828: 'OECF',
  0x8830: 'SensitivityType',
  0x8831: 'StandardOutputSensitivity',
  0x8832: 'RecommendedExposureIndex',
  0x8833: 'ISOSpeed',
  0x8834: 'ISOSpeedLatitudeyyy',
  0x8835: 'ISOSpeedLatitudezzz',
  0x9000: 'ExifVersion',
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0x9101: 'ComponentsConfiguration',
  0x9102: 'CompressedBitsPerPixel',
  0x9201: 'ShutterSpeedValue',
  0x9202: 'ApertureValue',
  0x9203: 'BrightnessValue',
  0x9204: 'ExposureBiasValue',
  0x9205: 'MaxApertureValue',
  0x9206: 'SubjectDistance',
  0x9207: 'MeteringMode',
  0x9208: 'LightSource',
  0x9209: 'Flash',
  0x920a: 'FocalLength',
  0x9214: 'SubjectArea',
  0x927c: 'MakerNote',
  0x9286: 'UserComment',
  0x9290: 'SubSecTime',
  0x9291: 'SubSecTimeOriginal',
  0x9292: 'SubSecTimeDigitized',
  0xa000: 'FlashpixVersion',
  0xa001: 'ColorSpace',
  0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension',
  0xa004: 'RelatedSoundFile',
  0xa20b: 'FlashEnergy',
  0xa20c: 'SpatialFrequencyResponse',
  0xa20e: 'FocalPlaneXResolution',
  0xa20f: 'FocalPlaneYResolution',
  0xa210: 'FocalPlaneResolutionUnit',
  0xa214: 'SubjectLocation',
  0xa215: 'ExposureIndex',
  0xa217: 'SensingMethod',
  0xa300: 'FileSource',
  0xa301: 'SceneType',
  0xa302: 'CFAPattern',
  0xa401: 'CustomRendered',
  0xa402: 'ExposureMode',
  0xa403: 'WhiteBalance',
  0xa404: 'DigitalZoomRatio',
  0xa405: 'FocalLengthIn35mmFilm',
  0xa406: 'SceneCaptureType',
  0xa407: 'GainControl',
  0xa408: 'Contrast',
  0xa409: 'Saturation',
  0xa40a: 'Sharpness',
  0xa40b: 'DeviceSettingDescription',
  0xa40c: 'SubjectDistanceRange',
  0xa420: 'ImageUniqueID',
  0xa430: 'CameraOwnerName',
  0xa431: 'BodySerialNumber',
  0xa432: 'LensSpecification',
  0xa433: 'LensMake',
  0xa434: 'LensModel',
  0xa435: 'LensSerialNumber',
  0xa500: 'Gamma',
};

const GPS_TAG_NAMES: Record<number, string> = {
  0x00: 'GPSVersionID',
  0x01: 'GPSLatitudeRef',
  0x02: 'GPSLatitude',
  0x03: 'GPSLongitudeRef',
  0x04: 'GPSLongitude',
  0x05: 'GPSAltitudeRef',
  0x06: 'GPSAltitude',
  0x07: 'GPSTimeStamp',
  0x08: 'GPSSatellites',
  0x09: 'GPSStatus',
  0x0a: 'GPSMeasureMode',
  0x0b: 'GPSDOP',
  0x0c: 'GPSSpeedRef',
  0x0d: 'GPSSpeed',
  0x0e: 'GPSTrackRef',
  0x0f: 'GPSTrack',
  0x10: 'GPSImgDirectionRef',
  0x11: 'GPSImgDirection',
  0x12: 'GPSMapDatum',
  0x13: 'GPSDestLatitudeRef',
  0x14: 'GPSDestLatitude',
  0x15: 'GPSDestLongitudeRef',
  0x16: 'GPSDestLongitude',
  0x17: 'GPSDestBearingRef',
  0x18: 'GPSDestBearing',
  0x19: 'GPSDestDistanceRef',
  0x1a: 'GPSDestDistance',
  0x1b: 'GPSProcessingMethod',
  0x1c: 'GPSAreaInformation',
  0x1d: 'GPSDateStamp',
  0x1e: 'GPSDifferential',
  0x1f: 'GPSHPositioningError',
};

export function getTagName(tag: number, table: 'ifd0' | 'exif' | 'gps'): string | undefined {
  if (table === 'ifd0') return KNOWN_TAGS[tag];
  if (table === 'exif') return EXIF_TAG_NAMES[tag];
  if (table === 'gps') return GPS_TAG_NAMES[tag];
  return undefined;
}

export const EXIF_POINTER_TAGS = new Set([
  'ExifIFD',
  'GPSInfo',
  'InteropIFD',
]);

const BULKY_TAG_SUMMARIES: Record<string, (v: TagValue) => string> = {
  TransferFunction: () => '[768-entry LUT]',
  MakerNote: (v) => `[MakerNote: ${byteLength(v)} bytes]`,
  ICC_Profile: (v) => `[ICC profile: ${byteLength(v)} bytes]`,
  XMP: (v) => `[XML document: ${stringLength(v)} chars]`,
};

function byteLength(v: TagValue): number {
  if (v instanceof Uint8Array) return v.length;
  if (Array.isArray(v)) return v.length;
  return 0;
}

function stringLength(v: TagValue): number {
  return typeof v === 'string' ? v.length : 0;
}

function summarizeBulky(value: TagValue, tagName: string): TagValue {
  const summarizer = BULKY_TAG_SUMMARIES[tagName];
  if (summarizer) return summarizer(value);

  if (value instanceof Uint8Array) {
    return value.length > 64 ? `[${value.length} bytes]` : `[${Array.from(value).join(', ')}]`;
  }

  if (Array.isArray(value) && value.length > 50) {
    return `[${value.length} entries]`;
  }

  if (typeof value === 'string' && value.length > 1024) {
    return `[string: ${value.length} chars]`;
  }

  return value;
}

function formatExifVersion(value: TagValue): string {
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value).replace(/\0+$/, '');
  }
  if (Array.isArray(value)) {
    return value.map((v) => String.fromCharCode(Number(v))).join('').replace(/\0+$/, '');
  }
  return String(value);
}

/**
 * ExifTool's exact Flash PrintConv, captured empirically from exiftool 13.55
 * (scripts/flash-table.mts). Unknown combinations render as Unknown (0xNN).
 */
const FLASH_TABLE: Record<number, string> = {
  0x00: 'No Flash',
  0x01: 'Fired',
  0x05: 'Fired, Return not detected',
  0x07: 'Fired, Return detected',
  0x08: 'On, Did not fire',
  0x09: 'On, Fired',
  0x10: 'Off, Did not fire',
  0x14: 'Off, Did not fire, Return not detected',
  0x18: 'Auto, Did not fire',
  0x19: 'Auto, Fired',
  0x1d: 'Auto, Fired, Return not detected',
  0x20: 'No flash function',
  0x30: 'Off, No flash function',
  0x41: 'Fired, Red-eye reduction',
  0x45: 'Fired, Red-eye reduction, Return not detected',
  0x47: 'Fired, Red-eye reduction, Return detected',
  0x49: 'On, Red-eye reduction',
  0x4d: 'On, Red-eye reduction, Return not detected',
  0x4f: 'On, Red-eye reduction, Return detected',
  0x50: 'Off, Red-eye reduction',
  0x58: 'Auto, Did not fire, Red-eye reduction',
  0x59: 'Auto, Fired, Red-eye reduction',
  0x5d: 'Auto, Fired, Red-eye reduction, Return not detected',
};

function formatFlash(value: number): string {
  return FLASH_TABLE[value] ?? `Unknown (0x${value.toString(16)})`;
}

const ENUMS: Record<string, Record<number | string, string>> = {
  ExposureProgram: {
    0: 'Not Defined',
    1: 'Manual',
    2: 'Program AE',
    3: 'Aperture-priority AE',
    4: 'Shutter speed priority AE',
    5: 'Creative (Slow speed)',
    6: 'Action (High speed)',
    7: 'Portrait',
    8: 'Landscape',
    9: 'Bulb',
  },
  MeteringMode: {
    0: 'Unknown',
    1: 'Average',
    2: 'Center-weighted average',
    3: 'Spot',
    4: 'Multi-spot',
    5: 'Multi-segment',
    6: 'Partial',
    255: 'Other',
  },
  LightSource: {
    0: 'Unknown',
    1: 'Daylight',
    2: 'Fluorescent',
    3: 'Tungsten (Incandescent)',
    4: 'Flash',
    9: 'Fine Weather',
    10: 'Cloudy',
    11: 'Shade',
    12: 'Daylight Fluorescent',
    13: 'Day White Fluorescent',
    14: 'Cool White Fluorescent',
    15: 'White Fluorescent',
    16: 'Warm White Fluorescent',
    17: 'Standard Light A',
    18: 'Standard Light B',
    19: 'Standard Light C',
    20: 'D55',
    21: 'D65',
    22: 'D75',
    23: 'D50',
    24: 'ISO Studio Tungsten',
    255: 'Other',
  },
  ColorSpace: {
    1: 'sRGB',
    2: 'Adobe RGB',
    65535: 'Uncalibrated',
  },
  CustomRendered: {
    0: 'Normal',
    1: 'Custom',
  },
  ExposureMode: {
    0: 'Auto',
    1: 'Manual',
    2: 'Auto bracket',
  },
  WhiteBalance: {
    0: 'Auto',
    1: 'Manual',
  },
  SceneCaptureType: {
    0: 'Standard',
    1: 'Landscape',
    2: 'Portrait',
    3: 'Night',
  },
  GainControl: {
    0: 'None',
    1: 'Low gain up',
    2: 'High gain up',
    3: 'Low gain down',
    4: 'High gain down',
  },
  Contrast: {
    0: 'Normal',
    1: 'Low',
    2: 'High',
  },
  Saturation: {
    0: 'Normal',
    1: 'Low',
    2: 'High',
  },
  Sharpness: {
    0: 'Normal',
    1: 'Soft',
    2: 'Hard',
  },
  SubjectDistanceRange: {
    0: 'Unknown',
    1: 'Macro',
    2: 'Close',
    3: 'Distant',
  },
  SensitivityType: {
    0: 'Unknown',
    1: 'Standard Output Sensitivity',
    2: 'Recommended Exposure Index',
    3: 'ISO Speed',
    4: 'Standard Output Sensitivity and Recommended Exposure Index',
    5: 'Standard Output Sensitivity and ISO Speed',
    6: 'Recommended Exposure Index and ISO Speed',
    7: 'Standard Output Sensitivity, Recommended Exposure Index and ISO Speed',
  },
  FileSource: {
    1: 'Film Scanner',
    2: 'Reflection Print Scanner',
    3: 'Digital Camera',
  },
  SceneType: {
    1: 'Directly photographed',
  },
  SensingMethod: {
    1: 'Monochrome area',
    2: 'One-chip color area',
    3: 'Two-chip color area',
    4: 'Three-chip color area',
    5: 'Color sequential area',
    7: 'Trilinear',
    8: 'Color sequential linear',
  },
  Compression: {
    1: 'Uncompressed',
    6: 'JPEG',
  },
  PhotometricInterpretation: {
    2: 'RGB',
    6: 'YCbCr',
  },
  GPSStatus: {
    'A': 'Measurement Active',
    'V': 'Measurement Void',
  },
  GPSMeasureMode: {
    '2': '2-Dimensional Measurement',
    '3': '3-Dimensional Measurement',
  },
  GPSDifferential: {
    0: 'No Correction',
    1: 'Differential Corrected',
  },
};

function formatGPSRationalArray(value: TagValue, ref?: string): string {
  if (!Array.isArray(value) || value.length < 2) return String(value);
  const deg = Number(value[0]);
  const min = Number(value[1]);
  const sec = value.length > 2 ? Number(value[2]) : 0;
  const secRounded = Math.round(sec * 100) / 100;
  const dir = ref === 'N' ? 'N' : ref === 'S' ? 'S' : ref === 'E' ? 'E' : ref === 'W' ? 'W' : '';
  if (secRounded > 0) {
    return `${deg} deg ${min}' ${secRounded.toFixed(2)}"${dir ? ` ${dir}` : ''}`;
  }
  return `${deg} deg ${min.toFixed(4)}'${dir ? ` ${dir}` : ''}`;
}

function formatGPSTimeStamp(value: TagValue): string {
  if (!Array.isArray(value) || value.length < 2) return String(value);
  const h = Math.floor(Number(value[0]));
  const m = Math.floor(Number(value[1]));
  const s = value.length > 2 ? Number(value[2]) : 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.round(s)).padStart(2, '0')}`;
}

function formatGPSVersionID(value: TagValue): string {
  if (Array.isArray(value)) return value.join('.');
  if (value instanceof Uint8Array) return [...value].join('.');
  return String(value);
}

function formatComponentsConfiguration(value: TagValue): string {
  const COMP_MAP: Record<number, string> = {
    0: '-',
    1: 'Y',
    2: 'Cb',
    3: 'Cr',
    4: 'R',
    5: 'G',
    6: 'B',
  };
  if (value instanceof Uint8Array) {
    return [...value].map((b) => COMP_MAP[b] ?? '?').join(', ');
  }
  if (Array.isArray(value)) {
    return value.map((v) => COMP_MAP[Number(v)] ?? '?').join(', ');
  }
  return String(value);
}

function formatExposureTime(value: number): string {
  if (value >= 1) return `${Math.round(value * 100) / 100}`;
  const denom = Math.round(1 / value);
  return `1/${denom}`;
}


function formatShutterSpeedValue(value: number): string {
  const ap = Math.pow(2, -value);
  if (ap >= 1) return `${Math.round(ap * 100) / 100}`;
  const denom = Math.round(1 / ap);
  return `1/${denom}`;
}

export function formatExifValue(value: TagValue, tagName: string): TagValue {
  if (
    tagName === 'FocalPlaneXResolution' ||
    tagName === 'FocalPlaneYResolution'
  ) {
    if (typeof value === 'number') {
      return String(Number(value.toFixed(6)));
    }
  }

  if (tagName === 'ExifVersion' || tagName === 'FlashpixVersion') {
    return formatExifVersion(value);
  }

  if (tagName === 'FocalLength') {
    if (typeof value === 'number') {
      return `${value.toFixed(1)} mm`;
    }
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      return `${(value[0] / value[1]).toFixed(1)} mm`;
    }
  }

  if (tagName === 'FocalLengthIn35mmFormat') {
    if (typeof value === 'number') {
      // exiftool trims the trailing .0 here: 50 -> '50 mm'.
      return `${Number(value.toFixed(1))} mm`;
    }
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      return `${Number((value[0] / value[1]).toFixed(1))} mm`;
    }
  }

  if (
    (tagName === 'ApertureValue' || tagName === 'MaxApertureValue') &&
    typeof value === 'number'
  ) {
    // APEX value -> f-number; exiftool trims the trailing .0 for integers.
    const fnumber = Math.round(2 ** (value / 2) * 10) / 10;
    return Number.isInteger(fnumber) ? String(fnumber) : fnumber.toFixed(1);
  }

  if (tagName === 'ComponentsConfiguration') {
    return formatComponentsConfiguration(value);
  }

  if (tagName === 'Orientation' && typeof value === 'number') {
    const ORIENTATIONS: Record<number, string> = {
      1: 'Horizontal (normal)',
      2: 'Mirror horizontal',
      3: 'Rotate 180',
      4: 'Mirror vertical',
      5: 'Mirror horizontal and rotate 270 CW',
      6: 'Rotate 90 CW',
      7: 'Mirror horizontal and rotate 90 CW',
      8: 'Rotate 270 CW',
    };
    return ORIENTATIONS[value] ?? value;
  }

  if ((tagName === 'ResolutionUnit' || tagName === 'FocalPlaneResolutionUnit' || tagName === 'Thumbnail_ResolutionUnit') && typeof value === 'number') {
    return value === 2 ? 'inches' : value === 3 ? 'cm' : value;
  }

  if (tagName === 'Flash' && typeof value === 'number') {
    return formatFlash(value);
  }

  if (tagName === 'ExposureTime' && typeof value === 'number') {
    return formatExposureTime(value);
  }

  if (tagName === 'ShutterSpeedValue' && typeof value === 'number') {
    return formatShutterSpeedValue(value);
  }

  if (tagName === 'GPSVersionID') {
    return formatGPSVersionID(value);
  }

  if (tagName === 'GPSLatitude' || tagName === 'GPSLongitude') {
    const refKey = tagName === 'GPSLatitude' ? 'GPSLatitudeRef' : 'GPSLongitudeRef';
    return formatGPSRationalArray(value);
  }

  if (tagName === 'GPSTimeStamp') {
    return formatGPSTimeStamp(value);
  }

  if (tagName === 'GPSStatus' && typeof value === 'string') {
    return ENUMS.GPSStatus[value] ?? value;
  }

  if (tagName === 'GPSMeasureMode' && typeof value === 'string') {
    return ENUMS.GPSMeasureMode[value] ?? value;
  }

  if (tagName === 'GPSDifferential' && typeof value === 'number') {
    return ENUMS.GPSDifferential[value] ?? value;
  }

  if (
    (tagName === 'GPSLatitudeRef' || tagName === 'GPSDestLatitudeRef') &&
    typeof value === 'string'
  ) {
    return value === 'N' ? 'North' : value === 'S' ? 'South' : value;
  }

  if (
    (tagName === 'GPSLongitudeRef' || tagName === 'GPSDestLongitudeRef') &&
    typeof value === 'string'
  ) {
    return value === 'E' ? 'East' : value === 'W' ? 'West' : value;
  }

  if (tagName === 'YCbCrPositioning' && typeof value === 'number') {
    return value === 1 ? 'Centered' : value === 2 ? 'Co-sited' : value;
  }

  if (tagName === 'LensInfo' && Array.isArray(value)) {
    // ExifTool renders the focal/aperture quartet as '28-75mm f/2.8',
    // deduping equal apertures and rendering 0/unknown as '?'.
    const [min, max, amin, amax] = value.map((v) => Number(v));
    const mm = !min || !max
      ? '?mm'
      : min === max
        ? `${min}mm`
        : `${min}-${max}mm`;
    const ap = !amin || !amax
      ? 'f/?'
      : amin === amax
        ? `f/${amin}`
        : `f/${amin}-${amax}`;
    return `${mm} ${ap}`;
  }

  if (tagName === 'LightSource' && typeof value === 'number') {
    return ENUMS.LightSource[value] ?? value;
  }

  if (tagName === 'ExposureProgram' && typeof value === 'number') {
    return ENUMS.ExposureProgram[value] ?? value;
  }

  if (tagName === 'MeteringMode' && typeof value === 'number') {
    return ENUMS.MeteringMode[value] ?? value;
  }


  if (tagName === 'ColorSpace' && typeof value === 'number') {
    return ENUMS.ColorSpace[value] ?? value;
  }

  if (tagName === 'SensitivityType' && typeof value === 'number') {
    return ENUMS.SensitivityType[value] ?? value;
  }

  if (tagName === 'FileSource' && typeof value === 'number') {
    return ENUMS.FileSource[value] ?? value;
  }

  if (tagName === 'SceneType' && typeof value === 'number') {
    return ENUMS.SceneType[value] ?? value;
  }

  if (tagName === 'CustomRendered' && typeof value === 'number') {
    return ENUMS.CustomRendered[value] ?? value;
  }

  if (tagName === 'ExposureMode' && typeof value === 'number') {
    return ENUMS.ExposureMode[value] ?? value;
  }

  if (tagName === 'WhiteBalance' && typeof value === 'number') {
    return ENUMS.WhiteBalance[value] ?? value;
  }

  if (tagName === 'SceneCaptureType' && typeof value === 'number') {
    return ENUMS.SceneCaptureType[value] ?? value;
  }

  if (tagName === 'GainControl' && typeof value === 'number') {
    return ENUMS.GainControl[value] ?? value;
  }

  if (tagName === 'Contrast' && typeof value === 'number') {
    return ENUMS.Contrast[value] ?? value;
  }

  if (tagName === 'Saturation' && typeof value === 'number') {
    return ENUMS.Saturation[value] ?? value;
  }

  if (tagName === 'Sharpness' && typeof value === 'number') {
    return ENUMS.Sharpness[value] ?? value;
  }

  if (tagName === 'SubjectDistanceRange' && typeof value === 'number') {
    return ENUMS.SubjectDistanceRange[value] ?? value;
  }

  if (tagName === 'ExposureCompensation' && typeof value === 'number') {
    // ExifTool prints the stored rational as a fraction (-2/3).
    return toFraction(value);
  }

  if (tagName === 'Compression' && typeof value === 'number') {
    return ENUMS.Compression[value] ?? value;
  }

  if (tagName === 'PhotometricInterpretation' && typeof value === 'number') {
    return ENUMS.PhotometricInterpretation[value] ?? value;
  }

  if (tagName === 'SensingMethod' && typeof value === 'number') {
    return ENUMS.SensingMethod[value] ?? value;
  }

  return summarizeBulky(value, tagName);
}

/** Continued-fraction approximation; denominators capped at 100. */
function toFraction(v: number): string {
  const sign = v < 0 ? '-' : '';
  let x = Math.abs(v);
  let [n1, n0, d1, d0] = [1, 0, 0, 1];
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(x);
    const n2 = a * n1 + n0;
    const d2 = a * d1 + d0;
    if (d2 > 100) break;
    [n1, n0] = [n2, n1];
    [d1, d0] = [d2, d1];
    const frac = x - a;
    if (frac < 1e-9) break;
    x = 1 / frac;
  }
  return d1 === 1 ? `${sign}${n1}` : `${sign}${n1}/${d1}`;
}
