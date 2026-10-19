/**
 * Browser entry (published as the "browser" export condition): the
 * platform-free core plus the plugin presets. No Node builtins — reads
 * and writes operate on in-memory buffers via readBytes/writeBytes.
 */
export { ExifToolCore as ExifTool } from './exiftool-core.js';
export {
  MODERN_PLUGINS,
  MODERN_RAW_PLUGINS,
  ALL_PLUGINS,
  avifParser,
  jpegParser,
  pngParser,
  ppmParser,
  pgmParser,
  pbmParser,
  webpParser,
  tiffRawParser,
  exifParser,
  exvParser,
  iccParser,
  xmpParser,
} from './plugins.js';
export type { FormatParser, ParseHints } from './format/mod.js';
export type { FileInfo, TagValue, WriteOptions, WriteResult } from './types.js';
