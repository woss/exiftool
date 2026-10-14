import type { ContainerWriter, TagValue } from '../types.js';
import {
  buildTiff,
  encodeValue,
  EXIF_IFD_TAGS,
  GPS_IFD_TAGS,
  IFD0_TAGS,
  INTEROP_IFD_TAGS,
  prepareGpsCoordinateValue,
  type IfdTagSpec,
} from '../exif/tiff-builder.js';
import { UnsupportedFormatError } from './writers.js';
import {
  deleteXmpProperties,
  toXmpPropertyName,
  toXmpPropertyRequest,
  writeXmpPacket,
  type XmpPropertyRequest,
  type XmpWriteValue,
} from './xmp-writer.js';
import {
  hasPhotoshopResource,
  mergePhotoshopIrb,
  resolveIptcWriteRequest,
  resolvePhotoshopResourceWriteRequest,
  type IptcWriteRequest,
  type PhotoshopResourceWriteRequest,
} from './iptc.js';
import { mergeDucky } from '../exif/ducky.js';
import { md5Hex } from '../utils/md5.js';

/**
 * Merge-write key convention (exported, documented):
 *
  for (const ifd of ifds) {
    chainOffsets.set(ifd, ifd.next ? offsets[ifds.indexOf(ifd.next)] : 0);
    for (const entry of ifd.entries) {
      if (entry.sub) chainOffsets.set(entry.sub, offsets[ifds.indexOf(entry.sub)]);
 * ('Copyright' == 'exif:copyright', 'WebStatement' == 'xmp-xmpRights:WebStatement').
 * Any other key from IFD0_TAGS/EXIF_IFD_TAGS/GPS_IFD_TAGS may also be written
 * with an 'EXIF:' prefix (e.g. 'EXIF:Make'); it is patched in place when the
 * entry exists, appended when the home IFD exists, and reported as skipped
 * when the tag's home sub-IFD (ExifIFD/GPS) is absent from the file.
 */
export type MergeTagKey =
  | 'EXIF:Copyright'
  | 'EXIF:Orientation'
  | 'XMP-dc:Rights'
  | 'XMP-xmpRights:WebStatement'
  | 'XMP-dc:Subject'
  | 'XMP-dc:Title'
  | 'XMP-dc:Description'
  | 'XMP-xmp:MetadataDate'
  | 'IPTC:Keywords';

export const MERGE_TAG_KEYS: Record<string, MergeTagKey> = {
  'exif:copyright': 'EXIF:Copyright',
  'exif:orientation': 'EXIF:Orientation',
  'xmp-dc:rights': 'XMP-dc:Rights',
  'xmp-xmprights:webstatement': 'XMP-xmpRights:WebStatement',
  'xmp-dc:subject': 'XMP-dc:Subject',
  'xmp-dc:title': 'XMP-dc:Title',
  'xmp-dc:description': 'XMP-dc:Description',
  'xmp-xmp:metadatadate': 'XMP-xmp:MetadataDate',
  'iptc:keywords': 'IPTC:Keywords',
};

export interface ExifRequest {
  /** Canonical reported name */
  key: string;
  spec: IfdTagSpec;
  value: TagValue;
  /** Home IFD: 0 = IFD0, otherwise the sub-IFD pointer tag id */
  home: 0 | 0x8769 | 0x8825 | 0xa005;
}

/** Canonical XMP property name for each merge key. */
const XMP_PROPERTY_NAMES: Partial<Record<MergeTagKey, string>> = {
  'XMP-dc:Rights': 'dc:rights',
  'XMP-xmpRights:WebStatement': 'xmpRights:WebStatement',
  'XMP-dc:Subject': 'dc:subject',
  'XMP-dc:Title': 'dc:title',
  'XMP-dc:Description': 'dc:description',
  'XMP-xmp:MetadataDate': 'xmp:MetadataDate',
};

/** Bare aliases (prefix optional): 'Copyright', 'Rights', 'WebStatement', … */
const MERGE_TAG_KEYS_BARE: Record<string, MergeTagKey> = {
  copyright: 'EXIF:Copyright',
  orientation: 'EXIF:Orientation',
  rights: 'XMP-dc:Rights',
  webstatement: 'XMP-xmpRights:WebStatement',
  subject: 'XMP-dc:Subject',
  keywords: 'XMP-dc:Subject',
  title: 'XMP-dc:Title',
  description: 'XMP-dc:Description',
  metadatadate: 'XMP-xmp:MetadataDate',
};

export interface MergeRequests {
  exif: ExifRequest[];
  xmp: XmpPropertyRequest[];
  xmpKeys: string[];
  xmpDeletes: string[];
  xmpDeleteKeys: string[];
  iptc: IptcWriteRequest[];
  iptcKeys: string[];
  photoshop: PhotoshopResourceWriteRequest[];
  comment?: { key: string; value: string | null };
  jfif: Array<{ key: string; field: 'unit' | 'x' | 'y'; value: number }>;
  icc?: { key: string; value: Uint8Array | null };
  ducky: Array<{ key: string; id: number; value: TagValue }>;
  skipped: string[];
}

