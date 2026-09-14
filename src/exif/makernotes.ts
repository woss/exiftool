/**
 * MakerNote decoding (v1 scope: Canon, Nikon, Sony, Olympus, Panasonic,
 * Pentax). ExifTool decodes vendor makernotes into hundreds of value tags;
 * without this module the library emits a `[MakerNote: N bytes]` marker.
 *
 * Design (mirrors ExifTool's MakerNotes.pm dispatch):
 * - `decodeMakerNote` matches the `Make` string against a vendor table and
 *   returns a flat tag record; it NEVER throws and returns `{}` on any
 *   unknown vendor or parse failure — a bad makernote must not fail a parse.
 * - Each vendor decoder reuses `parseIFD`/`readIfdValue` with a DataView
 *   based at the makernote's own offset origin ("base"), so IFD entry value
 *   offsets resolve exactly as the camera wrote them.
 * - Positional sub-table names and PrintConv enums come from the generated
 *   maker-printconv.json (extracted from the ExifTool Perl source by
 *   scripts/extract-maker-printconv.py). Expression PrintConv/ValueConv
 *   transforms are hand-ported in VENDOR_SPECIALS.
 * - Tags whose Perl table sets `Priority => 0` report priority 1 via
 *   `prioOut` so the caller keeps first-read-wins against EXIF tags.
 */

import { parseIFD } from './ifd.js';
import { readIfdValue } from './values.js';
import type { TagDb } from '../tag-db.js';
import type { IfdEntry } from './types.js';
import type { TagValue } from '../types.js';
import tagData from '../tags/generated/tags.json' with { type: 'json' };
import type { TableDef } from '../tags.js';
import makerPc from '../tags/generated/maker-printconv.json' with { type: 'json' };

export interface MakerNoteEnv {
  /** Full TIFF block (from the TIFF header onward). */
  bytes: Uint8Array;
  /** EXIF byte order of the enclosing TIFF block. */
  littleEndian: boolean;
  /** Make string from IFD0 (raw, untrimmed). */
  make: string;
  /** Model string from IFD0 (raw, untrimmed). */
  model: string;
  /** Optional tag database (reserved; name resolution uses the index below). */
  tagDb?: TagDb;
}

// ---------------------------------------------------------------------------
// Tag table index (per Perl table, from the generated database)
// ---------------------------------------------------------------------------

let tableIndex: Map<string, Map<string, string>> | undefined;

function getTableIndex(): Map<string, Map<string, string>> {
  if (!tableIndex) {
    tableIndex = new Map();
    for (const table of tagData as TableDef[]) {
      const map = new Map<string, string>();
      for (const t of table.tags) {
        if (!map.has(t.id)) map.set(t.id, t.name);
      }
      tableIndex.set(table.perlName, map);
    }
  }
  return tableIndex;
}

/** Resolves a tag name inside a specific Perl table; undefined on miss. */
function nameIn(table: string | undefined, id: number | string): string | undefined {
  return table ? getTableIndex().get(table)?.get(String(id)) : undefined;
}

