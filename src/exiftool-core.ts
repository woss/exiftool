import { TagDb } from './tag-db.js';
import { DEFAULT_OPTIONS, type ExifToolOptions, type FileInfo, type TagEntry, type TagValue, type WriteOutcome } from './types.js';
import tagData from './tags/generated/tags.json' with { type: 'json' };
import type { TableDef } from './tags.js';
import { builtinPlugins, detectParser } from './format/mod.js';
import type { FormatParser } from './format/mod.js';
import { UnsupportedFormatError } from './write/writers.js';

/**
 * Platform-free ExifTool core.
 * In-memory metadata parsing and writing with plugin resolution.
 * No Node.js builtins — suitable for browser, edge, and Node environments.
 *
 * The Node.js entry point extends this with filesystem operations.
 * @see {@link ExifTool}
 *
 * @example
 * ```typescript
 * import { ExifToolCore } from 'exiftool-ts';
 *
 * const core = new ExifToolCore();
 * const result = await core.readBytes(buffer);
 * const written = await core.writeBytes(buffer, { Title: 'Test' });
 * ```
 */
export class ExifToolCore {
  /** Tag database for custom tag definitions. */
  readonly tagDb: TagDb;

  /** Resolved options (merged with defaults). */
  readonly options: ExifToolOptions;

  protected resolvedPlugins?: FormatParser[];

  /**
   * Creates a new ExifToolCore instance.
   *
   * @param opts - Optional configuration options
   * @param opts.plugins - Custom format parsers (default: all built-in)
   * @param opts.ignoreWarnings - Suppress parsing warnings
   * @param opts.parseHints - Format-specific parsing hints
   */
  constructor(opts?: Partial<ExifToolOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...opts };
    this.tagDb = buildTagDb();
  }

  /**
   * Resolves the plugin set for this instance.
   * Uses explicit `plugins` option or loads all built-in parsers lazily.
   *
   * @returns Array of format parsers
   */
  protected async resolvePlugins(): Promise<FormatParser[]> {
    this.resolvedPlugins ??= this.options.plugins ?? await builtinPlugins();
    return this.resolvedPlugins;
  }

  /**
   * Gets a parser by format name (e.g., 'JPEG', 'PNG', 'AVIF').
   *
   * @param format - Format identifier
   * @returns FormatParser if available, undefined otherwise
   */
  getParser(format: string): FormatParser | undefined {
    return this.resolvedPlugins?.find((p) => p.format === format);
  }

  /**
   * Parses metadata from an in-memory buffer.
   *
   * File-system-derived tags (FileName, FileSize, FileModifyDate, etc.)
   * are absent — only embedded metadata is returned.
   *
   * @param bytes - Image file data as Uint8Array
   * @returns Parsed file information with tags
   */
  async readBytes(bytes: Uint8Array): Promise<FileInfo> {
    const parser = detectParser(bytes, await this.resolvePlugins());
    if (parser) {
      return parser.parse(bytes, '(buffer)', this.tagDb);
    }
    return { path: '(buffer)', format: 'Unknown', tags: {} };
  }

  /**
   * Writes metadata tags to an in-memory buffer.
   *
   * Returns the new bytes with updated metadata container
   * (JPEG APP1, PNG eXIf, WebP EXIF, AVIF/HEIF meta box).
   *
   * @param bytes - Original image data
   * @param tags - Tags to write (normalized format)
   * @returns Write outcome with new bytes and any warnings
   * @throws {@link UnsupportedFormatError} if format doesn't support writing
   */
  async writeBytes(
    bytes: Uint8Array,
    tags: Record<string, TagValue>,
  ): Promise<WriteOutcome> {
    const parser = detectParser(bytes, await this.resolvePlugins());
    if (!parser?.writeBytes) {
      throw new UnsupportedFormatError(
        `writing not supported for ${parser?.format ?? 'unknown'} files`,
      );
    }
    return parser.writeBytes(bytes, tags);
  }
}

/**
 * Builds the default tag database from embedded tag definitions.
 * Loads 10,000+ tags from JSON and registers them in a TagDb.
 */
function buildTagDb(): TagDb {
  const db = new TagDb();
  const tables = tagData as TableDef[];
  for (const table of tables) {
    const entries: TagEntry[] = table.tags.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.type !== '?' ? t.type as TagEntry['format'] : undefined,
      writable: t.writable,
      groups: {
        family0: table.groups.g0,
        family1: table.groups.g1,
        family2: table.groups.g2,
        family7: t.g2,
      },
      values: t.values && Object.keys(t.values).length > 0 ? t.values : undefined,
    }));
    db.registerBatch(entries);
  }
  return db;
}