const EXIF_IFD_POINTERS = new Set([0x8769, 0x8825, 0xa005]);
const ORIENTATION_VALUES: Record<string, number> = {
  'horizontal (normal)': 1,
  'mirror horizontal': 2,
  'rotate 180': 3,
  'mirror vertical': 4,
  'mirror horizontal and rotate 270 cw': 5,
  'rotate 90 cw': 6,
  'mirror horizontal and rotate 90 cw': 7,
  'rotate 270 cw': 8,
};
const EXPOSURE_PROGRAM_VALUES: Record<string, number> = {
  'not defined': 0,
  manual: 1,
  'program ae': 2,
  'aperture-priority ae': 3,
  'shutter speed priority ae': 4,
  'creative (slow speed)': 5,
  'action (high speed)': 6,
  portrait: 7,
  landscape: 8,
  bulb: 9,
};
const METERING_MODE_VALUES: Record<string, number> = {
  unknown: 0,
  average: 1,
  'center-weighted average': 2,
  spot: 3,
  'multi-spot': 4,
  'multi-segment': 5,
  partial: 6,
  other: 255,
};
const LIGHT_SOURCE_VALUES: Record<string, number> = {
  unknown: 0,
  daylight: 1,
  fluorescent: 2,
  'tungsten (incandescent)': 3,
  flash: 4,
  'fine weather': 9,
  cloudy: 10,
  shade: 11,
  'daylight fluorescent': 12,
  'day white fluorescent': 13,
  'cool white fluorescent': 14,
  'white fluorescent': 15,
  'warm white fluorescent': 16,
  'standard light a': 17,
  'standard light b': 18,
  'standard light c': 19,
  d55: 20,
  d65: 21,
  d75: 22,
  d50: 23,
  'iso studio tungsten': 24,
  other: 255,
};
const CUSTOM_RENDERED_VALUES: Record<string, number> = {
  normal: 0,
  custom: 1,
  'hdr (no original saved)': 2,
  'hdr (original saved)': 3,
  'original (for hdr)': 4,
  panorama: 6,
  'portrait hdr': 7,
  portrait: 8,
};
const EXPOSURE_MODE_VALUES: Record<string, number> = {
  auto: 0,
  manual: 1,
  'auto bracket': 2,
};
const WHITE_BALANCE_VALUES: Record<string, number> = {
  auto: 0,
  manual: 1,
};
const SCENE_CAPTURE_TYPE_VALUES: Record<string, number> = {
  standard: 0,
  landscape: 1,
  portrait: 2,
  night: 3,
  other: 4,
};
const GAIN_CONTROL_VALUES: Record<string, number> = {
  none: 0,
  'low gain up': 1,
  'high gain up': 2,
  'low gain down': 3,
  'high gain down': 4,
};
const CONTRAST_VALUES: Record<string, number> = { normal: 0, low: 1, high: 2 };
const SATURATION_VALUES: Record<string, number> = { normal: 0, low: 1, high: 2 };
const SHARPNESS_VALUES: Record<string, number> = { normal: 0, soft: 1, hard: 2 };
const SUBJECT_DISTANCE_RANGE_VALUES: Record<string, number> = {
  unknown: 0,
  macro: 1,
  close: 2,
  distant: 3,
};
const COMPOSITE_IMAGE_VALUES: Record<string, number> = {
  unknown: 0,
  'not a composite image': 1,
  'general composite image': 2,
  'composite image captured while shooting': 3,
};
const SENSING_METHOD_VALUES: Record<string, number> = {
  'not defined': 1,
  'one-chip color area': 2,
  'two-chip color area': 3,
  'three-chip color area': 4,
  'color sequential area': 5,
  trilinear: 7,
  'color sequential linear': 8,
};
const SENSITIVITY_TYPE_VALUES: Record<string, number> = {
  unknown: 0,
  'standard output sensitivity': 1,
  'recommended exposure index': 2,
  'iso speed': 3,
  'standard output sensitivity and recommended exposure index': 4,
  'standard output sensitivity and iso speed': 5,
  'recommended exposure index and iso speed': 6,
  'standard output sensitivity, recommended exposure index and iso speed': 7,
};
const RESOLUTION_UNIT_VALUES: Record<string, number> = {
  none: 1,
  inches: 2,
  cm: 3,
};
const COLOR_SPACE_VALUES: Record<string, number> = {
  'srgb': 1,
  'adobe rgb': 2,
  'uncalibrated': 0xFFFF,
  'icc profile': 0xFFFE,
  'wide gamut rgb': 0xFFFD,
};
const FOCAL_PLANE_RESOLUTION_UNIT_VALUES: Record<string, number> = {
  none: 1,
  inches: 2,
  cm: 3,
  mm: 4,
  um: 5,
};
const GPS_DIFFERENTIAL_VALUES: Record<string, number> = {
  'no correction': 0,
  'differential corrected': 1,
};
const GPS_STRING_ENUM_VALUES: Record<string, Record<string, string>> = {
  gpsstatus: { 'measurement active': 'A', 'measurement void': 'V' },
  gpsmeasuremode: { '2-dimensional measurement': '2', '3-dimensional measurement': '3' },
  gpsspeedref: { 'km/h': 'K', 'mph': 'M', knots: 'N' },
  gpstrackref: { 'true north': 'T', 'magnetic north': 'M' },
  gpsimgdirectionref: { 'true north': 'T', 'magnetic north': 'M' },
  gpsdestbearingref: { 'true north': 'T', 'magnetic north': 'M' },
  gpsdestdistanceref: { kilometers: 'K', miles: 'M', 'nautical miles': 'N' },
};
const FLASH_VALUES: Record<string, number> = {
  'no flash': 0x00,
  'fired': 0x01,
  'fired, return not detected': 0x05,
  'fired, return detected': 0x07,
  'on, did not fire': 0x08,
  'on, fired': 0x09,
  'on, return not detected': 0x0d,
  'on, return detected': 0x0f,
  'off, did not fire': 0x10,
  'off, did not fire, return not detected': 0x14,
  'auto, did not fire': 0x18,
  'auto, fired': 0x19,
  'auto, fired, return not detected': 0x1d,
  'auto, fired, return detected': 0x1f,
  'no flash function': 0x20,
  'off, no flash function': 0x30,
  'fired, red-eye reduction': 0x41,
  'fired, red-eye reduction, return not detected': 0x45,
  'fired, red-eye reduction, return detected': 0x47,
  'on, red-eye reduction': 0x49,
  'on, red-eye reduction, return not detected': 0x4d,
  'on, red-eye reduction, return detected': 0x4f,
  'off, red-eye reduction': 0x50,
  'auto, did not fire, red-eye reduction': 0x58,
  'auto, fired, red-eye reduction': 0x59,
  'auto, fired, red-eye reduction, return not detected': 0x5d,
  'auto, fired, red-eye reduction, return detected': 0x5f,
  on: 0x01,
  off: 0x00,
};

function enumWriteValue(values: Record<string, number>, value: TagValue): TagValue {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  const exact = values[normalized];
  if (exact !== undefined) return exact;
  const matches = Object.entries(values).filter(([label]) => label.startsWith(normalized));
  return matches.length === 1 ? matches[0]![1] : value;
}

