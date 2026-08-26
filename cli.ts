import { Command } from '@cliffy/command';
import { ExifTool } from './src/exiftool.ts';
import { formatJSON, formatCSV, formatTabular, formatXML } from './src/cli/output.ts';
import type { FormatOptions } from './src/cli/output.ts';
import { evalCondition } from './src/cli/filter.ts';
import { verboseLines } from './src/cli/verbosity.ts';
import { expandInputs } from './src/cli/glob.ts';
import { readLines, stayOpenLoop } from './src/cli/stay-open.ts';
import { extractEmbeddedJpegs, jpegParser } from './src/format/jpeg.ts';

export function normalizeArgs(args: string[]): string[] {
  return args.flatMap((a) => {
    // TAG=VALUE write assignments pass through as operands
    if (/^-?[A-Za-z][A-Za-z0-9_]*=/.test(a)) return [a];
    if (a === '-overwrite_original' || a === '--overwrite_original') {
      return ['--overwrite-original'];
    }
    if (a === '--ee') return ['--extract-embedded'];
    if (a.startsWith('-') && !a.startsWith('--') && a.length > 2) {
      if (a === '-ver') return ['--version'];
      if (a === '-stay_open' || a === '--stay_open') return ['--stay-open'];
      // -ext maps to the long-only --extension option
      if (a === '-ext') return ['--extension'];
      // -ee maps to the long-only --extract-embedded option
      if (a === '-ee') return ['--extract-embedded'];
      if (/^-[gG]\d$/.test(a)) return [a.slice(0, 2), a.slice(2)];
      return ['--' + a.slice(1)];
    }
    if (a === '-g') return ['--group-headings', '0'];
    if (a === '-G') return ['--group-prefix', '1'];
    return [a];
  });
}

const tool = new ExifTool();

export interface CliOptions {
  json?: boolean;
  csv?: boolean;
  xml?: boolean;
  binary?: boolean;
  dateFormat?: string;
  groupHeadings?: string | boolean;
  groupPrefix?: string | boolean;
  coordFormat?: string;
  if?: string[];
  verbose?: unknown[];
  quiet?: unknown[];
  recurse?: boolean;
  extension?: string[];
  ignore?: string[];
  output?: string;
  extractEmbedded?: boolean;
  overwriteOriginal?: boolean;
  stayOpen?: string | boolean;
}

export async function runAction(options: CliOptions, ...files: string[]): Promise<number> {
  const quietCount: number = options.quiet?.length ?? 0;
  const verboseCount: number = options.verbose?.length ?? 0;
  const coordFormat: string | undefined = options.coordFormat;
  const failures: string[] = [];

  // Write mode: any TAG=VALUE operands turn the invocation into an update.
  const assignments = files.filter((f) => /^-?[A-Za-z][A-Za-z0-9_]*=/.test(f));
  if (assignments.length > 0) {
    const tags: Record<string, string> = {};
    for (const a of assignments) {
      const eq = a.indexOf('=');
      tags[a.slice(0, eq).replace(/^-/, '')] = a.slice(eq + 1);
    }
    const paths = files.filter((f) => !assignments.includes(f));
    const expandedWrite = await expandInputs(paths, {
      recurse: options.recurse === true,
      extensions: options.extension ?? [],
      ignoreDirs: options.ignore ?? [],
    });
    let updated = 0;
    for (const file of expandedWrite) {
      try {
        await tool.write(file, tags, {
          overwriteOriginal: options.overwriteOriginal === true,
        });
        updated++;
      } catch (e) {
        failures.push(`Error writing ${file}: ${(e as Error).message}`);
      }
    }
    if (updated > 0 && quietCount < 1) console.log(`${updated} image files updated`);
    for (const line of failures) console.error(line);
    return failures.length > 0 ? 1 : 0;
  }

  const expanded = await expandInputs(files, {
    recurse: options.recurse === true,
    extensions: options.extension ?? [],
    ignoreDirs: options.ignore ?? [],
  });

  const results = [];
  for (const file of expanded) {
    try {
      const info = await tool.read(file, coordFormat ? { coordFormat } : undefined);
      results.push(info);
      if (options.extractEmbedded === true && info.format === 'JPEG') {
        // The file was just read successfully; a re-read failure here is
        // handled by the same per-file catch below.
        const bytes = await Deno.readFile(file);
        for (const doc of extractEmbeddedJpegs(bytes)) {
          results.push(await jpegParser.parse(doc, file, tool.tagDb));
        }
      }
    } catch (e) {
      failures.push(`Error reading ${file}: ${(e as Error).message}`);
    }
  }

  let kept = results;
  if (options.if !== undefined) {
    const exprs: string[] = options.if;
    kept = results.filter((info) => exprs.every((expr) => evalCondition(expr, info.tags)));
    const failed = results.length - kept.length;
    if (failed > 0 && quietCount < 1) {
      console.error(`${failed} files failed condition`);
    }
  }

  const reportFailures = () => {
    if (quietCount < 1) {
      for (const line of failures) console.error(line);
    }
  };

  if (verboseCount >= 1 && quietCount < 1) {
    for (const info of kept) {
      for (const line of verboseLines(info, verboseCount)) {
        console.error(line);
      }
    }
  }

  const fmtOpts: FormatOptions = {};
  if (options.groupHeadings) {
    fmtOpts.groupHeadings = options.groupHeadings as string;
    fmtOpts.tagDb = tool.tagDb;
  }
  if (options.groupPrefix) {
    fmtOpts.groupPrefix = options.groupPrefix as string;
    fmtOpts.tagDb = tool.tagDb;
  }
  if (options.dateFormat) {
    fmtOpts.dateFormat = options.dateFormat as string;
  }

  if (options.binary && !options.json) {
    // Known limitation: with multiple files/tags, all Uint8Array values are
    // concatenated to stdout without separators and without per-tag selection.
    let foundBinary = false;
    for (const file of kept) {
      for (const value of Object.values(file.tags)) {
        if (value instanceof Uint8Array && value.length > 0) {
          await Deno.stdout.write(value);
          foundBinary = true;
        }
      }
    }
    reportFailures();
    if (!foundBinary) {
      console.error('No binary tags found.');
      return 1;
    }
    return failures.length > 0 ? 1 : 0;
  }
  if (options.binary && options.json) {
    // JSON output with binary data: hand Uint8Array values to the JSON formatter.
    fmtOpts.binary = true;
  }

  let text: string;
  if (options.json) {
    text = formatJSON(kept, fmtOpts);
  } else if (options.xml) {
    text = formatXML(kept, fmtOpts);
  } else if (options.csv) {
    text = formatCSV(kept, fmtOpts);
  } else {
    text = formatTabular(kept, fmtOpts);
  }
  if (options.output !== undefined) {
    try {
      await Deno.writeTextFile(options.output, text);
    } catch (e) {
      console.error(`Error writing ${options.output}: ${(e as Error).message}`);
      return 1;
    }
  } else {
    console.log(text);
  }
  reportFailures();
  return failures.length > 0 ? 1 : 0;
}