/** ExifTool's unknown-makernote-tag naming: `Canon_0x0019` (lowercase hex). */
function unknownName(vendor: string, id: number): string {
  return `${vendor}_0x${id.toString(16).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Generated table access
// ---------------------------------------------------------------------------

interface ExtractedTag {
  name: string;
  /** Element count for multi-value entries (Format => 'int16s[4]'). */
  count?: number;
  /** ASCII string of N bytes at the id's byte offset (Format => 'string[N]'). */
  str?: number;
  raw?: 'skipZero' | 'skipNeg1' | 'skip0x7fff' | 'skipEq127' | 'skipNonPositive' | 'skipEq0' | 'skipNegative' | 'skipLt40' | 'custom';
  prio?: number;
  unknown?: number;
  pc?: Record<string, string>;
}

interface ExtractedTable {
  format: string | null;
  firstEntry: number;
  tags: Record<string, ExtractedTag>;
}

const TABLES = makerPc.tables as unknown as Record<string, ExtractedTable>;
const ROUTING = makerPc.routing as unknown as Record<string, Record<string, string>>;

/** ExifTool's PrintConv for exposure times ("1/16", "0.3", "2"). */
function exposureTime(v: number): string {
  if (v >= 1) return String(v);
  return `1/${Math.round(1 / v)}`;
}

/** Port of Image::ExifTool::Canon::CanonEv (hex-based EV, modulo 0x20). */
function canonEv(val: number): number {
  const sign = val < 0 ? -1 : 1;
  val = Math.abs(val);
  let frac = val & 0x1f;
  val -= frac;
  if (frac === 0x0c) frac = 0x20 / 3;
  else if (frac === 0x14) frac = 0x40 / 3;
  return (sign * (val + frac)) / 0x20;
}

/** Port of Image::ExifTool::Exif::PrintFraction. */
function fracStr(v: number): string {
  const val = v * 1.00001;
  if (val === 0) return '0';
  const int = Math.trunc(val);
  const sign = val < 0 ? '-' : '+';
  const abs = Math.abs(val);
  const intAbs = Math.abs(int);
  if (intAbs / abs > 0.999) return `${sign}${intAbs}`;
  if (Math.trunc(abs * 2) / (abs * 2) > 0.999) return `${sign}${Math.trunc(abs * 2)}/2`;
  if (Math.trunc(abs * 3) / (abs * 3) > 0.999) return `${sign}${Math.trunc(abs * 3)}/3`;
  return `${sign}${Number(abs.toPrecision(3))}`;
}

const APER = (raw: number): TagValue => Number(Math.exp((canonEv(raw) * Math.LN2) / 2).toPrecision(2));
const EV_TIME = (raw: number): TagValue => exposureTime(Math.exp(-canonEv(raw) * Math.LN2));

/**
 * Hand-ported expression ValueConv/PrintConv pairs (the extractor skips
 * Perl expressions), keyed by tag name. Applied after the generated hash
 * lookup misses.
 */
const OLYMPUS_SPECIALS: Record<string, (v: TagValue) => TagValue> = {
  Quality: (v) => {
    // Olympus.pm Quality (t2 map: all camera types except SX/D4322)
    const n = typeof v === 'number' ? v : 0;
    const t2: Record<number, string> = {
      1: 'SQ (Low)',
      2: 'HQ (Normal)',
      3: 'SHQ (Fine)',
      4: 'RAW',
      5: 'Medium-Fine',
      6: 'Small-Fine',
      33: 'Uncompressed',
    };
    return t2[n] ?? n;
  },
  SpecialMode: (v) => {
    const a = Array.isArray(v) ? v.map(Number) : [Number(v), 0, 0];
    const mode = ['Normal', 'High', 'Low'][a[0]] ?? a[0];
    const pano = a[2] === 0 ? '(none)' : a[2] === 1 ? 'Left Bottom' : `Position ${a[2] - 1}`;
    return `${mode}, Sequence: ${a[1]}, Panorama: ${pano}`;
  },
};

const VENDOR_SPECIALS: Record<string, (v: number) => TagValue> = {
  FileNumber: (v) => `${v >>> 16}-${String(v & 0xffff).padStart(4, '0')}`,
  SerialNumber: (v) => String(v).padStart(10, '0'),
  AutoISO: (v) => Math.round(Math.exp((v / 32) * Math.LN2) * 100),
  BaseISO: (v) => Math.round((Math.exp((v / 32) * Math.LN2) * 100) / 32),
  MeasuredEV: (v) => Number((v / 32 + 5).toFixed(2)),
  MeasuredEV2: (v) => Number((v / 8 - 6).toFixed(3)),
  TargetAperture: APER,
  MaxAperture: APER,
  MinAperture: APER,
  FNumber: APER,
  DisplayAperture: (v) => v / 10,
  TargetExposureTime: EV_TIME,
  ExposureTime: EV_TIME,
  FlashGuideNumber: (v) => v / 32,
  CameraTemperature: (v) => `${v - 128} C`,
  BulbDuration: (v) => v / 10,
  SelfTimer2: (v) => v / 10,
  OpticalZoomCode: (v) => (v === 8 ? 'n/a' : v),
  ExposureCompensation: (v) => fracStr(canonEv(v)),
  FlashExposureComp: (v) => fracStr(canonEv(v)),
  AEBBracketValue: (v) => fracStr(canonEv(v)),
  FocalLength: (v) => `${v} mm`,
  MinFocalLength: (v) => `${v} mm`,
  MaxFocalLength: (v) => `${v} mm`,
  FocalPlaneXSize: (v) => `${((v * 25.4) / 1000).toFixed(2)} mm`,
  FocalPlaneYSize: (v) => `${((v * 25.4) / 1000).toFixed(2)} mm`,
  FocalUnits: (v) => `${v}/mm`,
  SelfTimer: (v) => (v === 0 ? 'Off' : `${(v & 0xfff) / 10} s`),
  FlashBits: (v) => {
    if (v === 0) return '(none)';
    const bits: Array<[number, string]> = [
      [0x0001, 'E-TTL'],
      [0x0002, 'A-TTL'],
      [0x0004, 'TTL'],
      [0x0008, 'Built-in'],
      [0x0010, 'Manual flash'],
      [0x0040, 'Wireless EX (Master)'],
      [0x0080, 'FP sync enabled'],
      [0x2000, 'AF assist light'],
    ];
    return bits
      .filter(([bit]) => v & bit)
      .map(([, name]) => name)
      .join(', ');
  },
};

/** Custom RawConvs that reduce to a simple zero/negative skip. */
const SKIP_CUSTOM = new Set(['ExposureTime', 'FocusDistanceUpper', 'FlashOutput']);

/** RawConv skip-class predicates (exiftool drops the tag when they fail). */
function skipByClass(cls: ExtractedTag['raw'], v: number): boolean {
  switch (cls) {
    case 'skipZero': return v === 0;
    case 'skipNeg1': return v === -1;
    case 'skip0x7fff': return v === 0x7fff;
    case 'skipEq127': return v === 127;
    case 'skipNonPositive': return v <= 0;
    case 'skipEq0': return v === 0;
    case 'skipNegative': return v < 0;
    case 'skipLt40': return v < 40;
    default: return false;
  }
}

/**
 * Formats a decoded makernote value the way exiftool -j renders it:
 * generated PrintConv hashes, then hand-ported expression transforms, then
 * space-joined arrays / binary placeholders / raw values.
 */
function formatMakerValue(def: ExtractedTag | undefined, name: string, value: TagValue): TagValue {
  if (value instanceof Uint8Array) {
    return value.length > 0 ? `(Binary data ${value.length} bytes, use -b option to extract)` : '';
  }
  if (Array.isArray(value)) {
    return value.map((n) => String(n)).join(' ');
  }
  if (typeof value === 'number') {
    if (def?.pc) {
      const s = def.pc[String(value)];
      if (s !== undefined) return s;
    }
    const special = VENDOR_SPECIALS[name];
    if (special) return special(value);
    return value;
  }
  if (typeof value === 'string' && def?.pc) {
    const s = def.pc[value];
    if (s !== undefined) return s;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Positional (ProcessBinaryData) sub-table decoding
// ---------------------------------------------------------------------------

function readShorts(bytes: Uint8Array, signed: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let v = bytes[i] | (bytes[i + 1] << 8);
    if (signed) v = v > 0x7fff ? v - 0x10000 : v;
    out.push(v);
  }
  return out;
}

function readInts(bytes: Uint8Array, signed: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    let v = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
    if (signed) v = v > 0x7fffffff ? v - 0x100000000 : v;
    out.push(v);
  }
  return out;
}

/**
 * Decodes a Canon-style positional (ProcessBinaryData) sub-table: value N
 * lives at array index N — the leading size word occupies index 0 whenever
 * the table's FIRST_ENTRY is 1 (FocalLength-style tables start at id 0 with
 * no size word). Multi-count entries consume several slots; ids without
 * definitions skip one slot.
 */
function decodePositionalTable(
  table: ExtractedTable,
  bytes: Uint8Array,
  out: Record<string, TagValue>,
  prioOut?: Record<string, number>,
): void {
  const signed = table.format === 'int16s' || table.format === 'int32s';
  const wide = table.format === 'int32s' || table.format === 'int32u';
  const increment = wide ? 4 : 2;
  // ProcessBinaryData addressing: value N lives at byte offset N * increment
  // (the leading size word occupies offset 0 when FIRST_ENTRY is 1).
  for (const [idStr, def] of Object.entries(table.tags)) {
    const id = Number(idStr);
    const byteOff = id * increment;
    if (def.unknown) continue;
    if (def.str) {
      if (byteOff + def.str > bytes.length) continue;
      out[def.name] = asciiOf(bytes.subarray(byteOff, byteOff + def.str));
      continue;
    }
    const count = def.count ?? 1;
    const total = count * increment;
    if (byteOff + total > bytes.length) continue;
    let raw: TagValue;
    if (count === 1) {
      raw = wide ? readInts(bytes.subarray(byteOff, byteOff + 4), signed)[0]
        : readShorts(bytes.subarray(byteOff, byteOff + 2), signed)[0];
    } else {
      raw = wide ? readInts(bytes.subarray(byteOff, byteOff + total), signed)
        : readShorts(bytes.subarray(byteOff, byteOff + total), signed);
    }
    if (typeof raw === 'number') {
      if (SKIP_CUSTOM.has(def.name) && raw === 0) continue;
      if (skipByClass(def.raw, raw)) continue;
    }
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    out[def.name] = formatMakerValue(def, def.name, raw);
  }
}

// ---------------------------------------------------------------------------
// Canon
// ---------------------------------------------------------------------------

/**
 * Canon makernote routing (Canon.pm %Canon::Main): tag id -> positional
 * sub-table. Binary tables with custom PROCESS_PROC (CanonCustom, AFInfo,
 * FileInfo, DustRemovalData) and the model-conditional CameraInfo* tables
 * are skipped in v1 and left to KNOWN_DIVERGENCES.
 */
const CANON_SUBTABLES: Record<number, string> = {
  0x0001: 'Canon::CameraSettings',
  0x0002: 'Canon::FocalLength',
  0x0004: 'Canon::ShotInfo',
  0x0005: 'Canon::Panorama',
  0x0011: 'Canon::MovieInfo',
  0x001d: 'Canon::MyColors',
  0x00a0: 'Canon::Processing',
  0x00aa: 'Canon::MeasuredColor',
  0x0093: 'Canon::FileInfo',
  0x00e0: 'Canon::SensorInfo',
  0x4001: 'Canon::ColorData1',
  0x4003: 'Canon::ColorInfo',
};

/** Canon::Main tags whose conditional sub-tables are skipped in v1. */
const CANON_MAIN_SKIP = new Set([0x000d]);

/** Decodes a Canon makernote: no header, IFD at valueStart, offsets TIFF-absolute. */
function decodeCanon(
  _mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  const view = new DataView(env.bytes.buffer, env.bytes.byteOffset, env.bytes.byteLength);
  const ifd = parseIFD(view, valueStart, env.littleEndian);
  const out: Record<string, TagValue> = {};
  for (const entry of ifd.entries) {
    const tableName = CANON_SUBTABLES[entry.tag];
    if (tableName) {
      const table = TABLES[tableName];
      if (table) {
        decodePositionalTable(table, entry.value as Uint8Array, out, prioOut);
        continue;
      }
    }
    if (CANON_MAIN_SKIP.has(entry.tag)) continue;
    // Direct Canon::Main tag (from the extracted table, so Unknown flags and
    // RawConv filters match exiftool exactly).
    const def = TABLES['Canon::Main']?.tags[String(entry.tag)];
    if (!def || def.unknown) continue;
    let value: TagValue;
    if (entry.type === 2) {
      value = new TextDecoder().decode(entry.value as Uint8Array).split('\0', 1)[0];
    } else if (entry.type === 7 || entry.type === 1) {
      value = entry.value;
    } else {
      value = readIfdValue(entry, view, env.littleEndian);
    }
    if (typeof value === 'number' && skipByClass(def.raw, value)) continue;
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    out[def.name] = formatMakerValue(def, def.name, value);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Shared vendor helpers
// ---------------------------------------------------------------------------

/** DataView over the whole TIFF block. */
function fullView(env: MakerNoteEnv): DataView {
  return new DataView(env.bytes.buffer, env.bytes.byteOffset, env.bytes.byteLength);
}

/** DataView whose offset 0 sits at `base` — IFD entry offsets resolve
 *  relative to the vendor's own base automatically. */
function basedView(env: MakerNoteEnv, base: number): DataView {
  return new DataView(env.bytes.buffer, env.bytes.byteOffset + base, env.bytes.byteLength - base);
}

function asciiOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).split('\0', 1)[0];
}

function u32Of(bytes: Uint8Array, le: boolean): number {
  return le
    ? bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)
    : (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
}

function printableAscii(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return '';
  let text = '';
  for (const b of bytes) {
    if (b === 0) break;
    if (b < 0x20 || b > 0x7e) return undefined;
    text += String.fromCharCode(b);
  }
  return text;
}

function startsWith(buf: Uint8Array, text: string, off = 0): boolean {
  if (off + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[off + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Nikon
// ---------------------------------------------------------------------------

/** Port of exiftool's DecodeBits for Nikon LensType. */
function nikonLensType(v: number): TagValue {
  if (v === 0) return 'AF';
  const bits: Array<[number, string]> = [
    [0, 'MF'], [1, 'D'], [2, 'G'], [3, 'VR'],
    [4, '1'], [5, 'FT-1'], [6, 'E'], [7, 'AF-P'],
  ];
  // exiftool: joins bits, drops commas, folds "D G" into "G"
  const text = bits.filter(([bit]) => v & (1 << bit)).map(([, name]) => name).join(' ');
  return text.replace(/\bD G\b/, 'G') || v;
}

const NIKON_APERTURE = (v: number): TagValue => Number((2 ** (v / 24)).toFixed(1));
const NIKON_FOCAL = (v: number): TagValue => `${(5 * 2 ** (v / 24)).toFixed(1)} mm`;

/** Nikon LensData01 / LensData00 expression transforms. */
const NIKON_LENSDATA_SPECIALS: Record<string, (v: number) => TagValue> = {
  ExitPupilPosition: (v) => (v === 0 ? 0 : `${(2048 / v).toFixed(1)} mm`),
  AFAperture: NIKON_APERTURE,
  MaxApertureAtMinFocal: NIKON_APERTURE,
  MaxApertureAtMaxFocal: NIKON_APERTURE,
  EffectiveMaxAperture: NIKON_APERTURE,
  FocalLength: NIKON_FOCAL,
  MinFocalLength: NIKON_FOCAL,
  MaxFocalLength: NIKON_FOCAL,
  FocusDistance: (v) => (v === 0 ? 'inf' : `${(10 ** (v / 100)).toFixed(2)} m`),
  LensFStops: (v) => Number((v / 12).toFixed(2)),
  FocusPosition: (v) => `0x${v.toString(16).padStart(2, '0')}`,
};

/** Nikon stores uppercase space-padded enums; exiftool prints mixed case. */
const NIKON_STRING_MAPS: Record<string, Record<string, string>> = {
  WhiteBalance: {
    AUTO: 'Auto',
    DAYLIGHT: 'Daylight',
    CLOUDY: 'Cloudy',
    INCANDESCENT: 'Incandescent',
    FLUORESCENT: 'Fluorescent',
    FLASH: 'Flash',
    SHADE: 'Shade',
    'COLOR TEMP.': 'Color Temp.',
    PRESET: 'Preset',
  },
  ColorHue: { MODE1: 'Mode1', MODE2: 'Mode2', AUTO: 'Auto', OFF: 'Off' },
  NoiseReduction: { OFF: 'Off', ON: 'On' },
  HueAdjustment: { OFF: 'Off' },
};

/** Nikon MakerNoteVersion: undef '0210' renders as 2.1. */
function nikonVersion(bytes: Uint8Array): TagValue {
  const text = asciiOf(bytes);
  return /^\d{4}$/.test(text) ? Number(`${text[1]}.${text.slice(2)}`) : text;
}

function decodeNikon(
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  const le = env.littleEndian;
  let base: number;
  let ifdOff: number;
  if (mn.length >= 18 && startsWith(mn, 'Nikon\0') && mn[6] >= 2) {
    // Type 2: 10-byte header + embedded TIFF header; entry offsets resolve
    // relative to the embedded TIFF header start (valueStart + 10).
    base = valueStart + 10;
    ifdOff = valueStart + 18;
  } else if (mn.length >= 10 && startsWith(mn, 'Nikon\0') && mn[6] === 1) {
    // Type 1 (old Coolpix): little-endian IFD at +8, makernote-relative.
    base = valueStart;
    ifdOff = valueStart + 8;
    return decodeNikonIfd(basedView(env, base), ifdOff - base, true, 'Nikon::Type2', {}, env, prioOut);
  } else {
    // Type 3: headerless; offsets are TIFF-absolute.
    base = 0;
    ifdOff = valueStart;
  }
  return decodeNikonIfd(basedView(env, base), ifdOff - base, le, 'Nikon::Main', {}, env, prioOut, base);
}

function decodeNikonIfd(
  view: DataView,
  ifdOff: number,
  le: boolean,
  mainTable: string,
  keys: Record<string, number | string | undefined>,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
  nestedBase?: number,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  const ifd = parseIFD(view, ifdOff, le);
  const serialTag = mainTable === 'Nikon::Main' ? 0x001d : -1;
  const countTag = mainTable === 'Nikon::Main' ? 0x00a7 : -1;
  for (const entry of ifd.entries) {
    if (entry.tag === serialTag && entry.value instanceof Uint8Array) {
      const parsed = parseInt(asciiOf(entry.value), 10);
      keys.serial = Number.isFinite(parsed) ? parsed : undefined;
    } else if (entry.tag === countTag && (entry.value as Uint8Array).length >= 4) {
      keys.count = u32Of(entry.value as Uint8Array, le);
    }
  }
  for (const entry of ifd.entries) {
    const def = TABLES[mainTable]?.tags[String(entry.tag)];
    const name = def?.name ?? nameIn(mainTable, entry.tag) ?? unknownName('Nikon', entry.tag);
    if (mainTable === 'Nikon::Main' && entry.tag === 0x0011) {
      // PreviewIFD: one nested level; names resolve through the tag db.
      const ptr = entry.value instanceof Uint8Array ? u32Of(entry.value, le) : 0;
      if (ptr && (nestedBase ?? 0) + ptr + 2 <= env.bytes.length) {
        const preview = parseIFD(view, (nestedBase ?? 0) + ptr, le);
        for (const pe of preview.entries) {
          const pname = nameIn('Nikon::PreviewIFD', pe.tag);
          if (!pname) continue;
          const pval = readIfdValue(pe, view, le);
          if (pname === 'PreviewImageStart' || pname === 'PreviewImageLength') continue;
          out[pname] = formatMakerValue(undefined, pname, pval);
        }
      }
      continue;
    }
    if (mainTable === 'Nikon::Main' && entry.tag === 0x0001) {
      out['MakerNoteVersion'] = nikonVersion(entry.value as Uint8Array);
      continue;
    }
    if (mainTable === 'Nikon::Main' && entry.tag === 0x0098) {
      // LensData: 4-byte version + binary table (0101 unencrypted).
      const raw = entry.value as Uint8Array;
      const version = asciiOf(raw.subarray(0, 4));
      const lensTable =
        version === '0101' ? TABLES['Nikon::LensData01'] : version === '0100' ? TABLES['Nikon::LensData00'] : undefined;
      if (lensTable) {
        // Binary-data table: value N lives at byte offset N (version string
        // occupies 0-3); int8u values, ids sequential.
        for (const [idStr, ldef] of Object.entries(lensTable.tags)) {
          const id = Number(idStr);
          if (id === 0) {
            out[ldef.name] = version;
            continue;
          }
          if (id >= raw.length || ldef.unknown) continue;
          const val: TagValue = raw[id];
          const special = NIKON_LENSDATA_SPECIALS[ldef.name];
          out[ldef.name] = typeof val === 'number' && special ? special(val) : formatMakerValue(ldef, ldef.name, val);
        }
      } else {
        out['LensData'] = `(Binary data ${raw.length} bytes, use -b option to extract)`;
      }
      continue;
    }
    if (!def || def.unknown) continue;
    if (ROUTING['Nikon::Main']?.[String(entry.tag)]) continue; // custom-processed blocks (v1 gap)
    let value: TagValue;
    if (entry.type === 2) {
      value = asciiOf(entry.value as Uint8Array).replace(/ +$/, '');
      const map = NIKON_STRING_MAPS[def.name];
      if (map && typeof value === 'string') value = map[value] ?? value;
    } else if ((entry.type === 7 || entry.type === 1) && (entry.value as Uint8Array).length === 1) {
      value = (entry.value as Uint8Array)[0];
    } else if (entry.type === 7 || entry.type === 1) {
      value = entry.value;
    } else {
      value = readIfdValue(entry, view, le);
    }
    if (typeof value === 'number' && skipByClass(def.raw, value)) continue;
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    if (def.name === 'LensType' && typeof value === 'number' && !def.pc) {
      out[def.name] = nikonLensType(value);
      continue;
    }
    if (def.name === 'LensFStops' && value instanceof Uint8Array && value.length >= 1) {
      out[def.name] = Number((value[0] / 12).toFixed(2));
      continue;
    }
    out[def.name] = formatMakerValue(def, def.name, value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sony
// ---------------------------------------------------------------------------

/** Decodes a Sony makernote (headered DSC/CAM JPEGs or headerless ARW/MakN). */
function decodeSony(
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  const view = fullView(env);
  let base: number;
  let ifdOff: number;
  let le = env.littleEndian;
  if (startsWith(mn, 'SONY DSC \0') || startsWith(mn, 'SONY CAM \0') || startsWith(mn, 'SONY MOBILE\0')) {
    base = valueStart;
    ifdOff = valueStart + 12;
  } else {
    // Headerless (ARW/SR2 via Adobe MakN): optional II/MM marker + uint32
    // original position; entry offsets resolve relative to the original file.
    base = valueStart;
    ifdOff = valueStart;
    if (mn[0] === 0x49 && mn[1] === 0x49) {
      le = true;
      const originalPos = (mn[2] << 24) | (mn[3] << 16) | (mn[4] << 8) | mn[5];
      base = valueStart + 6 - originalPos;
      ifdOff = valueStart + 6;
    }
  }
  const ifdOffRel = ifdOff - base;
  if (ifdOffRel < 0 || ifdOffRel + 2 > mn.length) return out;
  const ifd = parseIFD(basedView(env, base), ifdOffRel, le);
  const routing = ROUTING['Sony::Main'] ?? {};
  for (const entry of ifd.entries) {
    if (entry.tag === 0x2000 || entry.tag === 0x3000 || entry.tag === 0x9000) {
      // Encrypted / device-dependent sub-IFDs: skipped in v1.
      continue;
    }
    if (entry.tag >= 0x9400 && entry.tag <= 0x940f) {
      // Encrypted cipher-data blocks (exiftool hides them as unknown).
      continue;
    }
    const subTable = routing[String(entry.tag)];
    if (subTable && TABLES[subTable] && (entry.value as Uint8Array).length >= 2) {
      decodePositionalTable(TABLES[subTable], entry.value as Uint8Array, out);
      continue;
    }
    const def = TABLES['Sony::Main']?.tags[String(entry.tag)];
    if (!def || def.unknown) continue;
    let value: TagValue;
    if (entry.type === 2) {
      value = asciiOf(entry.value as Uint8Array);
    } else if (entry.type === 7 || entry.type === 1) {
      value = entry.value;
    } else {
      value = readIfdValue(entry, view, le);
    }
    if (typeof value === 'number' && skipByClass(def.raw, value)) continue;
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    out[def.name] = formatMakerValue(def, def.name, value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Olympus
// ---------------------------------------------------------------------------

const OLYMPUS_SUBTABLES: Record<number, string> = {
  0x2010: 'Olympus::Equipment',
  0x2020: 'Olympus::CameraSettings',
  0x2030: 'Olympus::RawDevelopment',
  0x2031: 'Olympus::RawDevelopment2',
  0x2040: 'Olympus::ImageProcessing',
  0x2050: 'Olympus::FocusInfo',
};

function decodeOlympus(
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  let base = 0; // old OLYMP\0 offsets are TIFF-absolute
  let ifdOff = valueStart + 8;
  let le = env.littleEndian;
  if (startsWith(mn, 'OLYMPUS\0') || startsWith(mn, 'OM SYSTEM\0')) {
    // 10/12-byte header + own II/MM marker + uint32 IFD offset; Base = start - 12
    le = mn[8] === 0x49 && mn[9] === 0x49;
    base = valueStart - 12;
    ifdOff = valueStart + 12;
  }
  const view = basedView(env, base);
  const ifd = parseIFD(view, ifdOff - base, le);
  const routing = ROUTING['Olympus::Main'] ?? {};
  for (const entry of ifd.entries) {
    const subTable = OLYMPUS_SUBTABLES[entry.tag] ?? routing[String(entry.tag)];
    if (subTable && TABLES[subTable] && (entry.value as Uint8Array).length >= 2) {
      // Sub-table tag holds an offset (makernote-relative) to a flat binary
      // block that runs to the end of the makernote.
      const ptr = u32Of(entry.value as Uint8Array, le);
      const block = (entry.value as Uint8Array).slice(0);
      void block;
      const start = ptr;
      const end = mn.length;
      if (start > 0 && start < end) {
        decodePositionalTable(TABLES[subTable], mn.subarray(start, end), out);
      }
      continue;
    }
    const def = TABLES['Olympus::Main']?.tags[String(entry.tag)];
    if (!def || def.unknown) continue;
    let value: TagValue;
    if (entry.type === 2) {
      value = asciiOf(entry.value as Uint8Array);
    } else if (entry.type === 7 || entry.type === 1) {
      value = printableAscii(entry.value as Uint8Array) ?? entry.value;
    } else {
      value = readIfdValue(entry, view, le);
    }
    if (typeof value === 'number' && skipByClass(def.raw, value)) continue;
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    const special = OLYMPUS_SPECIALS[def.name];
    if (special) {
      out[def.name] = special(value);
      continue;
    }
    out[def.name] = formatMakerValue(def, def.name, value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Panasonic
// ---------------------------------------------------------------------------

/** Panasonic entry types are ignored; values follow the table's Format. */
const PANASONIC_SPECIALS: Record<string, (v: TagValue) => TagValue> = {
  AFAreaMode: (v) => {
    // second int16u selects the mode; first is a highlight-frame marker
    if (Array.isArray(v) && v.length === 2) return v;
    return v;
  },
  FirmwareVersion: (v) =>
    Array.isArray(v) ? v.join('.') : v instanceof Uint8Array ? Array.from(v).join('.') : v,
  TimeSincePowerOn: (v) => {
    if (typeof v !== 'number') return v;
    const cs = v % 100;
    const s = Math.floor(v / 100) % 60;
    const m = Math.floor(v / 6000) % 60;
    const h = Math.floor(v / 360000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)}.${p(cs)}`;
  },
};