function exifWriteValue(name: string, value: TagValue): TagValue {
  const normalizedName = name.toLowerCase();
  if (typeof value === 'string' && (normalizedName === 'exifversion' || normalizedName === 'flashpixversion')) {
    const digits = value.replaceAll('.', '');
    if (/^\d{4}$/.test(digits)) return digits;
    if (normalizedName === 'exifversion' && /^\d{3}$/.test(digits)) return `0${digits}`;
  }
  if (normalizedName === 'filesource') {
    if (typeof value === 'string') {
      const labels: Record<string, number> = {
        'film scanner': 1,
        'reflection print scanner': 2,
        'digital camera': 3,
      };
      const normalizedValue = value.trim().toLowerCase();
      if (normalizedValue === 'sigma digital camera') return new Uint8Array([3, 0, 0, 0]);
      const labelValue = labels[normalizedValue];
      if (labelValue !== undefined) return new Uint8Array([labelValue]);
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric < 256) {
        return new Uint8Array([numeric]);
      }
    }
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 256) {
      return new Uint8Array([value]);
    }
  }
  if (normalizedName === 'scenetype') {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'directly photographed') {
      return new Uint8Array([1]);
    }
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return new Uint8Array([numeric & 0xff]);
  }
  if (normalizedName === 'lensinfo' && typeof value === 'string') {
    const match = value.match(
      /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?\s*mm.*?\bf\/?\s*(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/i,
    );
    if (match) {
      return [Number(match[1]), Number(match[2] ?? match[1]), Number(match[3]), Number(match[4] ?? match[3])];
    }
  }
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedName === 'gpsaltituderef') {
      const altitudeRef: Record<string, number> = {
        'above sea level': 0,
        'below sea level': 1,
        'positive sea level (sea-level ref)': 2,
        'negative sea level (sea-level ref)': 3,
      };
      const numeric = altitudeRef[normalizedValue];
      if (numeric !== undefined) return numeric;
    }
    const code = GPS_STRING_ENUM_VALUES[normalizedName]?.[normalizedValue];
    if (code !== undefined) return code;
  }
  if (
    normalizedName === 'aperturevalue' || normalizedName === 'maxaperturevalue' ||
    normalizedName === 'shutterspeedvalue'
  ) {
    const displayValue = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
      ? (() => {
        const fraction = value.trim().match(/^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
        if (fraction) {
          const denominator = Number(fraction[2]);
          return denominator === 0 ? undefined : Number(fraction[1]) / denominator;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : undefined;
      })()
      : undefined;
    if (displayValue !== undefined && Number.isFinite(displayValue)) {
      if (
        normalizedName === 'aperturevalue' || normalizedName === 'maxaperturevalue'
      ) {
        return displayValue > 0 ? 2 * Math.log2(displayValue) : 0;
      }
      if (normalizedName === 'shutterspeedvalue') {
        return displayValue > 0 ? -Math.log2(displayValue) : -100;
      }
    }
  }
  if (normalizedName === 'flash') return enumWriteValue(FLASH_VALUES, value);
  const enumValues = normalizedName === 'exposureprogram'
    ? EXPOSURE_PROGRAM_VALUES
    : normalizedName === 'meteringmode'
    ? METERING_MODE_VALUES
    : normalizedName === 'lightsource'
    ? LIGHT_SOURCE_VALUES
    : normalizedName === 'customrendered'
    ? CUSTOM_RENDERED_VALUES
    : normalizedName === 'exposuremode'
    ? EXPOSURE_MODE_VALUES
    : normalizedName === 'whitebalance'
    ? WHITE_BALANCE_VALUES
    : normalizedName === 'scenecapturetype'
    ? SCENE_CAPTURE_TYPE_VALUES
    : normalizedName === 'gaincontrol'
    ? GAIN_CONTROL_VALUES
    : normalizedName === 'contrast'
    ? CONTRAST_VALUES
    : normalizedName === 'saturation'
    ? SATURATION_VALUES
    : normalizedName === 'sharpness'
    ? SHARPNESS_VALUES
    : normalizedName === 'subjectdistancerange'
    ? SUBJECT_DISTANCE_RANGE_VALUES
    : normalizedName === 'sensingmethod'
    ? SENSING_METHOD_VALUES
    : normalizedName === 'sensitivitytype'
    ? SENSITIVITY_TYPE_VALUES
    : normalizedName === 'compositeimage'
    ? COMPOSITE_IMAGE_VALUES
    : normalizedName === 'resolutionunit'
    ? RESOLUTION_UNIT_VALUES
    : normalizedName === 'colorspace'
    ? COLOR_SPACE_VALUES
    : normalizedName === 'focalplaneresolutionunit'
    ? FOCAL_PLANE_RESOLUTION_UNIT_VALUES
    : normalizedName === 'gpsdifferential'
    ? GPS_DIFFERENTIAL_VALUES
    : undefined;
  if (enumValues) return enumWriteValue(enumValues, value);
  if (typeof value === 'string') {
    const suffix = normalizedName === 'focallength'
      ? 'mm'
      : normalizedName === 'focallengthin35mmformat'
      ? 'mm'
      : normalizedName === 'gpshpositioningerror' || normalizedName === 'subjectdistance'
      ? 'm'
      : undefined;
    if (suffix) return value.replace(new RegExp(`\\s*${suffix}$`), '');
  }
  return value;
}

export function resolveMergeRequests(tags: Record<string, TagValue>): MergeRequests {
  const exif: ExifRequest[] = [];
  const xmp: XmpPropertyRequest[] = [];
  const xmpKeys: string[] = [];
  const xmpDeletes: string[] = [];
  const xmpDeleteKeys: string[] = [];
  const iptc: IptcWriteRequest[] = [];
  const iptcKeys: string[] = [];
  const photoshop: PhotoshopResourceWriteRequest[] = [];
  const jfif: MergeRequests['jfif'] = [];
  let icc: MergeRequests['icc'];
  const ducky: MergeRequests['ducky'] = [];
  let comment: MergeRequests['comment'];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    const rawMode = key.endsWith('#');
    const lookupKey = rawMode ? key.slice(0, -1) : key;
    if (/^(?:jpeg:)?comment$/i.test(key)) {
      if (value === null || typeof value === 'string') comment = { key, value };
      else skipped.push(key);
      continue;
    }
    const jfifMatch = key.match(/^jfif:(resolutionunit|xresolution|yresolution)$/i);
    if (jfifMatch) {
      const fieldName = jfifMatch[1]!.toLowerCase();
      const unitNames: Record<string, number> = { none: 0, inches: 1, inch: 1, cm: 2, centimeters: 2 };
      const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? unitNames[value.trim().toLowerCase()] ?? Number(value)
          : NaN;
      const max = fieldName === 'resolutionunit' ? 2 : 0xffff;
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > max) {
        skipped.push(key);
      } else {
        jfif.push({
          key,
          field: fieldName === 'resolutionunit' ? 'unit' : fieldName === 'xresolution' ? 'x' : 'y',
          value: numeric,
        });
      }
      continue;
    }
    if (/^(?:jpeg:)?icc_profile$/i.test(key)) {
      if (value === null || value instanceof Uint8Array) icc = { key, value };
      else skipped.push(key);
      continue;
    }
    if (/^photoshop:/i.test(key)) {
      const request = resolvePhotoshopResourceWriteRequest(key, value);
      if (request) photoshop.push(request);
      else skipped.push(key);
      continue;
    }
    const duckyMatch = key.match(/^ducky:(quality|comment|copyright)$/i);
    if (duckyMatch) {
      const property = duckyMatch[1]!.toLowerCase();
      const id = property === 'quality' ? 1 : property === 'comment' ? 2 : 3;
      const valid = value === null || (id === 1
        ? typeof value === 'number' || typeof value === 'string'
        : typeof value === 'string');
      if (!valid) skipped.push(key);
      else ducky.push({ key, id, value });
      continue;
    }
    const canonical =
      MERGE_TAG_KEYS[lookupKey.toLowerCase()] ?? MERGE_TAG_KEYS_BARE[lookupKey.toLowerCase()];
    const xmpName = canonical && XMP_PROPERTY_NAMES[canonical]
      ? XMP_PROPERTY_NAMES[canonical]
      : toXmpPropertyName(key);
    if (value === null && xmpName) {
      xmpDeletes.push(xmpName);
      xmpDeleteKeys.push(key);
      continue;
    }
    const iptcRequest = resolveIptcWriteRequest(canonical ?? lookupKey, value);
    if (iptcRequest) {
      iptc.push(iptcRequest);
      iptcKeys.push(key);
      continue;
    }
    if (canonical === 'EXIF:Copyright') {
      exif.push({ key: rawMode ? key : canonical, spec: IFD0_TAGS.copyright, value, home: 0 });
    } else if (canonical === 'EXIF:Orientation') {
      exif.push({
        key: rawMode ? key : canonical,
        spec: IFD0_TAGS.orientation,
        value: rawMode ? value : enumWriteValue(ORIENTATION_VALUES, value),
        home: 0,
      });
    } else if (canonical && XMP_PROPERTY_NAMES[canonical]) {
      const ok =
        typeof value === 'string' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string'));
      if (!ok) {
        skipped.push(key);
        continue;
      }
      xmp.push({ name: XMP_PROPERTY_NAMES[canonical]!, value: value as XmpWriteValue });
      xmpKeys.push(canonical);
    } else {
      const xmpRequest = toXmpPropertyRequest(key, value);
      if (xmpRequest) {
        xmp.push(xmpRequest);
        xmpKeys.push(key);
        continue;
      }
      // Generic EXIF tag via optional group prefix.
      const separator = lookupKey.indexOf(':');
      const requestedGroup = separator < 0 ? undefined : lookupKey.slice(0, separator).toLowerCase();
      const name = (separator < 0 ? lookupKey : lookupKey.slice(separator + 1)).toLowerCase();
      let spec: IfdTagSpec | undefined;
      let home: ExifRequest['home'] = 0;
      if (requestedGroup === 'ifd0') {
        spec = IFD0_TAGS[name];
      } else if (requestedGroup === 'exififd') {
        spec = EXIF_IFD_TAGS[name];
        home = 0x8769;
      } else if (requestedGroup === 'gps') {
        spec = GPS_IFD_TAGS[name];
        home = 0x8825;
      } else if (requestedGroup === 'interopifd') {
        spec = INTEROP_IFD_TAGS[name];
        home = 0xa005;
      } else if (requestedGroup === undefined || requestedGroup === 'exif') {
        spec = IFD0_TAGS[name] ?? EXIF_IFD_TAGS[name] ?? GPS_IFD_TAGS[name] ?? INTEROP_IFD_TAGS[name];
        if (spec && EXIF_IFD_TAGS[name] === spec) home = 0x8769;
        else if (spec && GPS_IFD_TAGS[name] === spec) home = 0x8825;
        else if (spec && INTEROP_IFD_TAGS[name] === spec) home = 0xa005;
      }
      if (!spec) {
        skipped.push(key);
        continue;
      }
      const gpsCoordinate = rawMode ? undefined : prepareGpsCoordinateValue(spec.name, value, tags);
      exif.push({
        key: rawMode ? key : `EXIF:${spec.name}`,
        spec,
        value: rawMode ? value : gpsCoordinate?.coordinate ?? exifWriteValue(spec.name, value),
        home,
      });
      if (gpsCoordinate?.refValue) {
        const explicitRef = Object.keys(tags).some((tagName) => {
          const parts = tagName.toLowerCase().split(':');
          const group = parts.length > 1 ? parts[0] : undefined;
          return parts.at(-1) === gpsCoordinate.refName.toLowerCase() &&
            (group === undefined || group === 'exif' || group === 'gps');
        });
        const refSpec = GPS_IFD_TAGS[gpsCoordinate.refName.toLowerCase()];
        if (!explicitRef && refSpec) {
          exif.push({
            key: `EXIF:${refSpec.name}`,
            spec: refSpec,
            value: gpsCoordinate.refValue,
            home: 0x8825,
          });
        }
      }
    }
  }
  return {
    exif, xmp, xmpKeys, xmpDeletes, xmpDeleteKeys, iptc, iptcKeys, photoshop, comment, jfif, icc, ducky, skipped,
  };
}

