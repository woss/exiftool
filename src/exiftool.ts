import { readFile, writeFile } from 'node:fs/promises';
import { ExifToolCore } from './exiftool-core.js';
import { detectParser, type ParseHints } from './format/mod.js';
import type { FileInfo, TagValue } from './types.js';
import { writeTags, type WriteResult } from './write/pipeline.js';
import { toXmpPropertyRequest, writeXmpPacket, type XmpPropertyRequest } from './write/xmp-writer.js';

/**
 * Node.js entry point for exiftool-ts.
 * Extends {@link ExifToolCore} with filesystem-based read/write operations.
 *
 * This is the main class for Node.js environments. For browser/edge,
 * use {@link ExifToolCore} directly with `Uint8Array` buffers.
 *
 * @example
 * ```typescript
 * import { ExifTool } from 'exiftool-ts';
 *
 * const exiftool = new ExifTool();
 * const result = await exiftool.read('photo.jpg');
 * console.log(result.tags.Make, result.tags.Model);
 *
 * await exiftool.write('input.jpg', 'output.jpg', {
 *   Title: 'My Photo',
 *   Artist: 'John Doe',
 * });
 * ```
 */
export class ExifTool extends ExifToolCore {
  /**
   * Reads metadata from a file path.
   *
   * @param filePath - Path to the image file
   * @param hints - Optional parsing hints for format-specific behavior
   * @returns Parsed file information with tags grouped by metadata standard
   */
  async read(filePath: string, hints?: ParseHints): Promise<FileInfo> {
    const bytes = await readFile(filePath);
    const parser = detectParser(bytes, await this.resolvePlugins());
    if (parser) {
      return parser.parse(bytes, filePath, this.tagDb, hints);
    }

    return { path: filePath, format: 'Unknown', tags: {} };
  }

  /**
   * Writes metadata tags to a file.
   *
   * Creates a backup file (`<file>_original`) unless `overwriteOriginal` is set.
   * Supports JPEG (APP1), PNG (eXIf), WebP (EXIF), AVIF/HEIF (meta box).
   *
   * @param filePath - Path to the input file
   * @param tags - Tags to write (normalized format, see {@link TagValue})
   * @param opts - Write options
   * @param opts.overwriteOriginal - Overwrite file without backup (default: false)
   * @returns Write result with success status and any warnings
   */
  async write(
    filePath: string,
    tags: Record<string, TagValue>,
    opts: { overwriteOriginal?: boolean } = {},
  ): Promise<WriteResult> {
    return writeTags(filePath, tags, opts, await this.resolvePlugins());
  }

  /**
   * Writes an `.xmp` sidecar next to a media file (Lightroom reads these
   * for RAW/DNG pickup).
   *
   * The sidecar is an XMP packet carrying the requested XMP properties:
   * 'XMP-dc:Subject' keys or bare aliases (Subject, Keywords, Title,
   * Description, Rights, …). An existing sidecar is read and merged —
   * unknown properties already in it are preserved, matching properties
   * are replaced (idempotent re-runs produce byte-identical files).
   * MetadataDate is written only if requested: derive it from the file's
   * indexed mtime for byte-stable repeat runs.
   *
   * @param mediaPath - Path to the media file (sidecar path is derived)
   * @param tags - XMP tags to write (non-XMP keys are ignored)
   * @param opts.sidecarPath - Override the sidecar path (default `<media>.xmp`)
   * @returns The sidecar path and the tags actually written
   */
  async writeSidecar(
    mediaPath: string,
    tags: Record<string, TagValue>,
    opts: { sidecarPath?: string } = {},
  ): Promise<{ sidecarPath: string; written: string[] }> {
    const sidecarPath =
      opts.sidecarPath ?? (mediaPath.endsWith('.xmp') ? mediaPath : `${mediaPath}.xmp`);
    const props: XmpPropertyRequest[] = [];
    const written: string[] = [];
    for (const [key, value] of Object.entries(tags)) {
      const prop = toXmpPropertyRequest(key, value);
      if (prop) {
        props.push(prop);
        written.push(key);
      }
    }
    if (props.length === 0) {
      return { sidecarPath, written };
    }
    let existing: string | null = null;
    try {
      existing = await readFile(sidecarPath, 'utf8');
    } catch {
      // no sidecar yet: fresh packet
    }
    await writeFile(sidecarPath, writeXmpPacket(existing, props), 'utf8');
    return { sidecarPath, written };
  }

  /**
   * Runs CLI-style arguments programmatically.
   *
   * @param args - Command-line arguments (e.g., `['-j', 'photo.jpg']`)
   * @returns Exit code (0 = success)
   */
  async run(args: string[]): Promise<number> {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      this.printHelp();
      return 0;
    }

    if (args.includes('--version') || args.includes('-ver')) {
      console.log('0.1.0');
      return 0;
    }

    console.error('exiftool-ts: not yet implemented');
    await 0;
    return 1;
  }

  /** Prints CLI help text. */
  printHelp(): void {
    console.log(`
exiftool-ts 0.1.0 — metadata read/write tool

Usage:
  exiftool-ts [OPTIONS] FILE [...]

Options:
  -h, --help       Show help
  -ver, --version  Show version
  -n               Print tag values only
  -g[NUM]          Show group names
  -b               Output binary data
  -d FMT           Date format
  -c FMT           Coordinate format
  -lang CODE       Language
  -charset TYPE    Character set
  -v               Verbose
  -q               Quiet
  -ext EXT         Process only files with given extension
  -i DIR           Ignore directory
  -r               Recurse subdirectories
  -if EXPR         Condition expression
  -tagsFromFile F  Copy tags from file
  -o FILE          Output filename
  -w EXT           Write text output file
  -csv             Export as CSV
  -list[w]         List available/writable tags
  -listf           List supported file extensions
  -listg[NUM]      List groups
  -listr           List recognized file extensions
  -FIXME           (more options to be implemented)
`);
  }
}