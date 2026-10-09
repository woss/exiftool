import type { FormatParser } from './format/mod.js';
import { avifParser } from './format/avif.js';
import { iccParser } from './format/icc.js';
import { jpegParser } from './format/jpeg.js';
import { gifParser } from './format/gif.js';
import { pngParser } from './format/png.js';
import { pgmParser } from './format/pgm.js';
import { ppmParser } from './format/ppm.js';
import { webpParser } from './format/webp.js';
import { tiffRawParser } from './format/tiff-raw.js';
import { xmpParser } from './format/xmp.js';

/**
 * Built-in format parser plugins.
 * Pass to `new ExifTool({ plugins: [...] })` to customize supported formats.
 * Bundlers will only include formats referenced here.
 */

/**
 * Modern web image format parsers (JPEG, GIF, PNG, WebP, AVIF/HEIF).
 * Recommended default for web applications.
 *
 * @example
 * ```typescript
 * import { ExifToolCore, MODERN_PLUGINS } from 'exiftool-ts';
 *
 * const exiftool = new ExifToolCore({ plugins: MODERN_PLUGINS });
 * ```
 */
export const MODERN_PLUGINS: FormatParser[] = [
  jpegParser,
  gifParser,
  pngParser,
  ppmParser,
  pgmParser,
  webpParser,
  avifParser,
  tiffRawParser,
  iccParser,
  xmpParser,
];

/**
 * All built-in format parsers (currently identical to MODERN_PLUGINS).
 * Use this for maximum compatibility.
 */
export const ALL_PLUGINS: FormatParser[] = MODERN_PLUGINS;

/** AVIF/HEIF format parser. Supports ISOBMFF boxes, EXIF, XMP, ICC. */
export { avifParser };

/** JPEG format parser. Supports EXIF, XMP, IPTC, ICC, JFIF, MPF, C2PA/JUMBF. */
export { jpegParser };

/** GIF format parser. Supports comments, XMP, and ICC application extensions. */
export { gifParser };

/** PNG format parser. Supports iTXt/tEXt/zTXt, eXIf, caBX (C2PA), ICC, sRGB. */
export { pngParser };

/** PPM format parser. Supports P3/P6 headers and Comment metadata writes. */
export { ppmParser };

/** PGM format parser. Supports P2/P5 headers and Comment metadata writes. */
export { pgmParser };

/** WebP format parser. Supports VP8/VP8L, EXIF, XMP, ICC in VP8X chunks. */
export { webpParser };

/**
 * TIFF-family RAW container parser (read-only). Registers under `'TIFF'`;
 * per-file type (DNG, CR2, NEF, ARW, ORF, RW2, PEF, ERF, DCR, SRW) is
 * reported as `FileInfo.format`. MakerNotes are not decoded.
 */
export { tiffRawParser };

/** Standalone ICC profile parser and whole-profile writer. */
export { iccParser };

/** Standalone XMP packet parser and writer. */
export { xmpParser };