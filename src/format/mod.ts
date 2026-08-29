import type { ContainerWriter, FileInfo, TagValue, WriteOutcome } from '../types.js';
import type { TagDb } from '../tag-db.js';

/** Optional per-read hints threaded from the CLI down into parsers. */
export interface ParseHints {
  coordFormat?: string;
}

/**
 * A format plugin: an adapter that recognises a container by magic bytes
 * and parses it into a FileInfo. Plugins are plain objects — registration
 * is explicit (see ExifTool's `plugins` option), never a module side
 * effect, so consumer bundlers can include only the formats they use.
 */
export interface FormatParser {
  format: string;
  extensions: string[];
  canParse(bytes: Uint8Array): boolean;
  parse(
    bytes: Uint8Array,
    filePath: string,
    tagDb?: TagDb,
    hints?: ParseHints,
  ): Promise<FileInfo>;
  /** Produces updated container bytes; present only for writable formats. */
  writeBytes?(original: Uint8Array, tags: Record<string, TagValue>): WriteOutcome;
}

/** First parser whose `canParse` accepts the buffer, else undefined. */
export function detectParser(
  bytes: Uint8Array,
  parsers: Iterable<FormatParser>,
): FormatParser | undefined {
  for (const parser of parsers) {
    if (parser.canParse(bytes)) return parser;
  }
  return undefined;
}

let builtinPromise: Promise<FormatParser[]> | undefined;

/**
 * The built-in plugin set (JPEG, PNG, WebP, AVIF), loaded lazily so that
 * importing the library never pulls a format module by default.
 */
export function builtinPlugins(): Promise<FormatParser[]> {
  builtinPromise ??= import('./all.js').then((m) => m.BUILTIN_PLUGINS);
  return builtinPromise;
}