// ---------------------------------------------------------------------------
// JPEG segment walking
// ---------------------------------------------------------------------------

export interface JpegSegment {
  marker: number;
  /** Segment start (the 0xFF marker byte) */
  start: number;
  /** Segment end (exclusive) */
  end: number;
  /** Payload start (after the 2-byte length) for length-bearing segments */
  payloadStart: number;
  payloadEnd: number;
}

export function parseJpegSegments(bytes: Uint8Array): JpegSegment[] {
  const segments: JpegSegment[] = [];
  let pos = 2; // SOI
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda || marker === 0xd9) {
      segments.push({ marker, start: pos, end: bytes.length, payloadStart: pos, payloadEnd: bytes.length });
      pos = bytes.length;
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      segments.push({ marker, start: pos, end: pos + 2, payloadStart: pos, payloadEnd: pos + 2 });
      pos += 2;
      continue;
    }
    if (pos + 2 > bytes.length) break;
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    segments.push({
      marker,
      start: pos,
      end: pos + 2 + len,
      payloadStart: pos + 4,
      payloadEnd: pos + 2 + len,
    });
    pos += 2 + len;
  }
  return segments;
}

function payloadStartsWith(bytes: Uint8Array, seg: JpegSegment, ascii: string): boolean {
  const head = ascii.length;
  if (seg.payloadEnd - seg.payloadStart < head) return false;
  for (let i = 0; i < head; i++) {
    if (bytes[seg.payloadStart + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// TIFF structural merge: parse -> patch -> re-serialize
// ---------------------------------------------------------------------------

interface RawIfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw 4-byte value field for inline entries (byte-identical re-emit). */
  raw4: Uint8Array | null;
  /** Value bytes for offset entries (copied verbatim). */
  data: Uint8Array | null;
  /** Parsed sub-IFD for pointer entries (0x8769/0x8825/0xA005). */
  sub: RawIfd | null;
}

interface RawIfd {
  entries: RawIfdEntry[];
  next: RawIfd | null;
  /** Embedded JPEG thumbnail byte range (IFD0.next chain, 0x0201/0x0202 pair). */
  thumb: Uint8Array | null;
}

interface RawTiff {
  le: boolean;
  ifd0: RawIfd;
}

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

function parseRawIfd(bytes: Uint8Array, dv: DataView, offset: number, le: boolean, depth: number): RawIfd {
  const ifd: RawIfd = { entries: [], next: null, thumb: null };
  if (depth > 4 || offset + 2 > bytes.length) return ifd;
  const count = dv.getUint16(offset, le);
  if (offset + 2 + count * 12 > bytes.length) return ifd;
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const cnt = dv.getUint32(e + 4, le);
    const size = cnt * (TIFF_TYPE_SIZES[type] ?? 1);
    const isPointer = EXIF_IFD_POINTERS.has(tag);
    const raw4 = !isPointer && size <= 4 && size > 0 ? bytes.slice(e + 8, e + 12) : null;
    let data: Uint8Array | null = null;
    let sub: RawIfd | null = null;
    if (isPointer) {
      const ptr = dv.getUint32(e + 8, le);
      sub = parseRawIfd(bytes, dv, ptr, le, depth + 1);
    } else if (size > 4) {
      const off = dv.getUint32(e + 8, le);
      if (off + size <= bytes.length) data = bytes.slice(off, off + size);
    }
    ifd.entries.push({ tag, type, count: cnt, raw4, data, sub });
  }
  // Thumbnail: 0x0201/0x0202 inline LONG pair describes a raw byte range
  // (present when Compression 0x0103 == 6). Preserve it opaquely.
  const comp = ifd.entries.find((e) => e.tag === 0x0103);
  const tOff = ifd.entries.find((e) => e.tag === 0x0201);
  const tLen = ifd.entries.find((e) => e.tag === 0x0202);
  if (tOff?.raw4 && tLen?.raw4 && comp?.raw4 && comp.raw4[0] === 6) {
    const off = dv.getUint32(offset + 2 + ifd.entries.indexOf(tOff) * 12 + 8, le);
    const len = dv.getUint32(offset + 2 + ifd.entries.indexOf(tLen) * 12 + 8, le);
    if (off > 0 && len > 0 && off + len <= bytes.length) {
      ifd.thumb = bytes.slice(off, off + len);
    }
  }
  const nextOff = dv.getUint32(offset + 2 + count * 12, le);
  if (nextOff !== 0) ifd.next = parseRawIfd(bytes, dv, nextOff, le, depth + 1);
  return ifd;
}

export function parseRawTiff(bytes: Uint8Array): RawTiff | undefined {
  if (bytes.length < 8) return undefined;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(2, le) !== 0x2a) return undefined;
  const ifd0Off = dv.getUint32(4, le);
  return { le, ifd0: parseRawIfd(bytes, dv, ifd0Off, le, 0) };
}

/** Walks every nested sub-IFD and next-IFD chain once in serialization order. */
function collectIfds(ifd0: RawIfd): RawIfd[] {
  const out: RawIfd[] = [];
  const visited = new Set<RawIfd>();
  const visit = (ifd: RawIfd | null): void => {
    if (!ifd || visited.has(ifd)) return;
    visited.add(ifd);
    out.push(ifd);
    for (const entry of ifd.entries) visit(entry.sub);
    visit(ifd.next);
  };
  visit(ifd0);
  return out;
}

function serializeRawTiff(t: RawTiff): Uint8Array {
  const ifds = collectIfds(t.ifd0);
  const offsets: number[] = [];
  let cursor = 8;
  for (const ifd of ifds) {
    offsets.push(cursor);
    cursor += 2 + ifd.entries.length * 12 + 4;
  }
  const alignTo2 = (c: number): number => (c % 2 ? c + 1 : c);
  const thumbOffsets = new Map<RawIfd, number>();
  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    if (ifd.thumb) {
      cursor = alignTo2(cursor);
      thumbOffsets.set(ifd, cursor);
      cursor += ifd.thumb.length;
    }
  }
  const blobOffsets = new Map<RawIfdEntry, number>();
  for (let i = 0; i < ifds.length; i++) {
    for (const e of ifds[i].entries) {
      if (!e.sub && e.data !== null && e.data.length > 4) {
        cursor = alignTo2(cursor);
        blobOffsets.set(e, cursor);
        cursor += e.data.length;
      }
    }
  }
  const out = new Uint8Array(cursor);
  const dv = new DataView(out.buffer);
  out[0] = t.le ? 0x49 : 0x4d;
  out[1] = out[0];
  dv.setUint16(2, 0x2a, t.le);
  dv.setUint32(4, 8, t.le);

  const ifdOffsets = new Map(ifds.map((ifd, index) => [ifd, offsets[index]! as number]));

  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    const base = offsets[i];
    dv.setUint16(base, ifd.entries.length, t.le);
    for (let j = 0; j < ifd.entries.length; j++) {
      const e = ifd.entries[j];
      const ep = base + 2 + j * 12;
      dv.setUint16(ep, e.tag, t.le);
      dv.setUint16(ep + 2, e.type, t.le);
      dv.setUint32(ep + 4, e.count, t.le);
      if (e.sub) {
        dv.setUint32(ep + 8, ifdOffsets.get(e.sub) ?? 0, t.le);
      } else if (e.tag === 0x0201 && ifd.thumb) {
        dv.setUint32(ep + 8, thumbOffsets.get(ifd) ?? 0, t.le);
      } else if (e.raw4 !== null) {
        out.set(e.raw4, ep + 8);
      } else {
        dv.setUint32(ep + 8, blobOffsets.get(e) ?? 0, t.le);
      }
    }
    dv.setUint32(base + 2 + ifd.entries.length * 12, ifd.next ? ifdOffsets.get(ifd.next) ?? 0 : 0, t.le);
  }

  for (let i = 0; i < ifds.length; i++) {
    for (const e of ifds[i].entries) {
      const off = blobOffsets.get(e);
      if (off === undefined) continue;
      out.set(e.data!, off);
    }
  }
  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    const off = thumbOffsets.get(ifd);
    if (off !== undefined) out.set(ifd.thumb!, off);
  }
  return out;
}

