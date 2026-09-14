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

const TABLES = makerPc as unknown as Record<string, ExtractedTable>;

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
  const vals = wide ? readInts(bytes, signed) : readShorts(bytes, signed);
  for (let i = 0; i < vals.length; ) {
    const def = table.tags[String(i)];
    if (!def) {
      i += 1;
      continue;
    }
    const count = def.count ?? 1;
    const raw: TagValue = count === 1 ? vals[i] : vals.slice(i, i + count);
    i += count;
    if (def.unknown) continue;
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