function decodePanasonicIfd(
  view: DataView,
  ifdOff: number,
  le: boolean,
  out: Record<string, TagValue>,
  prioOut?: Record<string, number>,
): void {
  const ifd = parseIFD(view, ifdOff, le);
  for (const entry of ifd.entries) {
    const def = TABLES['Panasonic::Main']?.tags[String(entry.tag)];
    if (!def || def.unknown) continue;
    const raw = entry.value as Uint8Array;
    const fmt = (def as ExtractedTag & { fmt?: string }).fmt ?? '';
    let value: TagValue;
    if (fmt.startsWith('int16u')) {
      value = raw.length >= 2 ? readShorts(raw, false)[0] : 0;
    } else if (fmt.startsWith('int16s')) {
      value = raw.length >= 2 ? readShorts(raw, true)[0] : 0;
    } else if (fmt.startsWith('int32u') || fmt.startsWith('int32s')) {
      value = raw.length >= 4 ? u32Of(raw, le) : 0;
    } else if (fmt.startsWith('int8u') && raw.length > 1) {
      value = Array.from(raw);
    } else {
      // undef/string: ASCII when printable, binary placeholder otherwise
      const text = asciiOf(raw);
      value = /^[ -~]+$/.test(text) && text.length > 0 ? text : raw;
    }
    if (typeof value === 'number' && skipByClass(def.raw, value)) continue;
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    const special = PANASONIC_SPECIALS[def.name];
    if (special) {
      out[def.name] = special(value);
      continue;
    }
    out[def.name] = formatMakerValue(def, def.name, value);
  }
}

