import type { FormatParser, ParseHints } from './mod.js';
import type { FileInfo, TagValue } from '../types.js';
import type { TagDb } from '../tag-db.js';
import { parseTiff } from '../exif/tiff.js';
import { parseIFD } from '../exif/ifd.js';
import { readIfdValue } from '../exif/values.js';
import { computeCompositeTags } from '../exif/composite.js';

const TIFF_MAGIC_LITTLE = 0x4949; // 'II'
const TIFF_MAGIC_BIG = 0x4d4d; // 'MM'
const TIFF_MAGIC_VALUE = 42;
const PANASONIC_MAGIC_VALUE = 85;

const TAG_MAKE = 0x010f;
const TAG_DNG_VERSION = 0xc612;

/**
 * TIFF-based RAW container parser (read-only): TIFF, DNG, CR2, NEF, ARW,
 * ORF, RW2/RWL, PEF, ERF, DCR, SRW.
 *
 * Detection is magic-based (II/MM + version 42, or 85 for Panasonic); the
 * `extensions` list is advisory (CLI `-ext` filter / docs), not a
 * detection path.
 *
 * The registry name is `'TIFF'` — the per-file type (DNG, CR2, NEF, …) is
 * reported as `FileInfo.format`. Note `getParser('DNG')` etc. won't
 * resolve; nothing in the codebase looks those names up.
 *
 * Known limitations (both pre-existing project gaps, not new here):
 * - MakerNotes are not decoded; vendor makernote blobs surface as
 *   truncated `[MakerNote: N bytes]` markers from the existing formatter.
 * - RW2/RWL parity is intentionally partial: only tags whose names resolve
 *   through TagDb/built-ins are emitted (PanasonicRaw-specific ids live in
 *   a different tag group). DNG `DNGVersion` renders via TagDb if a
 *   PrintConv exists, else as its raw value — it is never hand-formatted.
 * - No `writeBytes`: `writeTags` on a RAW file keeps throwing
 *   `UnsupportedFormatError` as before.
 */
 export const tiffRawParser: FormatParser = {
  format: 'TIFF',
  extensions: [
    '.tif', '.tiff', '.dng', '.cr2', '.nef', '.arw', '.erf', '.pef',
    '.orf', '.rw2', '.rwl', '.srw', '.dcr', '.kdc',
  ],
  canParse(bytes: Uint8Array): boolean {
    if (bytes.length < 4) return false;
    const magic = (bytes[0] << 8) | bytes[1];
    if (magic !== TIFF_MAGIC_BIG && magic !== TIFF_MAGIC_LITTLE) return false;
    const isLE = magic === TIFF_MAGIC_LITTLE;
    const version = isLE ? (bytes[2] | (bytes[3] << 8)) : (bytes[3] | (bytes[2] << 8));
    return version === TIFF_MAGIC_VALUE || version === PANASONIC_MAGIC_VALUE;
  },
  parse(bytes: Uint8Array, filePath: string, tagDb?: TagDb, hints?: ParseHints): Promise<FileInfo> {
    const isLE = bytes[0] === 0x49;
    const version = isLE ? (bytes[2] | (bytes[3] << 8)) : (bytes[3] | (bytes[2] << 8));
    const format = classifyTiffRaw(bytes, version === PANASONIC_MAGIC_VALUE);

    // Do not set ExifByteOrder: that is a JPEG-embedded-Exif artifact, not
    // something exiftool emits for standalone TIFF containers. Thumbnail
    // slicing is likewise skipped — raw thumbnails do not live in IFD1 the
    // way embedded-Exif ones do.
    const tags = parseTiff(bytes, tagDb, hints, {
      subIfds: true,
      xmp: true,
      panasonic: version === PANASONIC_MAGIC_VALUE,
    });
    computeCompositeTags(tags);
    addFileMetadata(tags, filePath, format);
    return Promise.resolve({ path: filePath, format, tags });
  },
};

/** Per-file FileType → MIME type, mirroring exiftool's table. */
const MIME_BY_FORMAT: Record<string, string> = {
  TIFF: 'image/tiff',
  DNG: 'image/x-adobe-dng',
  CR2: 'image/x-canon-cr2',
  NEF: 'image/x-nikon-nef',
  ARW: 'image/x-sony-arw',
  ORF: 'image/x-olympus-orf',
  RW2: 'image/x-panasonic-rw2',
  PEF: 'image/x-pentax-pef',
  ERF: 'image/x-epson-erf',
  DCR: 'image/x-kodak-dcr',
  SRW: 'image/x-samsung-srw',
};

function addFileMetadata(tags: Record<string, TagValue>, filePath: string, format: string): void {
  const fileName = filePath.split('/').pop() ?? filePath;
  tags['FileName'] = fileName;
  tags['SourceFile'] = filePath;
  tags['FileType'] = format;
  tags['FileTypeExtension'] = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  tags['MIMEType'] = MIME_BY_FORMAT[format] ?? 'image/tiff';
}

/** Make-string → per-file format, case-insensitive. */
const MAKE_TO_FORMAT: Record<string, string> = {
  canon: 'CR2',
  nikon: 'NEF',
  sony: 'ARW',
  olympus: 'ORF',
  pentax: 'PEF',
  panasonic: 'RW2',
  epson: 'ERF',
  kodak: 'DCR',
  samsung: 'SRW',
};

/**
 * Classifies a TIFF-family buffer into its per-file format: RW2 by magic,
 * DNG by DNGVersion, otherwise by the IFD0 Make string, else plain TIFF.
 * Malformed buffers fall back to `'TIFF'` — no throwing.
 */
function classifyTiffRaw(bytes: Uint8Array, panasonic: boolean): string {
  if (panasonic) return 'RW2';
  if (bytes.length < 8) return 'TIFF';
  const littleEndian = bytes[0] === 0x49;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifd0Offset = littleEndian
    ? (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24))
    : (bytes[7] | (bytes[6] << 8) | (bytes[5] << 16) | (bytes[4] << 24));
  if (ifd0Offset < 8 || ifd0Offset >= bytes.length) return 'TIFF';

  const ifd0 = parseIFD(view, ifd0Offset, littleEndian);
  let make: string | undefined;
  for (const entry of ifd0.entries) {
    if (entry.tag === TAG_DNG_VERSION) return 'DNG';
    if (entry.tag === TAG_MAKE && make === undefined) {
      const val = readIfdValue(entry, view, littleEndian);
      if (typeof val === 'string' && val.length > 0) make = val;
    }
  }
  if (make !== undefined) {
    // ExifTool matches the Make prefix ("NIKON CORPORATION" → NEF) and
    // finds the Kodak brand string anywhere ("EASTMAN KODAK COMPANY").
    const norm = make.trim().toLowerCase();
    for (const [needle, fmt] of Object.entries(MAKE_TO_FORMAT)) {
      if (norm.startsWith(needle) || (needle === 'kodak' && norm.includes(needle))) return fmt;
    }
  }
  return 'TIFF';
}
