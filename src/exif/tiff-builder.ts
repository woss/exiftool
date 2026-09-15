import type { TagValue } from '../types.js';

/**
 * Result of building a TIFF structure.
 * @property bytes - Serialized TIFF bytes
 * @property written - Tag names successfully written
 * @property skipped - Tag names that could not be encoded
 */
export interface BuildTiffResult {
  bytes: Uint8Array;
  written: string[];
  skipped: string[];
}

export interface IfdTagSpec {
  id: number;
  type: 1 | 2 | 3 | 4 | 5 | 7 | 10; // BYTE, ASCII, SHORT, LONG, RATIONAL, UNDEFINED, SRATIONAL
  name: string;
  /** Fixed element count in the tag's type units (e.g. 3 rationals for GPS coords). */
  count?: number;
}

export const IFD0_TAGS: Record<string, IfdTagSpec> = {
  imagedescription: { id: 0x010E, type: 2, name: 'ImageDescription' },
  make: { id: 0x010F, type: 2, name: 'Make' },
  model: { id: 0x0110, type: 2, name: 'Model' },
  orientation: { id: 0x0112, type: 3, name: 'Orientation' },
  xresolution: { id: 0x011A, type: 5, name: 'XResolution' },
  yresolution: { id: 0x011B, type: 5, name: 'YResolution' },
  resolutionunit: { id: 0x0128, type: 3, name: 'ResolutionUnit' },
  software: { id: 0x0131, type: 2, name: 'Software' },
  datetime: { id: 0x0132, type: 2, name: 'DateTime' },
  modifydate: { id: 0x0132, type: 2, name: 'DateTime' },
  artist: { id: 0x013B, type: 2, name: 'Artist' },
  copyright: { id: 0x8298, type: 2, name: 'Copyright' },
};

/** ExifIFD (0x8769) tags. Pointers (0x8769/0x8825/0xA005) and MakerNote (0x927C) are never written. */
export const EXIF_IFD_TAGS: Record<string, IfdTagSpec> = {
  exposuretime: { id: 0x829A, type: 5, name: 'ExposureTime' },
  fnumber: { id: 0x829D, type: 5, name: 'FNumber' },
  exposureprogram: { id: 0x8822, type: 3, name: 'ExposureProgram' },
  isospeedratings: { id: 0x8827, type: 3, name: 'ISOSpeedRatings' },
  recommendedexposureindex: { id: 0x8827, type: 3, name: 'ISOSpeedRatings' },
  exifversion: { id: 0x9000, type: 7, name: 'ExifVersion' },
  datetimeoriginal: { id: 0x9003, type: 2, name: 'DateTimeOriginal' },
  createdate: { id: 0x9004, type: 2, name: 'CreateDate' },
  datetimedigitized: { id: 0x9004, type: 2, name: 'CreateDate' },
  offsettime: { id: 0x9010, type: 2, name: 'OffsetTime' },
  offsettimeoriginal: { id: 0x9011, type: 2, name: 'OffsetTimeOriginal' },
  offsettimedigitized: { id: 0x9012, type: 2, name: 'OffsetTimeDigitized' },
  componentsconfiguration: { id: 0x9101, type: 7, name: 'ComponentsConfiguration' },
  shutterspeedvalue: { id: 0x9201, type: 10, name: 'ShutterSpeedValue' },
  aperturevalue: { id: 0x9202, type: 5, name: 'ApertureValue' },
  exposurecompensation: { id: 0x9204, type: 10, name: 'ExposureCompensation' },
  meteringmode: { id: 0x9207, type: 3, name: 'MeteringMode' },
  flash: { id: 0x9209, type: 3, name: 'Flash' },
  focallength: { id: 0x920A, type: 5, name: 'FocalLength' },
  usercomment: { id: 0x9286, type: 7, name: 'UserComment' },
  subsectime: { id: 0x9290, type: 2, name: 'SubSecTime' },
  subsectimeoriginal: { id: 0x9291, type: 2, name: 'SubSecTimeOriginal' },
  subsectimedigitized: { id: 0x9292, type: 2, name: 'SubSecTimeDigitized' },
  flashpixversion: { id: 0xA000, type: 7, name: 'FlashpixVersion' },
  colorspace: { id: 0xA001, type: 3, name: 'ColorSpace' },
  exifimagewidth: { id: 0xA002, type: 4, name: 'ExifImageWidth' },
  exifimageheight: { id: 0xA003, type: 4, name: 'ExifImageHeight' },
  focalplanexresolution: { id: 0xA20E, type: 5, name: 'FocalPlaneXResolution' },
  focalplaneyresolution: { id: 0xA20F, type: 5, name: 'FocalPlaneYResolution' },
  focalplaneresolutionunit: { id: 0xA210, type: 3, name: 'FocalPlaneResolutionUnit' },
  focallengthin35mmformat: { id: 0xA405, type: 3, name: 'FocalLengthIn35mmFormat' },
  ownername: { id: 0xA430, type: 2, name: 'OwnerName' },
  serialnumber: { id: 0xA431, type: 2, name: 'SerialNumber' },
  lensinfo: { id: 0xA432, type: 5, name: 'LensInfo', count: 4 },
  lensmake: { id: 0xA433, type: 2, name: 'LensMake' },
  lensmodel: { id: 0xA434, type: 2, name: 'LensModel' },
  lensserialnumber: { id: 0xA435, type: 2, name: 'LensSerialNumber' },
};

