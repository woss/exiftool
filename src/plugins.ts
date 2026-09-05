import type { FormatParser } from './format/mod.js';
import { avifParser } from './format/avif.js';
import { jpegParser } from './format/jpeg.js';
import { pngParser } from './format/png.js';
import { webpParser } from './format/webp.js';

/**
 * Built-in format parser plugins.
 * Pass to `new ExifTool({ plugins: [...] })` to customize supported formats.
 * Bundlers will only include formats referenced here.
 */

/**
 * Modern web image format parsers (JPEG, PNG, WebP, AVIF/HEIF).
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
  pngParser,
  webpParser,
  avifParser,
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

/** PNG format parser. Supports iTXt/tEXt/zTXt, eXIf, caBX (C2PA), ICC, sRGB. */
export { pngParser };

/** WebP format parser. Supports VP8/VP8L, EXIF, XMP, ICC in VP8X chunks. */
export { webpParser };