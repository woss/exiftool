import { TagDb } from './tag-db.ts';
import type { ExifToolOptions, FileInfo } from './types.ts';
import { DEFAULT_OPTIONS } from './types.ts';

export class ExifTool {
  readonly tagDb = new TagDb();
  readonly options: ExifToolOptions;

  constructor(opts?: Partial<ExifToolOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...opts };
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

  async read(filePath: string): Promise<FileInfo> {
    const bytes = await Deno.readFile(filePath);
    const format = this.detectFormat(bytes);

    const result: FileInfo = {
      path: filePath,
      format,
      tags: {},
    };

    return result;
  }

  private detectFormat(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'JPEG';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'PNG';
    }
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return 'HEIC';
    }
    if (
      bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 &&
      (bytes[3] === 0x66 || bytes[3] === 0x6d || bytes[3] === 0x18)
    ) return 'MP4';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return 'RIFF';
    }
    if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) {
      return 'TIFF';
    }
    if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) {
      return 'TIFF';
    }
    return 'Unknown';
  }

  private printHelp(): void {
    console.log(`
exiftool-ts 0.1.0 — metadata read/write tool

Usage:
  exiftool-ts [OPTIONS] FILE [...]

Options:
  -h, --help       Show help
  -ver, --version  Show version
  -json            Output in JSON format
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
