import type { FormatParser } from './format/mod.js';
import { avifParser } from './format/avif.js';
import { jpegParser } from './format/jpeg.js';
import { pngParser } from './format/png.js';
import { webpParser } from './format/webp.js';

/**
 * Modern web image formats. Pass to `new ExifTool({ plugins })` — the main
 * entry never imports parsers itself, so consumer bundlers include only
 * the formats referenced here (or in a custom list).
 */
export const MODERN_PLUGINS: FormatParser[] = [
  jpegParser,
  pngParser,
  webpParser,
  avifParser,
];

/** Every plugin shipped with the library (currently identical to MODERN_PLUGINS). */
export const ALL_PLUGINS: FormatParser[] = MODERN_PLUGINS;

export { avifParser, jpegParser, pngParser, webpParser };
