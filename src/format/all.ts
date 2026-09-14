import type { FormatParser } from './mod.js';
import { avifParser } from './avif.js';
import { jpegParser } from './jpeg.js';
import { pngParser } from './png.js';
import { webpParser } from './webp.js';
import { tiffRawParser } from './tiff-raw.js';

/**
 * Every format plugin shipped with the library, in detection order.
 * Order matters: JPEG first (most common), then PNG, WebP, AVIF, and the
 * TIFF-family RAW containers (TIFF/DNG/CR2/NEF/…) last — their II/MM magic
 * is disjoint from the others, so ordering is a convention, not a guard.
 */
export const BUILTIN_PLUGINS: FormatParser[] = [
  jpegParser,
  pngParser,
  webpParser,
  avifParser,
  tiffRawParser,
];
