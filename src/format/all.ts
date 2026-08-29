import type { FormatParser } from './mod.js';
import { avifParser } from './avif.js';
import { jpegParser } from './jpeg.js';
import { pngParser } from './png.js';
import { webpParser } from './webp.js';

/** Every format plugin shipped with the library, in detection order. */
export const BUILTIN_PLUGINS: FormatParser[] = [
  jpegParser,
  pngParser,
  webpParser,
  avifParser,
];
