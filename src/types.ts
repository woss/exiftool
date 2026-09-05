/**
 * Core type definitions for exiftool-ts.
 * All public API types are exported here.
 */

/**
 * Tag identifier: string (e.g., "ExposureTime") or number (e.g., 0x829A).
 */
export type TagId = string | number;

/**
 * ExifTool tag format types.
 * Matches ExifTool's internal format strings.
 */
export type TagFormat =
  | 'int8u'
  | 'int8s'
  | 'int16u'
  | 'int16s'
  | 'int32u'
  | 'int32s'
  | 'int64u'
  | 'int64s'
  | 'float'
  | 'double'
  | 'string'
  | 'binary'
  | 'rational64u'
  | 'rational64s'
  | 'rational32u'
  | 'rational32s'
  | 'undef'
  | 'fixed32u'
  | 'fixed32s'
  | 'date';

/**
 * Complete tag entry with metadata.
 */
export interface TagEntry {
  /** Tag ID (string name or numeric IFD tag number) */
  id: TagId;

  /** Human-readable tag name */
  name: string;

  /** Optional description */
  description?: string;

  /** Tag format type */
  format?: TagFormat;

  /** Expected count (for arrays) */
  count?: number;

  /** Whether tag is writable */
  writable: boolean;

  /** Group assignments at different family levels */
  groups: TagGroups;

  /** Whether tag is a list/sequence */
  isList?: boolean;

  /** Whether tag is mandatory for the format */
  isMandatory?: boolean;

  /** Whether tag indicates a problem (e.g., corrupted data) */
  isBad?: boolean;

  /** Value enumeration (e.g., { 1: "Auto", 2: "Manual" }) */
  values?: Record<number | string, string>;
}

/**
 * Tag group assignments across ExifTool's family hierarchy.
 * Family 0: General category (EXIF, XMP, IPTC, GPS, etc.)
 * Family 1: Specific group (IFD0, XMP-dc, IPTC:ApplicationRecord, etc.)
 * Family 2: Sub-category (Image, Camera, Location, etc.)
 * Family 3-4: Additional groupings
 * Family 7: Custom/external
 */
export interface TagGroups {
  /** Family 0: General category */
  family0?: string;

  /** Family 1: Specific group */
  family1?: string;

  /** Family 2: Sub-category */
  family2?: string;

  /** Family 3: Additional grouping */
  family3?: string;

  /** Family 4: Additional grouping */
  family4?: string;

  /** Family 7: Custom/external */
  family7?: string;
}

/**
 * Normalized tag value.
 * Can be string, number, boolean, binary data (Uint8Array), null, or nested arrays.
 */
export type TagValue = string | number | boolean | Uint8Array | null | TagValue[];

/**
 * Options for read operations.
 */
export interface ReadOptions {
  /** Return duplicate tags (default: false) */
  duplicates?: boolean;

  /** Return binary data as Uint8Array (default: false) */
  binary?: boolean;

  /** Group heading style (default: 0) */
  groupHeadings?: number | string;

  /** Date format string (default: "%Y:%m:%d %H:%M:%S") */
  dateFormat?: string;

  /** Coordinate format string (default: "%%.6f") */
  coordFormat?: string;

  /** Character set (default: "UTF8") */
  charset?: string;

  /** Language code (default: "en") */
  lang?: string;

  /** Compute composite tags (default: true) */
  composite?: boolean;

  /** Parse XMP structures (default: true) */
  struct?: boolean;

  /** Escape HTML entities (default: false) */
  escapeHTML?: boolean;

  /** Escape XML entities (default: false) */
  escapeXML?: boolean;

  /** Value for missing tags (default: undefined) */
  missingTagValue?: string;
}

/**
 * Options for write operations.
 */
export interface WriteOptions {
  /** Overwrite original file without backup (default: false) */
  overwriteOriginal?: boolean;

  /** Preserve file modification time (default: false) */
  preserveTime?: boolean;
}

/**
 * Result of a write operation.
 */
export interface WriteResult {
  /** Path to written file */
  file: string;

  /** Successfully written tag names */
  written: string[];

  /** Skipped tag names (unsupported/read-only) */
  skipped: string[];

  /** Backup file path if created */
  backup?: string;
}

/**
 * Output format for CLI and programmatic use.
 * - 'json': ExifTool-compatible JSON
 * - 'xml': XML (RDF)
 * - 'html': HTML table
 * - 'csv': CSV
 * - 'tabular': Human-readable table (default)
 * - 'arg': ExifTool arg file format
 */
export type OutputFormat = 'json' | 'xml' | 'html' | 'csv' | 'tabular' | 'arg';

/**
 * File information returned by parse operations.
 */
export interface FileInfo {
  /** Source path or identifier */
  path: string;

  /** Detected format (e.g., "JPEG", "PNG", "AVIF") */
  format: string;

  /** Extracted tags, keyed by tag name */
  tags: Record<string, TagValue>;

  /** Parse errors */
  errors?: string[];

  /** Parse warnings */
  warnings?: string[];
}

import type { FormatParser } from './format/mod.js';

/**
 * Result of a container write operation.
 */
export interface WriteOutcome {
  /** New image bytes with updated metadata */
  bytes: Uint8Array;

  /** Successfully written tag names */
  written: string[];

  /** Skipped tag names */
  skipped: string[];
}

/**
 * Container writer function signature.
 * Takes original bytes and tags, returns new bytes with updated metadata.
 */
export type ContainerWriter = (
  original: Uint8Array,
  tags: Record<string, TagValue>,
) => WriteOutcome;

/**
 * Configuration options for ExifTool instances.
 */
export interface ExifToolOptions {
  /** Format plugins this instance uses; defaults to every built-in format. */
  plugins?: FormatParser[];

  /** Return duplicate tags */
  duplicates: boolean;

  /** Return binary data as Uint8Array */
  binary: boolean;

  /** Compute composite tags */
  composite: boolean;

  /** Fast scan mode (0=off, 1=on, 2=metadata only) */
  fastScan: number;

  /** Verbosity level */
  verbosity: number;

  /** Quiet level */
  quiet: number;

  /** Default character set */
  charset: string;

  /** Date format string */
  dateFormat?: string;

  /** Coordinate format string */
  coordFormat?: string;

  /** Language code */
  lang: string;

  /** Value for missing tags */
  missingTagValue?: string;

  /** Extract embedded documents (0=no, 1=yes) */
  extractEmbedded: number;

  /** Show group names (false, true, or family number) */
  groupNames: boolean | string;

  /** Parse XMP structures */
  struct: boolean;

  /** Character set for EXIF */
  charsetExif?: string;

  /** Character set for IPTC */
  charsetIPTC?: string;

  /** Character set for file names */
  charsetFileName?: string;

  /** Character set for ID3 */
  charsetID3?: string;

  /** Character set for Photoshop */
  charsetPhotoshop?: string;

  /** Character set for QuickTime */
  charsetQuickTime?: string;

  /** Character set for RIFF */
  charsetRIFF?: string;
}

/** Default options matching ExifTool behavior. */
export const DEFAULT_OPTIONS: ExifToolOptions = {
  duplicates: false,
  binary: false,
  composite: true,
  fastScan: 0,
  verbosity: 0,
  quiet: 0,
  charset: 'UTF8',
  lang: 'en',
  missingTagValue: undefined,
  extractEmbedded: 0,
  groupNames: false,
  struct: false,
};