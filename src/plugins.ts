import type { FormatParser } from './format/mod.js';
import { BUILTIN_PLUGINS } from './format/all.js';
import { avifParser } from './format/avif.js';
import { exifParser } from './format/exif.js';
import { exvParser } from './format/exv.js';
import { pbmParser } from './format/pbm.js';
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
 * Web image formats, chosen from measured traffic: HTTP Archive's Web Almanac
 * 2024 (11M+ image requests) puts JPEG at 32.4%, PNG at 28.4%, GIF at 16.8%,
 * WebP at 12% and AVIF at 1.0% of image responses — together ~91% of
 * everything the web serves. Formats with no web share (netpbm, RAW
 * containers, standalone metadata packets) are left out; compose them from
 * the individual parsers below.
 *
 * Recommended preset for web applications.
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
  webpParser,
  avifParser,
];

/**
 * Camera RAW formats that matter today, plus the sidecar write path.
 * `tiffRawParser` reads DNG, CR2, NEF, ARW, ORF, RW2, PEF, ERF, DCR and SRW
 * (the most popular RAW containers; CR3 and RAF are not supported yet) and
 * rewrites plain TIFF in place — RAW/DNG is sidecar-only by design.
 * `xmpParser` covers `.xmp` sidecar reads and writes for the files the
 * writer refuses to touch.
 *
 * @example
 * ```typescript
 * import { ExifToolCore, MODERN_RAW_PLUGINS } from 'exiftool-ts';
 *
 * const exiftool = new ExifToolCore({ plugins: MODERN_RAW_PLUGINS });
 * await exiftool.write('IMG_0001.CR2.xmp', { Rating: 5 }); // sidecar write
 * ```
 */
export const MODERN_RAW_PLUGINS: FormatParser[] = [tiffRawParser, xmpParser];

/**
 * Every parser the library ships, in detection order (same set and order as
 * the lazy default `builtinPlugins()`). Use for maximum compatibility.
 */
export const ALL_PLUGINS: FormatParser[] = BUILTIN_PLUGINS;

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

/** PBM format parser. Supports P1/P4 headers and Comment metadata writes. */
export { pbmParser };

/** WebP format parser. Supports VP8/VP8L, EXIF, XMP, ICC in VP8X chunks. */
export { webpParser };

/**
 * TIFF-family RAW container parser (read-only). Registers under `'TIFF'`;
 * per-file type (DNG, CR2, NEF, ARW, ORF, RW2, PEF, ERF, DCR, SRW) is
 * reported as `FileInfo.format`. MakerNotes are not decoded.
 */
export { tiffRawParser };

/** Standalone TIFF-encoded EXIF file parser and writer. */
export { exifParser };

/** EXV parser for Exiv2-wrapped JPEG metadata. */
export { exvParser };

/** Standalone ICC profile parser and whole-profile writer. */
export { iccParser };

/** Standalone XMP packet parser and writer. */
export { xmpParser };