function pad4(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4);
  out.set(data.length > 4 ? data.subarray(0, 4) : data);
  return out;
}

function applyExifPatches(t: RawTiff, reqs: ExifRequest[]): string[] {
  const written: string[] = [];
  const childIfd = (parent: RawIfd, tag: number): RawIfd => {
    let ptr = parent.entries.find((entry) => entry.tag === tag);
    if (!ptr) {
      const sub: RawIfd = { entries: [], next: null, thumb: null };
      ptr = { tag, type: 4, count: 1, raw4: null, data: null, sub };
      const at = parent.entries.findIndex((entry) => entry.tag > tag);
      if (at === -1) parent.entries.push(ptr);
      else parent.entries.splice(at, 0, ptr);
    } else if (!ptr.sub) {
      ptr.sub = { entries: [], next: null, thumb: null };
    }
    return ptr.sub!;
  };
  const homeIfd = (home: ExifRequest['home']): RawIfd => {
    if (home === 0) return t.ifd0;
    if (home === 0xa005) return childIfd(childIfd(t.ifd0, 0x8769), 0xa005);
    return childIfd(t.ifd0, home);
  };
  for (const req of reqs) {
    const target = homeIfd(req.home);
    if (req.value === null) {
      const index = target.entries.findIndex((e) => e.tag === req.spec.id);
      if (index !== -1) {
        target.entries.splice(index, 1);
        written.push(req.key);
      }
      continue;
    }
    const encoded = encodeValue(req.spec, req.value, t.le);
    if (!encoded) continue;
    let entry = target.entries.find((e) => e.tag === req.spec.id);
    if (entry) {
      entry.type = req.spec.type;
      entry.count = encoded.count;
      entry.raw4 = encoded.data.length <= 4 ? pad4(encoded.data) : null;
      entry.data = encoded.data;
    } else {
      entry = {
        tag: req.spec.id,
        type: req.spec.type,
        count: encoded.count,
        raw4: encoded.data.length <= 4 ? pad4(encoded.data) : null,
        data: encoded.data,
        sub: null,
      };
      const at = target.entries.findIndex((e) => e.tag > req.spec.id);
      if (at === -1) target.entries.push(entry);
      else target.entries.splice(at, 0, entry);
    }
    written.push(req.key);
  }
  const interopIfd = t.ifd0.entries.find((entry) => entry.tag === 0x8769)?.sub?.entries
    .find((entry) => entry.tag === 0xa005)?.sub;
  const writesInterop = reqs.some((req) => req.home === 0xa005 && req.value !== null);
  if (
    writesInterop && interopIfd && !interopIfd.entries.some((entry) => entry.tag === INTEROP_IFD_TAGS.interopversion!.id)
  ) {
    const spec = INTEROP_IFD_TAGS.interopversion!;
    const data = new TextEncoder().encode('0100');
    interopIfd.entries.push({ tag: spec.id, type: spec.type, count: data.length, raw4: pad4(data), data, sub: null });
    written.push(spec.name);
  }
  const mandatoryExifIds = new Set([0x9000, 0x9101, 0xA001]);
  const deletedExifValue = reqs.some((req) =>
    req.home === 0x8769 && req.value === null && written.includes(req.key)
  );
  const writesMandatoryExif = reqs.some((req) =>
    req.home === 0x8769 && req.value !== null && mandatoryExifIds.has(req.spec.id)
  );
  const exifPointer = t.ifd0.entries.find((entry) => entry.tag === 0x8769);
  if (
    deletedExifValue && !writesMandatoryExif && exifPointer?.sub && exifPointer.sub.entries.length > 0 &&
    exifPointer.sub.entries.every((entry) => mandatoryExifIds.has(entry.tag))
  ) {
    t.ifd0.entries = t.ifd0.entries.filter((entry) => entry !== exifPointer);
  }
  t.ifd0.entries = t.ifd0.entries.filter(
    (entry) => !entry.sub || entry.sub.entries.length > 0 || entry.sub.next || entry.sub.thumb,
  );
  return written;
}

/**
 * Merges EXIF requests into an existing TIFF block, preserving every
 * untouched entry's value bytes verbatim (including MakerNotes and IFD1
 * thumbnails) and recomputing all structure offsets.
 */
export function mergeExifTiff(
  tiff: Uint8Array,
  reqs: ExifRequest[],
): { bytes: Uint8Array; written: string[]; skipped: string[] } {
  const parsed = parseRawTiff(tiff);
  if (!parsed) throw new UnsupportedFormatError('malformed EXIF TIFF block');
  const makeEntry = parsed.ifd0.entries.find((entry) => entry.tag === 0x010f);
  const makeBytes = makeEntry?.data ?? makeEntry?.raw4;
  const make = makeBytes ? new TextDecoder().decode(makeBytes).split('\0', 1)[0]!.trim().toUpperCase() : '';
  const hasMakerNote = collectIfds(parsed.ifd0).some((ifd) => ifd.entries.some((entry) => entry.tag === 0x927c));
  if (reqs.length > 0 && make.includes('OLYMPUS') && hasMakerNote) {
    throw new UnsupportedFormatError('refusing EXIF rewrite that could invalidate Olympus MakerNote offsets');
  }
  const written = applyExifPatches(parsed, reqs);
  const skipped = reqs.filter((r) => !written.includes(r.key)).map((r) => r.key);
  return { bytes: serializeRawTiff(parsed), written, skipped };
}

