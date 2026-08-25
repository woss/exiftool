import { Command } from '@cliffy/command';
import { ExifTool } from './src/exiftool.ts';
import { formatJSON, formatCSV, formatTabular } from './src/cli/output.ts';
import type { FormatOptions } from './src/cli/output.ts';
import { evalCondition } from './src/cli/filter.ts';
import { verboseLines } from './src/cli/verbosity.ts';

function normalizeArgs(args: string[]): string[] {
  return args.flatMap((a) => {
    if (a.startsWith('-') && !a.startsWith('--') && a.length > 2) {
      if (a === '-ver') return ['--version'];
      // -g1 → -g 1, -G2 → -G 2 (short form with attached value)
      if (/^-[gG]\d$/.test(a)) return [a.slice(0, 2), a.slice(2)];
      return ['--' + a.slice(1)];
    }
    if (a === '-g') return ['--group-headings', '0'];
    if (a === '-G') return ['--group-prefix', '1'];
    return [a];
  });
}

const tool = new ExifTool();

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
  .arguments('<files...:string>')
  .action(async (options, ...files: string[]) => {
    const quietCount: number = options.quiet?.length ?? 0;
    const verboseCount: number = options.verbose?.length ?? 0;
    const coordFormat: string | undefined = options.coordFormat;
    const results = [];
    for (const file of files) {
      try {
        const info = await tool.read(file, coordFormat ? { coordFormat } : undefined);
        results.push(info);
      } catch (e) {
        console.error(`Error reading ${file}: ${(e as Error).message}`);
        Deno.exit(1);
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

    if (options.binary && options.json) {
      // JSON output with binary data: hand Uint8Array values to the JSON formatter.
      fmtOpts.binary = true;
    } else if (options.binary) {
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
      if (!foundBinary) {
        console.error('No binary tags found.');
        Deno.exit(1);
      }
      return;
    }

    if (options.json) {
      console.log(formatJSON(kept, fmtOpts));
    } else if (options.csv) {
      console.log(formatCSV(kept, fmtOpts));
    } else {
      console.log(formatTabular(kept, fmtOpts));
    }
  });

await cmd.parse(normalizeArgs(Deno.args));
