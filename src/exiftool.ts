import { TagDb } from './tag-db.ts';
import type { ExifToolOptions, FileInfo, TagEntry } from './types.ts';
import { DEFAULT_OPTIONS } from './types.ts';
import tagData from './tags/generated/tags.json' with { type: 'json' };
import type { TableDef } from './tags.ts';
import { detectParser } from './format/mod.ts';
import type { ParseHints } from './format/mod.ts';
import './format/jpeg.ts';
import './format/png.ts';
import './format/webp.ts';
import './format/avif.ts';

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

export class ExifTool {
  readonly tagDb: TagDb;
  readonly options: ExifToolOptions;

  constructor(opts?: Partial<ExifToolOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...opts };
    this.tagDb = buildTagDb();
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

  async read(filePath: string, hints?: ParseHints): Promise<FileInfo> {
    const bytes = await Deno.readFile(filePath);
    const parser = detectParser(bytes);

    if (parser) {
      return parser.parse(bytes, filePath, this.tagDb, hints);
    }

    return { path: filePath, format: 'Unknown', tags: {} };
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