// ---------------------------------------------------------------------------
// JPEG merge writer
// ---------------------------------------------------------------------------

const XMP_APP1_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXTENSION_APP1_HEADER = 'http://ns.adobe.com/xmp/extension/\0';

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function app1Segment(payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) {
    throw new UnsupportedFormatError('APP1 segment exceeds 64 KiB JPEG limit');
  }
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  const len = payload.length + 2;
  seg[2] = (len >> 8) & 0xff;
  seg[3] = len & 0xff;
  seg.set(payload, 4);
  return seg;
}

function xmpApp1Segments(packet: string): Uint8Array[] {
  const packetBytes = new TextEncoder().encode(packet);
  const standardHeader = new TextEncoder().encode(XMP_APP1_HEADER);
  if (standardHeader.length + packetBytes.length + 2 <= 0xffff) {
    return [app1Segment(concatBytes([standardHeader, packetBytes]))];
  }
  if (packetBytes.length > 0xffffffff) {
    throw new UnsupportedFormatError('Extended XMP packet exceeds the 32-bit length limit');
  }

  const guid = md5Hex(packetBytes).toUpperCase();
  const pointerPacket = writeXmpPacket(null, [{ name: 'xmpNote:HasExtendedXMP', value: guid }]);
  const pointerBytes = new TextEncoder().encode(pointerPacket);
  const segments = [app1Segment(concatBytes([standardHeader, pointerBytes]))];
  const extensionHeader = new TextEncoder().encode(XMP_EXTENSION_APP1_HEADER);
  const guidBytes = new TextEncoder().encode(guid);
  const fixedLength = extensionHeader.length + guidBytes.length + 8;
  const chunkSize = 0xffff - 2 - fixedLength;
  for (let offset = 0; offset < packetBytes.length; offset += chunkSize) {
    const chunk = packetBytes.subarray(offset, Math.min(offset + chunkSize, packetBytes.length));
    const payload = new Uint8Array(fixedLength + chunk.length);
    payload.set(extensionHeader);
    payload.set(guidBytes, extensionHeader.length);
    const view = new DataView(payload.buffer);
    view.setUint32(extensionHeader.length + guidBytes.length, packetBytes.length, false);
    view.setUint32(extensionHeader.length + guidBytes.length + 4, offset, false);
    payload.set(chunk, fixedLength);
    segments.push(app1Segment(payload));
  }
  return segments;
}

function extendedXmpPacket(
  bytes: Uint8Array,
  standard: JpegSegment,
  extensions: JpegSegment[],
): Uint8Array {
  const standardPacket = new TextDecoder().decode(
    bytes.subarray(standard.payloadStart + XMP_APP1_HEADER.length, standard.payloadEnd),
  );
  const pointer = standardPacket.match(/xmpNote:HasExtendedXMP(?:\s[^>]*)?>([A-Fa-f0-9]{32})</)?.[1]
    ?? standardPacket.match(/xmpNote:HasExtendedXMP\s*=\s*["']([A-Fa-f0-9]{32})["']/)?.[1];
  if (!pointer || extensions.length === 0) {
    throw new UnsupportedFormatError('invalid Extended XMP pointer or missing extension segments');
  }

  const extensionHeader = new TextEncoder().encode(XMP_EXTENSION_APP1_HEADER);
  const guid = pointer.toUpperCase();
  const chunks = extensions.map((segment) => {
    const headerEnd = segment.payloadStart + extensionHeader.length;
    const guidEnd = headerEnd + 32;
    const metadataEnd = guidEnd + 8;
    if (segment.payloadEnd < metadataEnd) {
      throw new UnsupportedFormatError('truncated Extended XMP APP1 segment');
    }
    const segmentGuid = new TextDecoder().decode(bytes.subarray(headerEnd, guidEnd)).toUpperCase();
    const view = new DataView(bytes.buffer, bytes.byteOffset + guidEnd, 8);
    return {
      guid: segmentGuid,
      totalLength: view.getUint32(0, false),
      offset: view.getUint32(4, false),
      start: metadataEnd,
      end: segment.payloadEnd,
    };
  });
  if (chunks.some((chunk) => chunk.guid !== guid)) {
    throw new UnsupportedFormatError('JPEG contains unreferenced Extended XMP segments');
  }
  const totalLength = chunks[0]!.totalLength;
  if (totalLength === 0 || chunks.some((chunk) => chunk.totalLength !== totalLength)) {
    throw new UnsupportedFormatError('inconsistent Extended XMP packet lengths');
  }
  chunks.sort((left, right) => left.offset - right.offset);
  const packet = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    const length = chunk.end - chunk.start;
    if (chunk.offset !== offset || chunk.offset + length > totalLength) {
      throw new UnsupportedFormatError('incomplete or overlapping Extended XMP chunks');
    }
    packet.set(bytes.subarray(chunk.start, chunk.end), chunk.offset);
    offset += length;
  }
  if (offset !== totalLength || md5Hex(packet).toUpperCase() !== guid) {
    throw new UnsupportedFormatError('Extended XMP packet does not match its MD5 GUID');
  }
  return packet;
}

function app13Segment(payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) throw new UnsupportedFormatError('APP13 segment exceeds 64 KiB JPEG limit');
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff;
  seg[1] = 0xed;
  const len = payload.length + 2;
  seg[2] = (len >> 8) & 0xff;
  seg[3] = len & 0xff;
  seg.set(payload, 4);
  return seg;
}

const PHOTOSHOP_APP13_HEADER = new TextEncoder().encode('Photoshop 3.0\0');

function photoshopApp13Segments(payload: Uint8Array): Uint8Array[] {
  if (!payloadStartsWith(payload, {
    marker: 0xed,
    start: 0,
    end: payload.length,
    payloadStart: 0,
    payloadEnd: payload.length,
  }, 'Photoshop 3.0\0')) {
    throw new UnsupportedFormatError('malformed Photoshop APP13 payload');
  }
  const maxDataLength = 0xffff - 2 - PHOTOSHOP_APP13_HEADER.length;
  const resourceData = payload.subarray(PHOTOSHOP_APP13_HEADER.length);
  const segments: Uint8Array[] = [];
  for (let offset = 0; offset < resourceData.length || (offset === 0 && resourceData.length === 0); offset += maxDataLength) {
    const data = resourceData.subarray(offset, Math.min(offset + maxDataLength, resourceData.length));
    const segmentPayload = new Uint8Array(PHOTOSHOP_APP13_HEADER.length + data.length);
    segmentPayload.set(PHOTOSHOP_APP13_HEADER);
    segmentPayload.set(data, PHOTOSHOP_APP13_HEADER.length);
    segments.push(app13Segment(segmentPayload));
  }
  return segments;
}

function app12Segment(payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) throw new UnsupportedFormatError('APP12 segment exceeds 65,533 bytes');
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xec;
  const length = payload.length + 2;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  return segment;
}

function jpegCommentSegments(value: string): Uint8Array[] {
  const data = new TextEncoder().encode(value);
  const segments: Uint8Array[] = [];
  for (let offset = 0; offset < data.length || (data.length === 0 && offset === 0); offset += 0xffff - 2) {
    const part = data.subarray(offset, Math.min(offset + 0xffff - 2, data.length));
    const segment = new Uint8Array(part.length + 4);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    const length = part.length + 2;
    segment[2] = length >> 8;
    segment[3] = length & 0xff;
    segment.set(part, 4);
    segments.push(segment);
  }
  return segments;
}

