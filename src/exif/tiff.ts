import { parseIFD } from './ifd.js';
import { parseXMP } from './xmp.js';
import type { ParseHints } from '../format/mod.js';
import { formatExifValue, getTagName, readIfdValue, readRationalRaw, EXIF_POINTER_TAGS } from './values.js';
import type { TagValue } from '../types.js';
import type { TagDb } from '../tag-db.js';

const TIFF_MAGIC_BIG = 0x4d4d;
const TIFF_MAGIC_LITTLE = 0x4949;
const TIFF_MAGIC_VALUE = 42;
const PANASONIC_MAGIC_VALUE = 85;

/**
 * Optional container-level behaviours for {@link parseTiff}. TIFF-based RAW
 * containers (DNG, CR2, NEF, …) need SubIFD chains (where raw image tags
 * live), embedded XMP, and Panasonic's non-42 magic; JPEG/PNG/WebP/AVIF
 * embedded-Exif callers omit it and keep the default behaviour.
 */
export interface TiffParseOptions {
  /** Walk IFD0 tag 0x014a (SubIFDs, incl. one chained level) and emit their entries. */
  subIfds?: boolean;
  /** Decode IFD0 tag 0x02bc (XMP packet) into flattened tags. */
  xmp?: boolean;
  /** Accept Panasonic magic 85 ('IIU\0') in addition to 42. */
  panasonic?: boolean;
}

