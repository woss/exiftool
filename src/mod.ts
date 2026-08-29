/**
 * Public API barrel. The root mod.ts re-exports this for JSR; the npm
 * build bundles this as dist/mod.js. Anything not listed here is
 * internal — deep imports are unsupported.
 */
export { ExifTool } from './exiftool.js';
export { TagDb } from './tag-db.js';
export { UnsupportedFormatError, writeTags } from './write/pipeline.js';
export type { WriteResult } from './write/pipeline.js';
export type { ParseHints } from './format/mod.js';
export type {
  FileInfo,
  OutputFormat,
  ReadOptions,
  TagEntry,
  TagGroups,
  TagValue,
  WriteOptions,
} from './types.js';