/** GPS IFD (0x8825) tags. */
export const GPS_IFD_TAGS: Record<string, IfdTagSpec> = {
  gpsversionid: { id: 0x0000, type: 1, name: 'GPSVersionID', count: 4 },
  gpslatituderef: { id: 0x0001, type: 2, name: 'GPSLatitudeRef' },
  gpslatitude: { id: 0x0002, type: 5, name: 'GPSLatitude', count: 3 },
  gpslongituderef: { id: 0x0003, type: 2, name: 'GPSLongitudeRef' },
  gpslongitude: { id: 0x0004, type: 5, name: 'GPSLongitude', count: 3 },
  gpsaltituderef: { id: 0x0005, type: 1, name: 'GPSAltitudeRef' },
  gpsaltitude: { id: 0x0006, type: 5, name: 'GPSAltitude' },
  gpstimestamp: { id: 0x0007, type: 5, name: 'GPSTimeStamp', count: 3 },
  gpssatellites: { id: 0x0008, type: 2, name: 'GPSSatellites' },
  gpsstatus: { id: 0x0009, type: 2, name: 'GPSStatus' },
  gpsmeasuremode: { id: 0x000A, type: 2, name: 'GPSMeasureMode' },
  gpsdop: { id: 0x000B, type: 5, name: 'GPSDOP' },
  gpsspeedref: { id: 0x000C, type: 2, name: 'GPSSpeedRef' },
  gpsspeed: { id: 0x000D, type: 5, name: 'GPSSpeed' },
  gpstrackref: { id: 0x000E, type: 2, name: 'GPSTrackRef' },
  gpstrack: { id: 0x000F, type: 5, name: 'GPSTrack' },
  gpsimgdirectionref: { id: 0x0010, type: 2, name: 'GPSImgDirectionRef' },
  gpsimgdirection: { id: 0x0011, type: 5, name: 'GPSImgDirection' },
  gpsmapdatum: { id: 0x0012, type: 2, name: 'GPSMapDatum' },
  gpsdestlatituderef: { id: 0x0013, type: 2, name: 'GPSDestLatitudeRef' },
  gpsdestlatitude: { id: 0x0014, type: 5, name: 'GPSDestLatitude', count: 3 },
  gpsdestlongituderef: { id: 0x0015, type: 2, name: 'GPSDestLongitudeRef' },
  gpsdestlongitude: { id: 0x0016, type: 5, name: 'GPSDestLongitude', count: 3 },
  gpsprocessingmethod: { id: 0x001B, type: 7, name: 'GPSProcessingMethod' },
  gpsdatestamp: { id: 0x001D, type: 2, name: 'GPSDateStamp' },
  gpsdifferential: { id: 0x001E, type: 3, name: 'GPSDifferential' },
  gpshpositioningerror: { id: 0x001F, type: 5, name: 'GPSHPositioningError' },
};

function toAscii(value: TagValue): Uint8Array | undefined {
  const s = typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : undefined;
  if (s === undefined) return undefined;
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}

