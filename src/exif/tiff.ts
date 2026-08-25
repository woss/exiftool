import { parseIFD } from './ifd.ts';
import { formatExifValue, getTagName, readIfdValue, EXIF_POINTER_TAGS } from './values.ts';
import type { TagValue } from '../types.ts';
import type { TagDb } from '../tag-db.ts';

const TIFF_MAGIC_BIG = 0x4d4d;
const TIFF_MAGIC_LITTLE = 0x4949;
const TIFF_MAGIC_VALUE = 42;

function isTiffHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const magic = (bytes[0] << 8) | bytes[1];
  if (magic !== TIFF_MAGIC_BIG && magic !== TIFF_MAGIC_LITTLE) return false;
  const isLE = magic === TIFF_MAGIC_LITTLE;
  const fortyTwo = isLE ? (bytes[2] | (bytes[3] << 8)) : (bytes[3] | (bytes[2] << 8));
  return fortyTwo === TIFF_MAGIC_VALUE;
}

function tagIdToStr(id: number): string {
  return String(id);
}

function resolveTagName(
  tag: number,
  group: 'ifd0' | 'exif' | 'gps',
  tagDb?: TagDb,
): string | undefined {
  if (tagDb) {
    const dbGroup = group === 'gps' ? 'GPS' : 'IFD0';
    const entry = tagDb.getById(tagIdToStr(tag), dbGroup);
    if (entry) return entry.name;
  }
  return getTagName(tag, group);
}

export function parseTiff(bytes: Uint8Array, tagDb?: TagDb, coordFormat?: string): Record<string, TagValue> {
  const result: Record<string, TagValue> = {};

  if (!isTiffHeader(bytes)) return result;

  const littleEndian = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const ifd0Offset = littleEndian
    ? (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24))
    : (bytes[7] | (bytes[6] << 8) | (bytes[5] << 16) | (bytes[4] << 24));

  if (ifd0Offset < 8 || ifd0Offset >= bytes.length) return result;

  let exifIfdPtr: number | undefined;
  let gpsIfdPtr: number | undefined;

  const TAG_EXIF_IFD = 0x8769;
  const TAG_GPS_INFO = 0x8825;
  const TAG_INTEROP = 0xa005;

  const ifd0 = parseIFD(view, ifd0Offset, littleEndian);
  for (const entry of ifd0.entries) {
    const name = resolveTagName(entry.tag, 'ifd0', tagDb);
    if (entry.tag === TAG_EXIF_IFD) {
      const val = readIfdValue(entry, view, littleEndian);
      exifIfdPtr = typeof val === 'number' ? val : undefined;
      continue;
    }
    if (entry.tag === TAG_GPS_INFO) {
      const val = readIfdValue(entry, view, littleEndian);
      gpsIfdPtr = typeof val === 'number' ? val : undefined;
      continue;
    }
    const val = readIfdValue(entry, view, littleEndian);
    if (name) {
      if (EXIF_POINTER_TAGS.has(name)) continue;
      result[name] = formatExifValue(val, name);
    }
  }

  if (exifIfdPtr && exifIfdPtr < bytes.length) {
    const exifIfd = parseIFD(view, exifIfdPtr, littleEndian);
    for (const entry of exifIfd.entries) {
      const name = resolveTagName(entry.tag, 'exif', tagDb);
      if (entry.tag === TAG_INTEROP) {
        const val = readIfdValue(entry, view, littleEndian);
        const ptr = typeof val === 'number' ? val : undefined;
        if (ptr && ptr < bytes.length) {
          const interop = parseIFD(view, ptr, littleEndian);
          for (const ie of interop.entries) {
            const iname = getTagName(ie.tag, 'exif');
            if (iname && !EXIF_POINTER_TAGS.has(iname)) {
              result[`Interop_${iname}`] = readIfdValue(ie, view, littleEndian);
            }
          }
        }
        continue;
      }
      const val = readIfdValue(entry, view, littleEndian);
      if (name) {
        if (EXIF_POINTER_TAGS.has(name)) continue;
        result[name] = formatExifValue(val, name);
      }
    }
  }

  if (gpsIfdPtr && gpsIfdPtr < bytes.length) {
    const gpsIfd = parseIFD(view, gpsIfdPtr, littleEndian);
    const gpsRaw: Record<string, TagValue> = {};
    for (const entry of gpsIfd.entries) {
      const name = resolveTagName(entry.tag, 'gps', tagDb);
      const val = readIfdValue(entry, view, littleEndian);
      if (name && !EXIF_POINTER_TAGS.has(name)) {
        gpsRaw[name] = val;
      }
    }

    for (const [k, v] of Object.entries(gpsRaw)) {
      if (k === 'GPSLatitude') {
        const ref = gpsRaw['GPSLatitudeRef'];
        result[k] = formatGPSWithRef(v, typeof ref === 'string' ? ref : '', coordFormat);
      } else if (k === 'GPSLongitude') {
        const ref = gpsRaw['GPSLongitudeRef'];
        result[k] = formatGPSWithRef(v, typeof ref === 'string' ? ref : '', coordFormat);
      } else {
        result[k] = formatExifValue(v, k);
      }
    }
  }

  if (ifd0.nextIfdOffset && ifd0.nextIfdOffset < bytes.length) {
    const ifd1 = parseIFD(view, ifd0.nextIfdOffset, littleEndian);
    for (const entry of ifd1.entries) {
      let name = resolveTagName(entry.tag, 'ifd0', tagDb);
      const val = readIfdValue(entry, view, littleEndian);
      if (name) {
        if (EXIF_POINTER_TAGS.has(name)) continue;
        const strippedName = name.startsWith('Thumbnail') ? name.slice('Thumbnail'.length) : name;
        result[`Thumbnail${strippedName}`] = formatExifValue(val, name);
      }
    }
  }

  return result;
}

