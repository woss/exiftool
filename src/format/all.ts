import type { FormatParser } from './mod.js';
import { avifParser } from './avif.js';
import { iccParser } from './icc.js';
import { jpegParser } from './jpeg.js';
import { gifParser } from './gif.js';
import { pngParser } from './png.js';
import { webpParser } from './webp.js';
import { tiffRawParser } from './tiff-raw.js';
import { xmpParser } from './xmp.js';

/**
 * Every format plugin shipped with the library, in detection order.
 * Order matters: JPEG first (most common), then GIF, PNG, WebP, AVIF, and the
 * TIFF-family RAW containers (TIFF/DNG/CR2/NEF/…) last — their II/MM magic
 * is disjoint from the others, so ordering is a convention, not a guard.
 */
export const BUILTIN_PLUGINS: FormatParser[] = [
  jpegParser,
  gifParser,
  pngParser,
  webpParser,
  avifParser,
  tiffRawParser,
  iccParser,
  xmpParser,
];