/** Accepts a number (scaled by 1000), [num, den], or 'num/den'. */
function toRational(value: TagValue): [number, number] | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? [value, 1] : [Math.round(value * 1000), 1000];
  }
  if (typeof value === 'string') {
    const m = value.match(/^(-?\d+)\/(-?\d+)$/);
    if (m) return [Number(m[1]), Number(m[2])];
    const n = Number(value);
    return Number.isFinite(n) ? toRational(n) : undefined;
  }
  if (Array.isArray(value) && value.length === 2) {
    const [a, b] = value as [unknown, unknown];
    if (typeof a === 'number' && typeof b === 'number') return [a, b];
  }
  return undefined;
}

/**
 * Parses a GPS coordinate into [deg, min, sec]. Accepts [deg, min, sec]
 * (or 6-element rational triplets), a decimal number of degrees, or the
 * reader-formatted DMS string (`43 deg 28' 2.00" N`).
 */
function toGpsCoordinate(value: TagValue): [number, number, number] | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const deg = Math.trunc(value);
    const minFull = (value - deg) * 60;
    const min = Math.trunc(minFull);
    const sec = Math.round((minFull - min) * 60 * 100) / 100;
    return [deg, min, sec];
  }
  if (typeof value === 'string') {
    const dms = value.match(/^(\d+) deg (\d+)' ([\d.]+)"\s*([NSEW])?/);
    if (dms) return [Number(dms[1]), Number(dms[2]), Number(dms[3])];
    const r = toRational(value);
    return r ? [r[0], r[1], 0] : undefined;
  }
  if (Array.isArray(value)) {
    const nums = value.filter((v): v is number => typeof v === 'number');
    if (nums.length === 3 && nums.every(Number.isFinite)) {
      return [nums[0], nums[1], nums[2]];
    }
    if (nums.length === 6 && nums.every(Number.isFinite)) {
      const r = (i: number) => nums[i + 1] === 0 ? 0 : nums[i] / nums[i + 1];
      return [r(0), r(2), r(4)];
    }
    if (nums.length === 2 && nums.every(Number.isFinite)) {
      return [nums[0], nums[1], 0];
    }
  }
  return undefined;
}

const GPS_REF_MAP: Record<string, string> = {
  n: 'N', north: 'N', s: 'S', south: 'S',
  e: 'E', east: 'E', w: 'W', west: 'W',
};

/** Maps 'N'|'North'|'S'|'South'|'E'|'East'|'W'|'West' to the single ref letter. */
function toGpsRef(value: TagValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  return GPS_REF_MAP[value.trim().toLowerCase()];
}

