/**
 * exiftool-ts - TypeScript ExifTool wrapper with C2PA support
 *
 * @packageDocumentation
 *
 * Main entry point for the exiftool-ts library.
 * Provides high-level API for reading and writing image metadata.
 *
 * @example
 * ```typescript
 * import { ExifTool } from 'exiftool-ts';
 *
 * const exiftool = new ExifTool();
 * const result = await exiftool.read('photo.jpg');
 * console.log(result.tags.Make); // "Canon"
 * ```
 */

/**
 * Main ExifTool class for reading and writing metadata.
 * @see {@link ExifTool}
 */
export { ExifTool } from './exiftool.js';

/**
 * Tag database for custom tag definitions and overrides.
 * @see {@link TagDb}
 */
export { TagDb } from './tag-db.js';

/**
 * Error thrown when a file format is not supported.
 * @see {@link UnsupportedFormatError}
 */
export { UnsupportedFormatError } from './write/pipeline.js';

/**
 * Writes metadata tags to an image file.
 * @see {@link writeTags}
 */
export { writeTags } from './write/pipeline.js';

/**
 * Result of a write operation.
 * @see {@link WriteResult}
 */
export type { WriteResult } from './write/pipeline.js';

/**
 * Optional parsing hints for format-specific behavior.
 * @see {@link ParseHints}
 */
export type { ParseHints } from './format/mod.js';

/**
 * File information returned by parse operations.
 * @see {@link FileInfo}
 */
export type { FileInfo } from './types.js';

/**
 * Output format options for CLI and programmatic use.
 * @see {@link OutputFormat}
 */
export type { OutputFormat } from './types.js';

/**
 * Options for read operations.
 * @see {@link ReadOptions}
 */
export type { ReadOptions } from './types.js';

/**
 * Single tag entry with id, name, value, and metadata.
 * @see {@link TagEntry}
 */
export type { TagEntry } from './types.js';

/**
 * Tag groups container (EXIF, XMP, IPTC, GPS, etc.).
 * @see {@link TagGroups}
 */
export type { TagGroups } from './types.js';

/**
 * Normalized tag value (string, number, rational, date, array, buffer).
 * @see {@link TagValue}
 */
export type { TagValue } from './types.js';

/**
 * Options for write operations.
 * @see {@link WriteOptions}
 */
export type { WriteOptions } from './types.js';