/**
 * Process entry: routes to the `-stay_open` daemon or a one-shot run and
 * yields the process exit code. `input` is injectable for tests.
 */
export async function main(
  options: CliOptions,
  files: string[],
  input: ReadableStream<Uint8Array> = Deno.stdin.readable,
): Promise<number> {
  const wantsDaemon = options.stayOpen !== undefined &&
    options.stayOpen !== false &&
    options.stayOpen !== 'False';
  if (!wantsDaemon) return runAction(options, ...files);

  let lastCode = 0;
  const loop = await stayOpenLoop(
    readLines(input),
    async (args) => {
      lastCode = await runAction(options, ...args);
      return lastCode;
    },
    (text) => console.log(text),
  );
  return loop.shutdownRequested ? lastCode : 0;
}

const cmd = new Command()
  .name('exiftool-ts')
  .version('0.1.0')
  .description('Read/write metadata across 140+ file formats')
  .option('--json', 'Output in JSON format')
  .option('--csv', 'Output in CSV format')
  .option('-b, --binary', 'Output binary data for binary-valued tags')
  .option('-d, --date-format <format:string>', 'Date format string (%Y %m %d %H %M %S %f)')
  .option('-g, --group-headings <family:string>', 'Show group headings (tabular only, -g[NUM])')
  .option('-G, --group-prefix <family:string>', 'Show group name prefix (-G[NUM])')
  .option('-c, --coord-format <format:string>', 'GPS coordinate format (%+.6f or template with %d %.Nf %.Ns %c)')
  .option('-if, --if <expr:string>', 'Filter files by condition ($Tag eq/ne/>/</>=/<= value)', { collect: true })
  .option('-v, --verbose', 'Verbose output', { collect: true })
  .option('-q, --quiet', 'Quiet output', { collect: true })
  .option('-X, --xml', 'Output in XML format')
  .option('-o, --output <file:string>', 'Write output to file instead of stdout')
  .option('-r, --recurse', 'Recurse into subdirectories')
  .option('--extension <ext:string>', 'Extension filter for directory scans (use -ext EXT)', { collect: true })
  .option('-i, --ignore <dirname:string>', 'Ignore a directory name during scans', { collect: true })
  .option('--extract-embedded', 'Extract embedded documents from supported formats (Multi-Picture JPEG); use -ee')
  .option('--overwrite-original', 'Skip creating <file>_original backups when writing (use -overwrite_original)')
  .option('--stay-open [flag:string]', 'Run as persistent daemon reading commands from stdin (use -stay_open)')
  .arguments('[files...:string]')
  .action(async (options, ...files: string[]) => {
    const code = await main(options as CliOptions, files);
    if (code !== 0) Deno.exit(code);
  });

if (import.meta.main) {
  await cmd.parse(normalizeArgs(Deno.args));
}