function refFromCoordinate(value: TagValue, fallback: string): string | undefined {
  if (typeof value === 'string') {
    const m = value.match(/([NSEW])\s*"?$/);
    if (m) return m[1];
  }
  return fallback;
}

function rationals(pairs: [number, number][], signed: boolean, le: boolean): Uint8Array {
  const buf = new ArrayBuffer(pairs.length * 8);
  const dv = new DataView(buf);
  pairs.forEach(([num, den], i) => {
    if (signed) {
      dv.setInt32(i * 8, num, le);
      dv.setInt32(i * 8 + 4, den, le);
    } else {
      dv.setUint32(i * 8, num >>> 0, le);
      dv.setUint32(i * 8 + 4, den >>> 0, le);
    }
  });
  return new Uint8Array(buf);
}

export function encodeValue(
  spec: IfdTagSpec,
  value: TagValue,
  le = true,
): { data: Uint8Array; count: number } | undefined {
  if (spec.type === 2) {
    const ascii = toAscii(value);
    return ascii ? { data: ascii, count: ascii.length } : undefined;
  }
  if (spec.type === 3) {
    let n: number | undefined;
    if (typeof value === 'number') n = Math.round(value);
    else if (typeof value === 'string') {
      const parsed = Number(value);
      n = Number.isFinite(parsed) ? Math.round(parsed) : undefined;
    }
    if (n === undefined || n < 0 || n > 0xFFFF) return undefined;
    return le
      ? { data: new Uint8Array([n & 255, (n >> 8) & 255]), count: 1 }
      : { data: new Uint8Array([(n >> 8) & 255, n & 255]), count: 1 };
  }
  if (spec.type === 1 || spec.type === 4 || spec.type === 7) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (spec.type === 1) {
        if (value < 0 || value > 255) return undefined;
        return { data: new Uint8Array([value]), count: 1 };
      }
      if (spec.type === 4) {
        if (value < 0 || value > 0xFFFFFFFF) return undefined;
        const dv = new DataView(new ArrayBuffer(4));
        dv.setUint32(0, value, le);
        return { data: new Uint8Array(dv.buffer), count: 1 };
      }
      return undefined;
    }
    if (typeof value === 'string') {
      if (spec.type !== 7) return undefined;
      const bytes = new TextEncoder().encode(value);
      return { data: bytes, count: bytes.length };
    }
    if (value instanceof Uint8Array) {
      if (spec.type !== 7) return undefined;
      return { data: value, count: value.length };
    }
    if (Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const nums = value as number[];
      if (spec.count !== undefined && nums.length !== spec.count) return undefined;
      if (spec.type === 1) {
        if (nums.some((n) => n < 0 || n > 255)) return undefined;
        return { data: new Uint8Array(nums), count: nums.length };
      }
      if (spec.type === 4) {
        if (nums.some((n) => n < 0 || n > 0xFFFFFFFF)) return undefined;
        const buf = new ArrayBuffer(nums.length * 4);
        const dv = new DataView(buf);
        nums.forEach((n, i) => dv.setUint32(i * 4, n, le));
        return { data: new Uint8Array(buf), count: nums.length };
      }
      return { data: new Uint8Array(nums), count: nums.length };
    }
    return undefined;
  }
  // RATIONAL (5) / SRATIONAL (10)
  const signed = spec.type === 10;
  const encodePair = (r: [number, number]) => {
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1]) || r[1] === 0) return undefined;
    return r;
  };
  if (Array.isArray(value)) {
    const pairs: [number, number][] = [];
    if (spec.count !== undefined && value.length === spec.count) {
      // Fixed-count list: each element is one rational (e.g. LensInfo's 4 entries).
      for (const v of value) {
        const r = toRational(v);
        if (!r || !encodePair(r)) return undefined;
        pairs.push(r);
      }
    } else {
      for (let i = 0; i + 1 < value.length; i += 2) {
        const r = toRational([value[i], value[i + 1]]);
        if (!r || !encodePair(r)) return undefined;
        pairs.push(r);
      }
    }
    if (pairs.length === 0) return undefined;
    return { data: rationals(pairs, signed, le), count: pairs.length };
  }
  const r = toRational(value);
  if (!r || !encodePair(r)) return undefined;
  return { data: rationals([r], signed, le), count: 1 };
}

interface Prepared {
  spec: IfdTagSpec;
  data: Uint8Array;
  count: number;
}

const USER_COMMENT_HEADER = new Uint8Array([0x41, 0x53, 0x43, 0x49, 0x49, 0, 0, 0]); // 'ASCII\0\0\0'

function encodeUserComment(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const body = new TextEncoder().encode(value);
  if (
    body.length >= 8 &&
    body[0] === 0x41 && body[1] === 0x53 && body[2] === 0x43 && body[3] === 0x49 &&
    body[4] === 0x49 && body[5] === 0x00 && body[6] === 0x00 && body[7] === 0x00
  ) {
    return { data: body, count: body.length };
  }
  const out = new Uint8Array(8 + body.length);
  out.set(USER_COMMENT_HEADER);
  out.set(body, 8);
  return { data: out, count: out.length };
}

function encodeVersion(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const bytes = new TextEncoder().encode(value).subarray(0, 4);
  const out = new Uint8Array(4);
  out.set(bytes);
  return { data: out, count: 4 };
}

function encodeGpsVersionId(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s*[.\s]\s*/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return { data: new Uint8Array(parts), count: 4 };
    }
    return undefined;
  }
  return encodeValue(GPS_IFD_TAGS.gpsversionid, value);
}

function encodeGpsAltitude(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const stripped = value.trim().replace(/\s*m$/, '');
    const n = Number(stripped);
    if (Number.isFinite(n)) return encodeValue(GPS_IFD_TAGS.gpsaltitude, n);
    return undefined;
  }
  return encodeValue(GPS_IFD_TAGS.gpsaltitude, value);
}

function encodeGpsAltitudeRef(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'above sea level' || s === '0') return { data: new Uint8Array([0]), count: 1 };
    if (s === 'below sea level' || s === '1') return { data: new Uint8Array([1]), count: 1 };
    return undefined;
  }
  if (typeof value === 'number' && (value === 0 || value === 1)) {
    return { data: new Uint8Array([value]), count: 1 };
  }
  return undefined;
}