function decodePanasonic(
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  const view = fullView(env);
  // 12-byte "Panasonic\0\0\0" header; IFD follows; offsets makernote-relative.
  decodePanasonicIfd(view, valueStart + 12, env.littleEndian, out, prioOut);
  return out;
}

// ---------------------------------------------------------------------------
// Pentax
// ---------------------------------------------------------------------------

function decodePentax(
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  if (!startsWith(mn, 'AOC\0')) return out;
  // Byte-order marker ("MM\0"/"II\0") at +4; IFD entry count at +6.
  const le = mn[4] === 0x49 && mn[5] === 0x49;
  const view = basedView(env, valueStart);
  const ifd = parseIFD(view, 6, le);
  const routing = ROUTING['Pentax::Main'] ?? {};
  for (const entry of ifd.entries) {
    const subTable = routing[String(entry.tag)];
    if (subTable && TABLES[subTable] && (entry.value as Uint8Array).length >= 2) {
      decodePositionalTable(TABLES[subTable], entry.value as Uint8Array, out);
      continue;
    }
    const def = TABLES['Pentax::Main']?.tags[String(entry.tag)];
    if (!def || def.unknown) continue;
    let value: TagValue;
    if (entry.type === 2) {
      value = asciiOf(entry.value as Uint8Array);
    } else if (entry.type === 7 || entry.type === 1 || entry.type === 3 || entry.type === 4) {
      value = readIfdValue(entry, view, le);
      if (Array.isArray(value)) value = value.map((n) => String(n)).join(' ');
    } else {
      value = readIfdValue(entry, view, le);
    }
    if (typeof value === 'number' && skipByClass(def.raw, value)) continue;
    if (def.prio === 0 && prioOut) prioOut[def.name] = 1;
    out[def.name] = formatMakerValue(def, def.name, value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type VendorDecoder = (
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
) => Record<string, TagValue>;

const VENDOR_DECODERS: Array<[string, VendorDecoder]> = [
  ['canon', decodeCanon],
  ['nikon', decodeNikon],
  ['sony', decodeSony],
  ['olympus', decodeOlympus],
  ['panasonic', decodePanasonic],
  ['pentax', decodePentax],
];

/**
 * Decodes a MakerNote value into a flat tag record.
 *
 * @param mn - Raw makernote bytes (the value of EXIF tag 0x927c)
 * @param valueStart - Byte offset of the makernote IFD within `env.bytes`
 * @param env - Parse context (TIFF block, byte order, Make/Model)
 * @param prioOut - Optional map the decoder fills with per-tag priorities
 *   (tags whose Perl table sets `Priority => 0` report 1 instead of 2)
 * @returns Tags to merge into the parse result; `{}` on any failure
 */
export function decodeMakerNote(
  mn: Uint8Array,
  valueStart: number,
  env: MakerNoteEnv,
  prioOut?: Record<string, number>,
): Record<string, TagValue> {
  try {
    if (mn.length < 4) return {};
    const make = env.make.trim().toLowerCase();
    for (const [prefix, decoder] of VENDOR_DECODERS) {
      if (make.startsWith(prefix)) return decoder(mn, valueStart, env, prioOut);
    }
  } catch {
    // A malformed makernote must never fail the overall parse.
  }
  return {};
}
