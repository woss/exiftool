import type { ContainerWriter, FileInfo, TagValue, WriteOutcome } from '../types.js';
import type { TagDb } from '../tag-db.js';

/** Optional per-read hints threaded from the CLI down into parsers. */
export interface ParseHints {
  coordFormat?: string;
  /** Keep tags repeated across IFDs (exiftool -a); default suppresses them. */
  duplicates?: boolean;
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
  filePath?: string,
): FormatParser | undefined {
  if (filePath) {
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (extension) {
      for (const parser of parsers) {
        if (parser.extensions.some((candidate) => candidate.toLowerCase() === extension) && parser.canParse(bytes)) {
          return parser;
        }
      }
    }
  }
  for (const parser of parsers) {
    if (parser.canParse(bytes)) return parser;
  }
  return undefined;
}

let builtinPromise: Promise<FormatParser[]> | undefined;

/**
 * The built-in plugin set (JPEG, GIF, PNG, WebP, AVIF, TIFF-family RAW), loaded
 * lazily so that importing the library never pulls a format module by
 * default. Dynamic import is deliberate: plugin loading from a
 * runtime-optional module, keeping the static import graph parser-free.
 */
export function builtinPlugins(): Promise<FormatParser[]> {
  builtinPromise ??= import('./all.js').then((m) => m.BUILTIN_PLUGINS);
  return builtinPromise;
}