function encodeGpsTimeStamp(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value === 'string') {
    const m = value.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (!m) return undefined;
    const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
    return encodeValue(GPS_IFD_TAGS.gpstimestamp, parts);
  }
  return encodeValue(GPS_IFD_TAGS.gpstimestamp, value);
}

function encodeGpsDateStamp(value: TagValue): { data: Uint8Array; count: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})$/);
  if (!m) return undefined;
  return encodeValue(GPS_IFD_TAGS.gpsdatestamp, `${m[1]}:${m[2]}:${m[3]}`);
}

const COORD_TAG_NAMES = new Set(['GPSLatitude', 'GPSLongitude', 'GPSDestLatitude', 'GPSDestLongitude']);

/**
 * Encodes one tag. GPS coordinate tags may synthesize their ref entry
 * (`GPSLatitudeRef`/…) when the tag map does not carry an explicit one.
 */
function encodeTag(
  spec: IfdTagSpec,
  value: TagValue,
  tags: Record<string, TagValue>,
): { data: Uint8Array; count: number; extra?: Prepared[] } | undefined {
  switch (spec.name) {
    case 'UserComment':
      return encodeUserComment(value);
    case 'ExifVersion':
    case 'FlashpixVersion':
      return encodeVersion(value);
    case 'GPSVersionID':
      return encodeGpsVersionId(value);
    case 'GPSAltitude':
      return encodeGpsAltitude(value);
    case 'GPSAltitudeRef':
      return encodeGpsAltitudeRef(value);
    case 'GPSTimeStamp':
      return encodeGpsTimeStamp(value);
    case 'GPSDateStamp':
      return encodeGpsDateStamp(value);
    case 'GPSLatitudeRef':
    case 'GPSLongitudeRef':
    case 'GPSDestLatitudeRef':
    case 'GPSDestLongitudeRef': {
      const ref = toGpsRef(value);
      if (!ref) return undefined;
      return { data: new TextEncoder().encode(ref + '\0'), count: 2 };
    }
    case 'GPSLatitude':
    case 'GPSLongitude':
    case 'GPSDestLatitude':
    case 'GPSDestLongitude': {
      const coord = toGpsCoordinate(value);
      if (!coord) return undefined;
      const encoded = encodeValue(spec, coord);
      if (!encoded) return undefined;
      const refKey = spec.name.replace(/Latitude$/, 'LatitudeRef').replace(/Longitude$/, 'LongitudeRef');
      const refSpec = GPS_IFD_TAGS[refKey.toLowerCase()];
      const refEntry = Object.entries(tags).find(([k]) => k.toLowerCase() === refKey.toLowerCase());
      const refValue = refEntry?.[1];
      const ref = refValue !== undefined
        ? toGpsRef(refValue)
        : refFromCoordinate(value, spec.name.includes('Longitude') ? 'E' : 'N');
      const extra: Prepared[] = [];
      if (ref) {
        const refBytes = new TextEncoder().encode(ref + '\0');
        extra.push({ spec: refSpec, data: refBytes, count: refBytes.length });
      }
      return { ...encoded, extra };
    }
    default:
      return encodeValue(spec, value);
  }
}

/**
 * Serializes the writable subset of `tags` into a little-endian TIFF
 * structure: IFD0 plus ExifIFD (0x8769) and GPS IFD (0x8825) sub-IFDs.
 * Names are resolved through IFD0_TAGS/EXIF_IFD_TAGS/GPS_IFD_TAGS;
 * unrecognized or unencodable names are reported as skipped. Sub-IFD
 * pointer entries are synthesized only when the respective IFD has tags.
 */