const PURE_DECIMAL_RE = /^%([+]?)[.]?(\d*)f$/;
const TOKEN_RE = /%(?:\.(\d+))?([dfsc])/g;

function decimalDegrees(value: TagValue): number | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const deg = Number(value[0]);
  const min = Number(value[1]);
  const sec = value.length > 2 ? Number(value[2]) : 0;
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return undefined;
  return deg + min / 60 + sec / 3600;
}

function renderCoordFormat(
  fmt: string,
  value: TagValue,
  ref: string,
): string | undefined {
  const refLetter = ref ? ref.charAt(0).toUpperCase() : '';
  const southOrWest = refLetter === 'S' || refLetter === 'W';

  // Pure decimal format: %f, %+f, %.Nf, %+.Nf
  const decimal = fmt.match(PURE_DECIMAL_RE);
  if (decimal) {
    const dd = decimalDegrees(value);
    if (dd === undefined) return String(value);
    const signed = southOrWest ? -dd : dd;
    const precision = decimal[2] !== '' ? parseInt(decimal[2], 10) : 6;
    const text = Math.abs(signed).toFixed(precision);
    return (signed < 0 ? '-' : decimal[1]) + text;
  }

  // Template format containing %d / %.Nf / %.Ns / %c tokens
  TOKEN_RE.lastIndex = 0;
  if (TOKEN_RE.test(fmt)) {
    const dd = decimalDegrees(value);
    if (dd === undefined) return String(value);
    const absDd = Math.abs(southOrWest ? -dd : dd);
    const d = Math.floor(absDd);
    const minutes = absDd * 60 - d * 60;
    const s = (minutes - Math.floor(minutes)) * 60;
    return fmt.replace(TOKEN_RE, (_all, precStr?: string, token?: string) => {
      const n = precStr !== undefined ? parseInt(precStr, 10) : 6;
      switch (token) {
        case 'd':
          return String(d);
        case 'f':
          return minutes.toFixed(n);
        case 's':
          return s.toFixed(n);
        case 'c':
          return refLetter;
        default:
          return _all;
      }
    });
  }

  return undefined; // unrecognized format → caller falls back to DMS
}

export function formatGPSWithRef(value: TagValue, ref: string, coordFormat?: string): string {
  if (coordFormat) {
    const rendered = renderCoordFormat(coordFormat, value, ref);
    if (rendered !== undefined) return rendered;
  }
  if (!Array.isArray(value) || value.length < 2) return String(value);
  const deg = Number(value[0]);
  const min = Number(value[1]);
  const sec = value.length > 2 ? Number(value[2]) : 0;
  const totalSec = min * 60 + sec;
  const secVal = totalSec;
  const secRounded = Math.round(secVal * 100) / 100;
  const minInt = Math.floor(min);
  const secFrac = min - minInt + sec / 60;
  const secFinal = secFrac * 60;
  if (secFinal > 0.01) {
    return `${deg} deg ${minInt}' ${secFinal.toFixed(2)}"${ref ? ` ${ref}` : ''}`;
  }
  return `${deg} deg ${min.toFixed(4)}'${ref ? ` ${ref}` : ''}`;
}

export function extractExifFromTiff(bytes: Uint8Array): Record<string, TagValue> {
  return parseTiff(bytes);
}