function isTiffHeader(bytes: Uint8Array, opts?: TiffParseOptions): boolean {
  if (bytes.length < 8) return false;
  const magic = (bytes[0] << 8) | bytes[1];
  if (magic !== TIFF_MAGIC_BIG && magic !== TIFF_MAGIC_LITTLE) return false;
  const isLE = magic === TIFF_MAGIC_LITTLE;
  const version = isLE ? (bytes[2] | (bytes[3] << 8)) : (bytes[3] | (bytes[2] << 8));
  return version === TIFF_MAGIC_VALUE ||
    (opts?.panasonic === true && version === PANASONIC_MAGIC_VALUE);
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

/**
 * Parses TIFF/EXIF data and extracts metadata tags.
 *
 * Handles:
 * - IFD0: Basic image tags (ImageWidth, ImageHeight, Make, Model, etc.)
 * - Exif IFD: Camera settings (ExposureTime, FNumber, ISO, etc.)
 * - GPS IFD: Geolocation data (Latitude, Longitude, Altitude, etc.)
 * - Interoperability IFD
 * - Sub-IFDs (MakerNotes, etc.)
 *
 * Supports both little-endian (Intel) and big-endian (Motorola) byte orders.
 *
 * @param bytes - TIFF/EXIF data
 * @param tagDb - Optional tag database for name resolution
 * @param hints - Optional parsing hints
 * @param opts - Optional container behaviours (SubIFDs, XMP, Panasonic magic)
 * @returns Extracted tags as key-value pairs
 */
 export function parseTiff(
  bytes: Uint8Array,
  tagDb?: TagDb,
  hints?: ParseHints,
  opts?: TiffParseOptions,
): Record<string, TagValue> {
  const result: Record<string, TagValue> = {};
  const { coordFormat, duplicates } = hints ?? {};
  if (!isTiffHeader(bytes, opts)) return result;

  // ExifTool priority model (TIFF.pm): tags carry a priority — full-
  // resolution IFDs emit at 2; once an IFD's NewSubfileType says
  // "reduced-resolution" (1/2/3), its remaining tags drop to 1. A later
  // higher-priority value overrides a demoted one; equal priority keeps
  // the first (hints.duplicates lifts the suppression).
  const priority: Record<string, number> = {};
  const put = (name: string, value: TagValue, prio: number): void => {
    const cur = priority[name];
    if (cur === undefined || prio > cur || duplicates) {
      result[name] = value;
      priority[name] = prio;
    }
  };

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
  const TAG_SUB_IFDS = 0x014a;
  const TAG_NEW_SUBFILE_TYPE = 0x00fe;
  const TAG_XMP = 0x02bc;

  const ifd0 = parseIFD(view, ifd0Offset, littleEndian);
  const subIfdOffsets: number[] = [];
  let demoted = false; // true once IFD0's NewSubfileType says "reduced"
  for (const entry of ifd0.entries) {
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
    if (entry.tag === TAG_SUB_IFDS) {
      // RAW containers keep their raw-image tags (ImageWidth/ImageHeight,
      // compression, …) in SubIFDs. readIfdValue yields one LONG (count 1)
      // or a LONG array (count N). The pointer itself is not emitted.
      if (opts?.subIfds) {
        const offsets = typeof val === 'number' ? [val]
          : Array.isArray(val) ? val.filter((v): v is number => typeof v === 'number')
          : [];
        subIfdOffsets.push(...offsets);
      }
      continue;
    }
    if (opts?.xmp && entry.tag === TAG_XMP) {
      // XMP packets arrive as type 7 (UNDEFINED) or type 1 (BYTE) data.
      // First-wins merge like the JPEG APP1 XMP path; the raw XMP blob
      // key itself is not emitted.
      const xmpBytes = val instanceof Uint8Array
        ? val
        : Array.isArray(val) && val.every((n) => typeof n === 'number')
          ? Uint8Array.from(val as number[])
          : undefined;
      if (xmpBytes && xmpBytes.length > 0) {
        const xmpTags = parseXMP(new TextDecoder().decode(xmpBytes));
        for (const [k, v] of Object.entries(xmpTags)) {
          if (!(k in result)) put(k, v, demoted ? 1 : 2);
        }
      }
      continue;
    }
    const name = resolveTagName(entry.tag, 'ifd0', tagDb);
    if (!name) continue;
    if (EXIF_POINTER_TAGS.has(name)) continue;
    if (entry.tag === TAG_NEW_SUBFILE_TYPE) {
      // NewSubfileType itself keeps full priority even when it demotes
      // the rest of this IFD (exiftool keeps the first SubfileType read).
      put(name, formatExifValue(val, name), 2);
      if (val === 1 || val === 2 || val === 3) demoted = true;
      continue;
    }
    put(name, formatExifValue(val, name), demoted ? 1 : 2);
  }

  // Walk the SubIFDs (plus one chained level each) after IFD0 so the
  // priority model can arbitrate collisions between them.
  if (opts?.subIfds) {
    for (const off of subIfdOffsets) {
      if (!off || off >= bytes.length) continue;
      let sub = parseIFD(view, off, littleEndian);
      for (let level = 0; level < 2; level++) {
        let subDemoted = false;
        for (const se of sub.entries) {
          const sname = resolveTagName(se.tag, 'ifd0', tagDb);
          if (!sname || EXIF_POINTER_TAGS.has(sname)) continue;
          const sval = readIfdValue(se, view, littleEndian);
          if (se.tag === TAG_NEW_SUBFILE_TYPE) {
            put(sname, formatExifValue(sval, sname), 2);
            if (sval === 1 || sval === 2 || sval === 3) subDemoted = true;
            continue;
          }
          put(sname, formatExifValue(sval, sname), subDemoted ? 1 : 2);
        }
        if (!sub.nextIfdOffset || sub.nextIfdOffset >= bytes.length) break;
        sub = parseIFD(view, sub.nextIfdOffset, littleEndian);
      }
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
      // Canon's sensor-diagonal algorithm needs the raw rational pair
      // (numerator = pixels * 1000, denominator = sensor size in inches *
      // 1000) — the quotient we normally store loses that information.
      if (entry.type === 5 && (entry.tag === 0xa20e || entry.tag === 0xa20f)) {
        result[entry.tag === 0xa20e ? 'FocalPlaneXResolutionRaw' : 'FocalPlaneYResolutionRaw'] =
          readRationalRaw(view, entry.offset, littleEndian);
      }
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
      const name = resolveTagName(entry.tag, 'ifd0', tagDb);
      if (!name || EXIF_POINTER_TAGS.has(name)) continue;
      const val = readIfdValue(entry, view, littleEndian);
      const strippedName = name.startsWith('Thumbnail') ? name.slice('Thumbnail'.length) : name;
      if (!duplicates && strippedName in result) continue;
      result[`Thumbnail${strippedName}`] = formatExifValue(val, name);
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
    return fmt.replace(TOKEN_RE, (_all, precStr?: string, token?: 'd' | 'f' | 's' | 'c') => {
      const n = precStr !== undefined ? parseInt(precStr, 10) : 6;
      const rendered: Record<string, string> = {
        d: String(d),
        f: minutes.toFixed(n),
        s: s.toFixed(n),
        c: refLetter,
      };
      return token !== undefined && token in rendered ? rendered[token] : _all;
    });
  }

  return undefined; // unrecognized format → caller falls back to DMS
}

/**
 * Formats a GPS coordinate with compass reference.
 * @param value - Coordinate value (rational array [deg, min, sec])
 * @param ref - Compass reference (N, S, E, W)
 * @param coordFormat - Optional format string (ExifTool style)
 * @returns Formatted coordinate string
 */
 export function formatGPSWithRef(value: TagValue, ref: string, coordFormat?: string): string {
  if (coordFormat) {
    const rendered = renderCoordFormat(coordFormat, value, ref);
    if (rendered !== undefined) return rendered;
  }
  if (!Array.isArray(value) || value.length < 2) return String(value);
  // ExifTool ToDMS round-trip: decimal degrees first, then decompose —
  // see the matching comment in values.ts formatGPSRationalArray.
  const deg = Number(value[0]);
  const min = Number(value[1]);
  const sec = value.length > 2 ? Number(value[2]) : 0;
  const decimal = deg + min / 60 + sec / 3600;
  const secondsTotal = Math.abs(decimal) * 3600;
  const minInt = Math.floor(min);
  const secFinal = secondsTotal - deg * 3600 - minInt * 60;
  if (secFinal > 0.005) {
    return `${deg} deg ${minInt}' ${secFinal.toFixed(2)}"${ref ? ` ${ref}` : ''}`;
  }
  return `${deg} deg ${min.toFixed(4)}'${ref ? ` ${ref}` : ''}`;
}

/**
 * Extracts EXIF tags from a TIFF block (used for embedded EXIF in PNG/WebP).
 * @param bytes - TIFF data
 * @returns Extracted tags
 */
 export function extractExifFromTiff(bytes: Uint8Array): Record<string, TagValue> {
  return parseTiff(bytes);
}