function jfifSegment(originalPayload: Uint8Array | null, requests: MergeRequests['jfif']): Uint8Array {
  const payload = originalPayload
    ? originalPayload.slice()
    : new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 1, 0, 0x48, 0, 0x48, 0, 0]);
  if (payload.length < 14 || !payloadStartsWith(payload, {
    marker: 0xe0,
    start: 0,
    end: payload.length,
    payloadStart: 0,
    payloadEnd: payload.length,
  }, 'JFIF\0')) {
    throw new UnsupportedFormatError('malformed JFIF APP0 segment');
  }
  for (const request of requests) {
    if (request.field === 'unit') payload[7] = request.value;
    else if (request.field === 'x') {
      payload[8] = request.value >> 8;
      payload[9] = request.value & 0xff;
    } else {
      payload[10] = request.value >> 8;
      payload[11] = request.value & 0xff;
    }
  }
  const segment = new Uint8Array(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  const length = payload.length + 2;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(payload, 4);
  return segment;
}

function iccProfileSegments(profile: Uint8Array): Uint8Array[] {
  const headerLength = 14;
  const maxDataLength = 0xffff - 2 - headerLength;
  const total = Math.max(1, Math.ceil(profile.length / maxDataLength));
  if (total > 255) throw new UnsupportedFormatError('ICC profile requires more than 255 JPEG APP2 segments');
  const signature = new TextEncoder().encode('ICC_PROFILE\0');
  const segments: Uint8Array[] = [];
  for (let index = 0; index < total; index++) {
    const data = profile.subarray(index * maxDataLength, Math.min((index + 1) * maxDataLength, profile.length));
    const payload = new Uint8Array(headerLength + data.length);
    payload.set(signature);
    payload[12] = index + 1;
    payload[13] = total;
    payload.set(data, headerLength);
    const segment = new Uint8Array(payload.length + 4);
    segment[0] = 0xff;
    segment[1] = 0xe2;
    const length = payload.length + 2;
    segment[2] = length >> 8;
    segment[3] = length & 0xff;
    segment.set(payload, 4);
    segments.push(segment);
  }
  return segments;
}

/**
 * JPEG merge writer: changes ONLY the requested tags.
 *
 * EXIF lives in the first APP1 'Exif\0\0' segment: its TIFF block is
 * structurally rebuilt with untouched entry values copied verbatim, so
 * MakerNotes, IFD1 thumbnails, GPS and ExifIFD data survive byte-for-byte.
 * XMP lives in the first APP1 'http://ns.adobe.com/xap/1.0/\0' segment: the
 * two rights properties are spliced into the existing packet, or a minimal
 * conformant packet is created when none exists. All other segments
 * (IPTC APP13, ICC APP2, C2PA APP11, …) are copied verbatim.
 *
 * EXIF writes are refused for Olympus files with MakerNotes because those
 * blobs use absolute TIFF offsets that this rebuild cannot safely rebase.
 * XMP/IPTC-only writes never touch the EXIF TIFF block.
 */
