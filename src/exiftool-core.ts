import { TagDb } from './tag-db.js';
import { DEFAULT_OPTIONS, type ExifToolOptions, type FileInfo, type TagEntry, type TagValue, type WriteOutcome } from './types.js';
import tagData from './tags/generated/tags.json' with { type: 'json' };
import type { TableDef } from './tags.js';
import { builtinPlugins, detectParser } from './format/mod.js';
import type { FormatParser } from './format/mod.js';
import { UnsupportedFormatError } from './write/writers.js';

/**
 * Platform-free ExifTool core: in-memory reads and writes plus plugin
 * resolution. No Node builtins — the browser entry publishes this class;
 * the Node entry extends it with path-based read()/write().
 */
export class ExifToolCore {
  readonly tagDb: TagDb;
  readonly options: ExifToolOptions;

  protected resolvedPlugins?: FormatParser[];

  constructor(opts?: Partial<ExifToolOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...opts };
    this.tagDb = buildTagDb();
  }

  /** Plugin set: explicit `plugins` option, else every built-in format (lazily). */
  protected async resolvePlugins(): Promise<FormatParser[]> {
    this.resolvedPlugins ??= this.options.plugins ?? await builtinPlugins();
    return this.resolvedPlugins;
  }

  /** The resolved plugin for `format`, if this instance uses it. */
  getParser(format: string): FormatParser | undefined {
    return this.resolvedPlugins?.find((p) => p.format === format);
  }

  /**
   * Parses metadata from an in-memory buffer.
   * File-system-derived tags (FileName, FileSize, …) are absent here.
   */
  async readBytes(bytes: Uint8Array): Promise<FileInfo> {
    const parser = detectParser(bytes, await this.resolvePlugins());
    if (parser) {
      return parser.parse(bytes, '(buffer)', this.tagDb);
    }
    return { path: '(buffer)', format: 'Unknown', tags: {} };
  }

  /**
   * Writes the writable tag subset into an in-memory container's metadata
   * (JPEG APP1, PNG eXIf, WebP EXIF, AVIF meta) and returns the new bytes.
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
