export { ExifTool } from './exiftool.js';
export { TagDb } from './tag-db.js';
export type {
  ExifToolOptions,
  FileInfo,
  OutputFormat,
  ReadOptions,
  TagEntry,
  TagGroups,
  TagValue,
  WriteOptions,
} from './types.js';

export { detectParser, getAllParsers, getParser, registerParser } from './format/mod.js';

export { parseTiff } from './exif/tiff.js';
export { parseIFD } from './exif/ifd.js';
export { EXIF_TYPES, getExifTypeName, getExifTypeSize } from './exif/types.js';