export function buildTiff(tags: Record<string, TagValue>): BuildTiffResult {
  const written: string[] = [];
  const skipped: string[] = [];
  const prepared0: Prepared[] = [];
  const preparedE: Prepared[] = [];
  const preparedG: Prepared[] = [];
  const seenIds = new Set<number>();
  const synthRefs = new Map<number, Prepared>();

  for (const [name, value] of Object.entries(tags)) {
    const key = name.toLowerCase();
    const spec = IFD0_TAGS[key] ?? EXIF_IFD_TAGS[key] ?? GPS_IFD_TAGS[key];
    if (!spec) {
      skipped.push(name);
      continue;
    }
    if (seenIds.has(spec.id)) continue; // alias (e.g. CreateDate/DateTimeDigitized)
    const encoded = encodeTag(spec, value, tags);
    if (!encoded) {
      skipped.push(name);
      continue;
    }
    seenIds.add(spec.id);
    const target = EXIF_IFD_TAGS[key] ? preparedE : GPS_IFD_TAGS[key] ? preparedG : prepared0;
    target.push({ spec, data: encoded.data, count: encoded.count });
    if (encoded.extra) {
      for (const e of encoded.extra) {
        if (!synthRefs.has(e.spec.id)) synthRefs.set(e.spec.id, e);
      }
    }
    written.push(spec.name);
  }

  // Synthesized ref entries fill gaps only: an explicit entry (already in
  // seenIds) wins over a synthesized one.
  for (const [id, e] of synthRefs) {
    if (!seenIds.has(id)) {
      seenIds.add(id);
      preparedG.push(e);
      written.push(e.spec.name);
    }
  }

  const ifd0Size = 2 + (prepared0.length + (preparedE.length ? 1 : 0) + (preparedG.length ? 1 : 0)) * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = 2 + preparedE.length * 12 + 4;
  const gpsOff = exifOff + (preparedE.length ? exifSize : 0);
  const gpsSize = 2 + preparedG.length * 12 + 4;
  const valuesOffset = gpsOff + (preparedG.length ? gpsSize : 0);

  // IFD0 entries plus synthesized sub-IFD pointers, sorted by tag id.
  const ifd0Entries = [...prepared0];
  if (preparedE.length) {
    ifd0Entries.push({ spec: { id: 0x8769, type: 4, name: 'ExifIFDPointer' }, data: new Uint8Array(4), count: 1 });
  }
  if (preparedG.length) {
    ifd0Entries.push({ spec: { id: 0x8825, type: 4, name: 'GPSIFDPointer' }, data: new Uint8Array(4), count: 1 });
  }
  ifd0Entries.sort((a, b) => a.spec.id - b.spec.id);
  preparedE.sort((a, b) => a.spec.id - b.spec.id);
  preparedG.sort((a, b) => a.spec.id - b.spec.id);

  // Lay out oversized values first so offsets are known.
  const valueBlobs: Uint8Array[] = [];
  const valueOffsets = new Map<Prepared, number>();
  let cursor = valuesOffset;
  const layoutBlobs = (prepared: Prepared[]) => {
    for (const p of prepared) {
      if (p.data.length > 4) {
        valueOffsets.set(p, cursor);
        valueBlobs.push(p.data);
        cursor += p.data.length;
        if (cursor % 2) {
          valueBlobs.push(new Uint8Array([0]));
          cursor++;
        }
      }
    }
  };
  layoutBlobs(ifd0Entries);
  layoutBlobs(preparedE);
  layoutBlobs(preparedG);

  const total = cursor;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49; // 'II'
  dv.setUint16(2, 0x2A, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, ifd0Entries.length, true);

  const writeIfd = (offset: number, entries: Prepared[], nextIfd: number, pointerValues: Map<number, number>) => {
    dv.setUint16(offset, entries.length, true);
    let entryPos = offset + 2;
    for (const p of entries) {
      dv.setUint16(entryPos, p.spec.id, true);
      dv.setUint16(entryPos + 2, p.spec.type, true);
      dv.setUint32(entryPos + 4, p.count, true);
      const pointer = pointerValues.get(p.spec.id);
      if (pointer !== undefined) {
        dv.setUint32(entryPos + 8, pointer, true);
      } else if (p.data.length <= 4) {
        out.set(p.data, entryPos + 8);
      } else {
        dv.setUint32(entryPos + 8, valueOffsets.get(p)!, true);
      }
      entryPos += 12;
    }
    dv.setUint32(entryPos, nextIfd, true);
  };

  const pointerValues = new Map<number, number>();
  if (preparedE.length) pointerValues.set(0x8769, exifOff);
  if (preparedG.length) pointerValues.set(0x8825, gpsOff);

  writeIfd(8, ifd0Entries, 0, pointerValues);
  if (preparedE.length) writeIfd(exifOff, preparedE, 0, new Map());
  if (preparedG.length) writeIfd(gpsOff, preparedG, 0, new Map());

  let blobPos = valuesOffset;
  for (const blob of valueBlobs) {
    out.set(blob, blobPos);
    blobPos += blob.length;
  }

  return { bytes: out, written, skipped };
}