export const jpegMergeWriter: ContainerWriter = (original, tags) => {
  if (original.length < 4 || original[0] !== 0xff || original[1] !== 0xd8) {
    throw new UnsupportedFormatError('not a JPEG stream');
  }
  const reqs = resolveMergeRequests(tags);
  const segments = parseJpegSegments(original);
  const exifSeg = segments.find(
    (s) => s.marker === 0xe1 && payloadStartsWith(original, s, 'Exif\0\0'),
  );
  const xmpSeg = segments.find(
    (s) => s.marker === 0xe1 && payloadStartsWith(original, s, XMP_APP1_HEADER),
  );
  const xmpExtensionSegments = segments.filter(
    (s) => s.marker === 0xe1 && payloadStartsWith(original, s, XMP_EXTENSION_APP1_HEADER),
  );
  const psApp13Segments = segments.filter(
    (s) => s.marker === 0xed && payloadStartsWith(original, s, 'Photoshop 3.0\0'),
  );
  const psApp13 = psApp13Segments[0];
  const comments = segments.filter((s) => s.marker === 0xfe);
  const jfifSeg = segments.find((s) => s.marker === 0xe0 && payloadStartsWith(original, s, 'JFIF\0'));
  const adobeSeg = segments.find((s) => s.marker === 0xee && payloadStartsWith(original, s, 'Adobe'));
  const iccSegments = segments.filter((s) => s.marker === 0xe2 && payloadStartsWith(original, s, 'ICC_PROFILE\0'));
  const duckySeg = segments.find((s) => s.marker === 0xec && payloadStartsWith(original, s, 'Ducky'));

  const written: string[] = [];
  const skipped: string[] = [...reqs.skipped];

  // --- EXIF ---
  let exifPayload: Uint8Array | null = null;
  if (reqs.exif.length > 0) {
    if (exifSeg) {
      const tiff = original.subarray(exifSeg.payloadStart + 6, exifSeg.payloadEnd);
      const merged = mergeExifTiff(tiff, reqs.exif);
      exifPayload = merged.bytes;
      written.push(...merged.written);
      skipped.push(...merged.skipped);
    } else {
      const fresh: Record<string, TagValue> = {};
      for (const r of reqs.exif) fresh[r.spec.name] = r.value;
      const built = buildTiff(fresh, { inversePrintConv: false });
      exifPayload = built.bytes;
      written.push(...reqs.exif.filter((r) => built.written.includes(r.spec.name)).map((r) => r.key));
      skipped.push(...reqs.exif.filter((r) => !built.written.includes(r.spec.name)).map((r) => r.key));
    }
  }

  // --- XMP ---
  let xmpSegments: Uint8Array[] = [];
  if (reqs.xmp.length > 0 || reqs.xmpDeletes.length > 0) {
    if (xmpExtensionSegments.length > 0 && !xmpSeg) {
      throw new UnsupportedFormatError('Extended XMP segments have no standard XMP pointer packet');
    }
    const packetBase = xmpSeg
      ? xmpExtensionSegments.length > 0
        ? new TextDecoder('utf-8', { fatal: true }).decode(extendedXmpPacket(original, xmpSeg, xmpExtensionSegments))
        : new TextDecoder().decode(original.subarray(xmpSeg.payloadStart + XMP_APP1_HEADER.length, xmpSeg.payloadEnd))
      : null;
    let packet = packetBase;
    if (reqs.xmp.length > 0) packet = writeXmpPacket(packet, reqs.xmp);
    if (reqs.xmpDeletes.length > 0) {
      if (packet !== null) {
        packet = deleteXmpProperties(packet, reqs.xmpDeletes);
        written.push(...reqs.xmpDeleteKeys);
      } else {
        skipped.push(...reqs.xmpDeleteKeys);
      }
    }
    if (packet !== null) xmpSegments = xmpApp1Segments(packet);
    written.push(...reqs.xmpKeys);
  }

  // --- IPTC (APP13 Photoshop IRB) ---
  let iptcPayload: Uint8Array | null = null;
  let iptcTouched = false;
  if (reqs.iptc.length > 0 || reqs.photoshop.length > 0) {
    let existingPayload: Uint8Array | null = null;
    if (psApp13) {
      const fragments = psApp13Segments.map((segment) =>
        original.subarray(segment.payloadStart + PHOTOSHOP_APP13_HEADER.length, segment.payloadEnd),
      );
      const resourceLength = fragments.reduce((length, fragment) => length + fragment.length, 0);
      existingPayload = new Uint8Array(PHOTOSHOP_APP13_HEADER.length + resourceLength);
      existingPayload.set(PHOTOSHOP_APP13_HEADER);
      let offset = PHOTOSHOP_APP13_HEADER.length;
      for (const fragment of fragments) {
        existingPayload.set(fragment, offset);
        offset += fragment.length;
      }
    }
    const photoshopRequests = reqs.photoshop.filter((request) => {
      if (!request.requireExisting || hasPhotoshopResource(existingPayload, request.id)) return true;
      skipped.push(request.key);
      return false;
    });
    if (reqs.iptc.length > 0 || photoshopRequests.length > 0) {
      iptcTouched = true;
      iptcPayload = mergePhotoshopIrb(existingPayload, reqs.iptc, photoshopRequests);
      written.push(...reqs.iptcKeys, ...photoshopRequests.map((request) => request.key));
    }
  }

  // --- Reassemble: sorted splice list over the original bytes ---
  interface Edit { at: number; end: number; bytes: Uint8Array | null }
  const edits: Edit[] = [];
  const withHeader = (ascii: string, payload: Uint8Array): Uint8Array => {
    const header = new TextEncoder().encode(ascii);
    const out = new Uint8Array(header.length + payload.length);
    out.set(header);
    out.set(payload, header.length);
    return app1Segment(out);
  };
  if (exifPayload) {
    const seg = withHeader('Exif\0\0', exifPayload);
    edits.push(exifSeg ? { at: exifSeg.start, end: exifSeg.end, bytes: seg } : { at: 2, end: 2, bytes: seg });
  }
  if (xmpSegments.length > 0) {
    const seg = xmpSegments[0]!;
    if (xmpSeg) {
      edits.push({ at: xmpSeg.start, end: xmpSeg.end, bytes: seg });
      for (const extension of xmpSegments.slice(1)) {
        edits.push({ at: xmpSeg.end, end: xmpSeg.end, bytes: extension });
      }
    } else if (exifSeg) {
      edits.push({ at: exifSeg.end, end: exifSeg.end, bytes: seg });
      for (const extension of xmpSegments.slice(1)) {
        edits.push({ at: exifSeg.end, end: exifSeg.end, bytes: extension });
      }
    } else {
      // Both fresh: insert both at the SOI boundary; stable sort keeps
      // EXIF first, XMP second.
      edits.push({ at: 2, end: 2, bytes: seg });
      for (const extension of xmpSegments.slice(1)) edits.push({ at: 2, end: 2, bytes: extension });
    }
    for (const extension of xmpExtensionSegments) {
      edits.push({ at: extension.start, end: extension.end, bytes: null });
    }
  } else if (xmpSeg && (reqs.xmpDeletes.length > 0 || reqs.xmp.length > 0)) {
    edits.push({ at: xmpSeg.start, end: xmpSeg.end, bytes: null });
    for (const extension of xmpExtensionSegments) {
      edits.push({ at: extension.start, end: extension.end, bytes: null });
    }
  }
  if (iptcTouched && iptcPayload) {
    const newSegments = photoshopApp13Segments(iptcPayload);
    if (psApp13) {
      edits.push({ at: psApp13.start, end: psApp13.end, bytes: newSegments[0]! });
      for (const segment of newSegments.slice(1)) {
        edits.push({ at: psApp13.end, end: psApp13.end, bytes: segment });
      }
      for (const segment of psApp13Segments.slice(1)) {
        edits.push({ at: segment.start, end: segment.end, bytes: null });
      }
    } else {
      // Fresh APP13: after the last APP0/APP1 metadata segment, else SOI.
      const anchor = xmpSeg ?? exifSeg;
      const at = anchor ? anchor.end : 2;
      for (const segment of newSegments) edits.push({ at, end: at, bytes: segment });
    }
  } else if (iptcTouched && psApp13Segments.length > 0) {
    for (const segment of psApp13Segments) edits.push({ at: segment.start, end: segment.end, bytes: null });
  }
  if (reqs.comment) {
    const replacement = reqs.comment.value === null ? [] : jpegCommentSegments(reqs.comment.value);
    if (comments.length > 0) {
      edits.push({
        at: comments[0]!.start,
        end: comments[0]!.end,
        bytes: replacement[0] ?? null,
      });
      for (const comment of comments.slice(1)) {
        edits.push({ at: comment.start, end: comment.end, bytes: null });
      }
      for (const segment of replacement.slice(1)) {
        edits.push({ at: comments[0]!.end, end: comments[0]!.end, bytes: segment });
      }
    } else if (replacement.length > 0) {
      const scan = segments.find((segment) => segment.marker === 0xda);
      const eoi = segments.find((segment) => segment.marker === 0xd9);
      const at = scan?.start ?? eoi?.start ?? original.length;
      for (const segment of replacement) edits.push({ at, end: at, bytes: segment });
    }
    written.push(reqs.comment.key);
  }
  if (reqs.jfif.length > 0) {
    if (!jfifSeg && adobeSeg) {
      skipped.push(...reqs.jfif.map((request) => request.key));
    } else {
      const payload = jfifSeg
        ? original.subarray(jfifSeg.payloadStart, jfifSeg.payloadEnd)
        : null;
      const replacement = jfifSegment(payload, reqs.jfif);
      if (jfifSeg) edits.push({ at: jfifSeg.start, end: jfifSeg.end, bytes: replacement });
      else edits.push({ at: 2, end: 2, bytes: replacement });
      written.push(...reqs.jfif.map((request) => request.key));
    }
  }
  if (reqs.icc) {
    for (const segment of iccSegments) edits.push({ at: segment.start, end: segment.end, bytes: null });
    if (reqs.icc.value) {
      const replacements = iccProfileSegments(reqs.icc.value);
      if (iccSegments.length > 0) {
        edits.push({ at: iccSegments[0]!.start, end: iccSegments[0]!.start, bytes: replacements[0]! });
        for (const segment of replacements.slice(1)) {
          edits.push({ at: iccSegments[0]!.start, end: iccSegments[0]!.start, bytes: segment });
        }
      } else {
        const anchor = segments.find((segment) => segment.marker === 0xda)?.start ??
          segments.find((segment) => segment.marker === 0xd9)?.start ?? original.length;
        for (const segment of replacements) edits.push({ at: anchor, end: anchor, bytes: segment });
      }
    }
    written.push(reqs.icc.key);
  }
  if (reqs.ducky.length > 0) {
    const existing = duckySeg
      ? original.subarray(duckySeg.payloadStart, duckySeg.payloadEnd)
      : null;
    const updated = mergeDucky(existing, reqs.ducky);
    if (updated && updated.length + 2 > 0xffff) {
      throw new UnsupportedFormatError('Ducky APP12 segment exceeds 65,533 bytes');
    }
    if (duckySeg) {
      edits.push({ at: duckySeg.start, end: duckySeg.end, bytes: updated ? app12Segment(updated) : null });
    } else if (updated) {
      const anchor = segments.find((segment) => segment.marker === 0xda)?.start ??
        segments.find((segment) => segment.marker === 0xd9)?.start ?? original.length;
      edits.push({ at: anchor, end: anchor, bytes: app12Segment(updated) });
    }
    written.push(...reqs.ducky.map((request) => request.key));
  }
  edits.sort((a, b) => a.at - b.at);
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const ed of edits) {
    if (ed.at > pos) parts.push(original.subarray(pos, ed.at));
    if (ed.bytes) parts.push(ed.bytes);
    pos = Math.max(pos, ed.end);
  }
  if (pos < original.length) parts.push(original.subarray(pos));

  let total = 0;
  for (const p of parts) total += p.length;
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, written, skipped };
};
