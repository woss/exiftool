import { readFile, writeFile } from 'node:fs/promises';
import { ExifToolCore } from './exiftool-core.js';
import { detectParser, type ParseHints } from './format/mod.js';
import type { FileInfo, TagValue } from './types.js';
import { writeTags, type WriteResult } from './write/pipeline.js';

/**
 * Node entry: extends the platform-free core with path-based read/write
 * backed by the filesystem.
 */
export class ExifTool extends ExifToolCore {
  async read(filePath: string, hints?: ParseHints): Promise<FileInfo> {
    const bytes = await readFile(filePath);
    const parser = detectParser(bytes, await this.resolvePlugins());
    if (parser) {
      return parser.parse(bytes, filePath, this.tagDb, hints);
    }

    return { path: filePath, format: 'Unknown', tags: {} };
  }

  /**
   * Writes the writable tag subset into the file's native metadata
   * container (JPEG APP1, PNG eXIf, WebP EXIF, AVIF meta). Creates a
   * `<file>_original` backup unless overwriteOriginal is set.
   */
  async write(
    filePath: string,
    tags: Record<string, TagValue>,
    opts: { overwriteOriginal?: boolean } = {},
  ): Promise<WriteResult> {
    return writeTags(filePath, tags, opts, await this.resolvePlugins());
  }

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

  private printHelp(): void {
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
