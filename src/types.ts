export type TagId = string | number;

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

export interface TagEntry {
  id: TagId;
  name: string;
  description?: string;
  format?: TagFormat;
  count?: number;
  writable: boolean;
  groups: TagGroups;
  isList?: boolean;
  isMandatory?: boolean;
  isBad?: boolean;
  values?: Record<number | string, string>;
}

export interface TagGroups {
  family0?: string;
  family1?: string;
  family2?: string;
  family3?: string;
  family4?: string;
  family7?: string;
}

export type TagValue = string | number | boolean | Uint8Array | null | TagValue[];

export interface ReadOptions {
  duplicates?: boolean;
  binary?: boolean;
  groupHeadings?: number | string;
  dateFormat?: string;
  coordFormat?: string;
  charset?: string;
  lang?: string;
  composite?: boolean;
  struct?: boolean;
  escapeHTML?: boolean;
  escapeXML?: boolean;
  missingTagValue?: string;
}

export interface WriteOptions {
  overwriteOriginal?: boolean;
  preserveTime?: boolean;
}

export type OutputFormat = 'json' | 'xml' | 'html' | 'csv' | 'tabular' | 'arg';

export interface FileInfo {
  path: string;
  format: string;
  tags: Record<string, TagValue>;
  errors?: string[];
  warnings?: string[];
}

import type { FormatParser } from './format/mod.js';

export interface ExifToolOptions {
  /** Format plugins this instance uses; defaults to every built-in format. */
  plugins?: FormatParser[];
  duplicates: boolean;
  binary: boolean;
  composite: boolean;
  fastScan: number;
  verbosity: number;
  quiet: number;
  charset: string;
  dateFormat?: string;
  coordFormat?: string;
  lang: string;
  missingTagValue?: string;
  extractEmbedded: number;
  groupNames: boolean | string;
  struct: boolean;
  charsetExif?: string;
  charsetIPTC?: string;
  charsetFileName?: string;
  charsetID3?: string;
  charsetPhotoshop?: string;
  charsetQuickTime?: string;
  charsetRIFF?: string;
}

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
